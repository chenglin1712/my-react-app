"""AI 助手圖片輸入（路線圖 #24）：驗證、功能旗標、限速、送給模型的內容格式。"""
import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase
from PIL import Image

from adminapi.models import FeatureFlag
from AIModel.image_input import IMAGE_FLAG, MAX_IMAGE_BYTES, ChatImageSerializer, with_image
from AIModel.services import build_chat_system, system_text
from AIModel.tests import _mock_chat_client

def _encode(fmt: str, size=(64, 48), **save_args) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 120, 40)).save(buffer, fmt, **save_args)
    return buffer.getvalue()


JPEG_BYTES = _encode("JPEG")
PNG_BYTES = _encode("PNG")
WEBP_BYTES = _encode("WEBP")


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _image(raw=JPEG_BYTES, media_type="image/jpeg"):
    return {"media_type": media_type, "data": _b64(raw)}


class ChatImageSerializerTest(TestCase):
    def _errors(self, payload):
        serializer = ChatImageSerializer(data=payload)
        return None if serializer.is_valid() else serializer.errors

    def test_accepts_jpeg_png_and_webp(self):
        for raw, media_type in ((JPEG_BYTES, "image/jpeg"), (PNG_BYTES, "image/png"), (WEBP_BYTES, "image/webp")):
            with self.subTest(media_type):
                self.assertIsNone(self._errors(_image(raw, media_type)))

    def test_pillow_is_asked_to_open_only_the_declared_format(self):
        """防止日後有人把 formats= 拿掉：解碼器要在 Image.open 當下就鎖定，不能是解碼後才檢查格式。"""
        seen = []
        real_open = Image.open

        def spy(fp, mode="r", formats=None):
            seen.append(formats)
            return real_open(fp, mode, formats)

        with patch.object(Image, "open", spy):
            for raw, media_type, expected in (
                (JPEG_BYTES, "image/jpeg", ("JPEG",)), (PNG_BYTES, "image/png", ("PNG",)), (WEBP_BYTES, "image/webp", ("WEBP",)),
            ):
                seen.clear()
                self.assertIsNone(self._errors(_image(raw, media_type)))
                self.assertEqual(seen, [expected, expected])   # verify 與 load 各開一次

    def test_other_pillow_formats_with_a_forged_jpeg_header_are_rejected(self):
        """TIFF 檔頭在最前面、但宣告 jpeg：開頭標記先擋；標記對得上時 formats= 仍會讓其他解碼器完全不被呼叫。"""
        tiff = _encode("TIFF")
        self.assertIsNotNone(self._errors(_image(tiff, "image/jpeg")))
        self.assertIsNotNone(self._errors(_image(b"\xff\xd8\xff" + tiff, "image/jpeg")))

    def test_rejects_unsupported_formats_bad_base64_and_mismatched_content(self):
        cases = {
            "gif 不收": _image(b"GIF89a" + b"\x00" * 32, "image/gif"),
            "不是 base64": {"media_type": "image/jpeg", "data": "!!!not base64!!!"},
            "宣告 jpeg 實際是 png": _image(PNG_BYTES, "image/jpeg"),
            "webp 缺 WEBP 標記": _image(b"RIFF\x00\x00\x00\x00AVI " + b"\x00" * 32, "image/webp"),
            "空白": {"media_type": "image/jpeg", "data": ""},
            "只有檔頭標記沒有內容": _image(b"\xff\xd8\xff\xe0" + b"\x00" * 32, "image/jpeg"),
            "截斷的 png": _image(PNG_BYTES[: len(PNG_BYTES) // 2], "image/png"),
            "尺寸太小": _image(_encode("PNG", size=(4, 4)), "image/png"),
            "尺寸太大": _image(_encode("PNG", size=(8001, 20)), "image/png"),
            "截斷的 jpeg": _image(_encode("JPEG", size=(256, 256))[:-400], "image/jpeg"),
            "動態 png": _image(
                _encode("PNG", save_all=True, append_images=[Image.new("RGB", (64, 48), (0, 0, 0))]), "image/png"),
            "動態 webp": _image(_encode("WEBP", save_all=True, append_images=[Image.new("RGB", (64, 48))]), "image/webp"),
        }
        for name, payload in cases.items():
            with self.subTest(name):
                self.assertIsNotNone(self._errors(payload))

    def test_rejects_images_with_too_many_total_pixels(self):
        # 單邊都沒超過 8000，但 7000x7000 = 4900 萬像素，超過總像素上限
        self.assertIsNotNone(self._errors(_image(_encode("PNG", size=(7000, 7000)), "image/png")))

    def test_rejects_oversized_image(self):
        self.assertIsNotNone(self._errors(_image(JPEG_BYTES + b"\x00" * MAX_IMAGE_BYTES)))

    def test_rejects_data_urls_whitespace_and_mime_parameters(self):
        data = _b64(JPEG_BYTES)
        for name, payload in {
            "data URL 前綴": {"media_type": "image/jpeg", "data": f"data:image/jpeg;base64,{data}"},
            "含換行": {"media_type": "image/jpeg", "data": data[:20] + "\n" + data[20:]},
            "MIME 帶參數": {"media_type": "image/jpeg;charset=utf-8", "data": data},
            "大寫 MIME": {"media_type": "IMAGE/JPEG", "data": data},
        }.items():
            with self.subTest(name):
                self.assertIsNotNone(self._errors(payload))


class WithImageTest(TestCase):
    def test_image_goes_before_the_text_in_the_last_user_message_only(self):
        messages = [
            {"role": "user", "content": "之前的問題"},
            {"role": "assistant", "content": "之前的回答"},
            {"role": "user", "content": "這是什麼意思"},
        ]
        result = with_image(messages, _image())

        self.assertEqual(result[:2], messages[:2])
        blocks = result[2]["content"]
        self.assertEqual([b["type"] for b in blocks], ["image", "text"])
        self.assertEqual(blocks[0]["source"], {"type": "base64", **_image()})
        self.assertEqual(blocks[1]["text"], "這是什麼意思")
        self.assertEqual(messages[2]["content"], "這是什麼意思", "不改動傳入的訊息")

    def test_no_image_returns_messages_unchanged(self):
        messages = [{"role": "user", "content": "hi"}]
        self.assertIs(with_image(messages, None), messages)


class ImagePromptTest(TestCase):
    def test_image_rules_only_present_when_an_image_is_attached(self):
        import datetime
        today = datetime.date(2026, 1, 1)
        plain = system_text(build_chat_system("泰雅語", None, today, with_dictionary=True))
        with_img = system_text(build_chat_system("泰雅語", None, today, with_dictionary=True, with_image=True))
        self.assertNotIn("附了一張圖片", plain)
        self.assertIn("附了一張圖片", with_img)
        self.assertIn("辨識不確定", with_img)
        self.assertIn("一律不執行", with_img)


class ImageChatViewTest(TestCase):
    def setUp(self):
        self.http = Client()
        cache.clear()

    def _post(self, payload, url="/AIModel/tayal_chat/"):
        return self.http.post(url, data=json.dumps(payload), content_type="application/json")

    def _enable(self, enabled=True):
        FeatureFlag.objects.update_or_create(
            key=IMAGE_FLAG, defaults={"label": "AI 助手圖片提問", "description": "", "enabled": enabled})

    @patch("AIModel.views._get_client")
    def test_flag_missing_or_off_blocks_images_before_any_model_call_or_quota(self, mock_get_client):
        client = _mock_chat_client("不該被呼叫")
        mock_get_client.return_value = client

        for setup in (lambda: None, lambda: self._enable(False)):
            setup()
            response = self._post({"message": "這是什麼", "image": _image()})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["code"], "ai_image_input_disabled")

        client.messages.create.assert_not_called()

    def test_quota_endpoint_reports_whether_image_input_is_available(self):
        self.assertFalse(self.http.get("/AIModel/quota/").json()["features"]["imageInput"])
        self._enable()
        self.assertTrue(self.http.get("/AIModel/quota/").json()["features"]["imageInput"])
        FeatureFlag.objects.update_or_create(
            key="ai_assistant_enabled", defaults={"label": "AI 助手", "description": "", "enabled": False})
        self.assertFalse(self.http.get("/AIModel/quota/").json()["features"]["imageInput"])

    @patch("AIModel.views._get_client")
    def test_text_only_chat_is_unaffected_by_the_flag(self, mock_get_client):
        mock_get_client.return_value = _mock_chat_client("哈囉")
        self.assertEqual(self._post({"message": "hi"}).status_code, 200)

    @patch("AIModel.views._get_client")
    def test_invalid_image_is_a_400_even_when_enabled(self, mock_get_client):
        mock_get_client.return_value = _mock_chat_client("x")
        self._enable()
        response = self._post({"message": "這是什麼", "image": _image(PNG_BYTES, "image/jpeg")})
        self.assertEqual(response.status_code, 400)

    @patch("AIModel.views._get_client")
    def test_enabled_sends_image_then_text_and_skips_intent_routing(self, mock_get_client):
        client = _mock_chat_client("這是 lokah，辭典沒有收錄，辨識不確定。")
        mock_get_client.return_value = client
        self._enable()

        with patch("AIModel.services.choose_flow") as choose_flow:
            response = self._post({"message": "請辨識圖中的族語文字並說明", "image": _image()})

        self.assertEqual(response.status_code, 200)
        choose_flow.assert_not_called()
        _, kwargs = client.messages.create.call_args
        content = kwargs["messages"][-1]["content"]
        self.assertEqual([b["type"] for b in content], ["image", "text"])
        self.assertIn("附了一張圖片", system_text(kwargs["system"]))

    @patch("AIModel.views.memory_store.active_for", return_value=True)
    @patch("AIModel.views._get_client")
    def test_image_turns_never_get_the_memory_tool(self, mock_get_client, _active):
        # 圖片裡的文字不可信：附圖那一輪即使學生同意記憶，也不提供記憶工具（見 views._chat_kwargs）
        client = _mock_chat_client("ok")
        mock_get_client.return_value = client
        self._enable()

        self._post({"message": "這是什麼", "image": _image()})
        image_tools = client.messages.create.call_args.kwargs.get("tools") or []
        self.assertFalse([t for t in image_tools if t.get("name") == "memory"])

        self._post({"message": "這是什麼"})
        text_tools = client.messages.create.call_args.kwargs.get("tools") or []
        self.assertTrue([t for t in text_tools if t.get("name") == "memory"], "沒有圖片時記憶工具照常提供")

    @patch("AIModel.services.stream_claude")
    @patch("AIModel.views._get_client")
    def test_streaming_endpoint_gets_the_same_image_handling(self, mock_get_client, mock_stream):
        mock_get_client.return_value = _mock_chat_client("unused")

        def fake_stream(*_args, **_kwargs):
            yield "看到了"
            return SimpleNamespace(stop_reason="end_turn", content=[])

        mock_stream.side_effect = fake_stream
        stream_url = "/AIModel/tayal_chat/stream/"
        payload = {"message": "請辨識圖中的族語文字並說明", "image": _image()}

        disabled = self._post(payload, stream_url)
        self.assertEqual((disabled.status_code, disabled.json()["code"]), (403, "ai_image_input_disabled"))
        mock_stream.assert_not_called()

        self._enable()
        with patch("AIModel.services.choose_flow") as choose_flow:
            response = self._post(payload, stream_url)
            body = b"".join(response.streaming_content).decode("utf-8")
        choose_flow.assert_not_called()
        self.assertIn("event: done", body)
        content = mock_stream.call_args.kwargs["messages"][-1]["content"]
        self.assertEqual([b["type"] for b in content], ["image", "text"])
        self.assertIn("附了一張圖片", system_text(mock_stream.call_args.kwargs["system"]))

    @patch("AIModel.views._get_client")
    def test_image_requests_have_their_own_stricter_rate_limit(self, mock_get_client):
        mock_get_client.return_value = _mock_chat_client("ok")
        self._enable()
        statuses = [self._post({"message": "這是什麼", "image": _image()}).status_code for _ in range(6)]
        self.assertEqual(statuses[:5], [200] * 5)
        self.assertEqual(statuses[5], 429)
