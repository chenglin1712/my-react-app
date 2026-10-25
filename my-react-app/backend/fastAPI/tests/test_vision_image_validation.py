"""fastAPI/routes/vision.py 上傳圖片的格式白名單與尺寸檢查（S-03）。

Pillow 能開的格式很多，每一種都是一個解碼器，其中不少有記憶體損毀的已知漏洞。這裡驗證：
只有 JPEG／PNG／WebP 能走到解碼，其他格式（即使副檔名與 content-type 寫成 jpg）在打付費的
Google Vision API 之前就被擋下。
"""
import io
import struct
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes import vision as vision_module


async def _fake_auth():
    return {"uid": "test-user"}


def _image_bytes(fmt: str, size=(8, 8), **save_args) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buf, format=fmt, **save_args)
    return buf.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(vision_module, "CLOUD_API_URL", "https://vision.example.com/?key=")
    monkeypatch.setattr(vision_module, "CLOUD_API_KEY", "dummy-key")
    monkeypatch.setattr(vision_module, "translate_labels", lambda descriptions: {d: d for d in descriptions})
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        # 限流值固定放寬，否則同一個測試行程裡多個請求會撞到每分鐘 10 次的上限
        with patch("fastAPI.rate_limit_config.get_configured_rate", return_value="1000/minute"):
            with TestClient(app, raise_server_exceptions=False) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


def _post(client, content: bytes, name="photo.jpg", content_type="image/jpeg"):
    return client.post("/api/v1/vision/analyze_image/", files={"file": (name, content, content_type)})


def _google_ok():
    response = MagicMock()
    response.json.return_value = {"responses": [{"labelAnnotations": [{"description": "dog", "score": 0.9}]}]}
    mock_post = AsyncMock(return_value=response)
    return patch("httpx.AsyncClient.post", mock_post), mock_post


@pytest.mark.parametrize("fmt, save_args", [("JPEG", {}), ("PNG", {}), ("WEBP", {})])
def test_allowed_formats_pass_validation_and_reach_google(client, fmt, save_args):
    patcher, mock_post = _google_ok()
    with patcher:
        response = _post(client, _image_bytes(fmt, **save_args))
    assert response.status_code != 400
    assert mock_post.await_count == 1


@pytest.mark.parametrize("fmt", ["TIFF", "GIF", "BMP", "PPM", "ICO"])
def test_other_image_formats_are_rejected_even_when_named_jpg(client, fmt):
    patcher, mock_post = _google_ok()
    with patcher:
        response = _post(client, _image_bytes(fmt), name="photo.jpg", content_type="image/jpeg")
    assert response.status_code == 400
    assert "JPEG、PNG、WebP" in response.json()["detail"]
    assert mock_post.await_count == 0   # 沒有花到付費 API


def test_text_and_audio_disguised_as_images_are_rejected(client):
    patcher, mock_post = _google_ok()
    with patcher:
        assert _post(client, b"%PDF-1.4 not an image").status_code == 400
        assert _post(client, b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 40).status_code == 400
    assert mock_post.await_count == 0


def test_truncated_jpeg_is_a_clean_400_not_a_500(client):
    patcher, mock_post = _google_ok()
    good = _image_bytes("JPEG", size=(64, 64))
    with patcher:
        response = _post(client, good[: len(good) // 2])
    assert response.status_code == 400
    assert mock_post.await_count == 0


def test_tiny_file_declaring_a_huge_canvas_is_rejected_before_decoding(client):
    """PNG 檔頭宣告 20000x20000 像素、實際檔案只有幾十個位元組（解壓縮炸彈的形狀）。"""
    patcher, mock_post = _google_ok()
    real = _image_bytes("PNG", size=(8, 8))
    # IHDR 的寬、高在檔案第 16~24 個位元組；改寫後 CRC 不符，Pillow 在 open 階段只讀 IHDR，
    # 所以仍會回報宣告的尺寸，足夠驗證尺寸檢查在 verify 之前生效
    forged = real[:16] + struct.pack(">II", 20000, 20000) + real[24:]
    with patcher:
        response = _post(client, forged, name="bomb.png", content_type="image/png")
    assert response.status_code == 400
    assert mock_post.await_count == 0


def test_decompression_bomb_error_from_pillow_is_a_400(client):
    patcher, mock_post = _google_ok()
    with patcher, patch.object(Image, "open", side_effect=Image.DecompressionBombError("too big")):
        response = _post(client, _image_bytes("PNG"))
    assert response.status_code == 400 and "損毀或無法處理" in response.json()["detail"]
    assert mock_post.await_count == 0


def test_formats_are_locked_in_the_open_call_itself(client):
    """防止日後有人把 formats= 拿掉：白名單必須在 Image.open 當下生效，不能是解碼後才檢查。"""
    assert vision_module.ALLOWED_IMAGE_FORMATS == ("JPEG", "PNG", "WEBP")
    seen = {}
    real_open = Image.open

    def spy(fp, mode="r", formats=None):
        seen["formats"] = formats
        return real_open(fp, mode, formats)

    patcher, _ = _google_ok()
    with patcher, patch.object(Image, "open", spy):
        _post(client, _image_bytes("PNG"), name="a.png", content_type="image/png")
    assert seen["formats"] == ("JPEG", "PNG", "WEBP")
