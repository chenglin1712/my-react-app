"""multipart 表單解析上限（S-04）：視覺辨識與發音比對端點。

Starlette 預設接受 1000 個欄位／1000 個檔案，而且 FastAPI 的 File(...)／Form(...) 宣告沒辦法調整。
這裡驗證兩個端點改成手動解析後：欄位數、檔案數、文字欄位大小超限時在解析階段就被擋下
（還沒碰到後面的圖片／音檔處理），而正常請求的行為不變。
"""
import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fastAPI.form_limits import MAX_TEXT_FIELD_BYTES
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes import vision as vision_module
from fastAPI.routes.pronunciation import api as pronunciation_api
from fastAPI.routes.pronunciation import model as pronunciation_model

VISION_URL = "/api/v1/vision/analyze_image/"
COMPARE_URL = "/api/v1/quiz/compare_audio/"


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(vision_module, "CLOUD_API_URL", "https://vision.example.com/?key=")
    monkeypatch.setattr(vision_module, "CLOUD_API_KEY", "dummy-key")
    monkeypatch.setattr(vision_module, "translate_labels", lambda descriptions: {d: d for d in descriptions})
    monkeypatch.setattr(pronunciation_model, "_ffmpeg_path", "/fake/ffmpeg")
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        # 限流值固定放寬，否則同一個測試行程裡多個請求會撞到每分鐘的上限
        with patch("fastAPI.rate_limit_config.get_configured_rate", return_value="1000/minute"):
            with TestClient(app, raise_server_exceptions=False) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _google_ok():
    response = MagicMock()
    response.json.return_value = {"responses": [{"labelAnnotations": [{"description": "dog", "score": 0.9}]}]}
    mock_post = AsyncMock(return_value=response)
    return patch("httpx.AsyncClient.post", mock_post), mock_post


# ---------- 視覺辨識 ----------

def test_vision_normal_upload_still_works(client):
    patcher, mock_post = _google_ok()
    with patcher:
        response = client.post(VISION_URL, files={"file": ("a.png", _png(), "image/png")})
    assert response.status_code == 200
    mock_post.assert_awaited_once()


def test_vision_rejects_too_many_text_fields_before_any_processing(client):
    patcher, mock_post = _google_ok()
    data = {f"extra{i}": "x" for i in range(5)}
    with patcher:
        response = client.post(VISION_URL, files={"file": ("a.png", _png(), "image/png")}, data=data)
    assert response.status_code == 400
    mock_post.assert_not_awaited()


def test_vision_rejects_more_than_one_file(client):
    patcher, mock_post = _google_ok()
    files = [("file", ("a.png", _png(), "image/png")), ("file", ("b.png", _png(), "image/png"))]
    with patcher:
        response = client.post(VISION_URL, files=files)
    assert response.status_code == 400
    mock_post.assert_not_awaited()


def test_vision_file_sent_as_plain_text_is_400_not_500(client):
    response = client.post(VISION_URL, data={"file": "not-a-file"}, files={"dummy": ("d.txt", b"x", "text/plain")})
    assert response.status_code == 400


def test_vision_oversized_upload_is_413_and_reads_at_most_limit_plus_one(client, monkeypatch):
    monkeypatch.setattr(vision_module, "MAX_IMAGE_BYTES", 1024)
    patcher, mock_post = _google_ok()
    with patcher:
        response = client.post(VISION_URL, files={"file": ("big.png", b"\x89PNG" + b"0" * 5000, "image/png")})
    assert response.status_code == 413
    mock_post.assert_not_awaited()


def test_vision_rejects_even_one_unexpected_text_field(client):
    patcher, mock_post = _google_ok()
    with patcher:
        response = client.post(
            VISION_URL, files={"file": ("a.png", _png(), "image/png")}, data={"extra": "x"},
        )
    assert response.status_code == 400
    mock_post.assert_not_awaited()


# ---------- 發音比對 ----------

def _audio_files(count=1):
    return [("user_audio", ("speech.webm", io.BytesIO(b"fake-audio"), "audio/webm")) for _ in range(count)]


def test_compare_audio_missing_audio_id_is_422(client):
    response = client.post(COMPARE_URL, files=_audio_files())
    assert response.status_code == 422


def test_compare_audio_missing_audio_file_is_422(client):
    response = client.post(COMPARE_URL, data={"audio_id": "abc"}, files={"dummy": ("d.txt", b"x", "text/plain")})
    assert response.status_code == 422


def test_compare_audio_audio_sent_as_plain_text_is_422(client):
    response = client.post(
        COMPARE_URL,
        data={"audio_id": "abc", "user_audio": "not-a-file"},
        files={"dummy": ("d.txt", b"x", "text/plain")},
    )
    assert response.status_code == 422


def test_compare_audio_text_field_sent_as_file_is_rejected(client):
    # reference_urls／audio_id 被當成檔案送：唯一的檔案名額已被 user_audio 用掉，解析階段就是 400
    response = client.post(
        COMPARE_URL,
        files=[
            ("user_audio", ("speech.webm", io.BytesIO(b"x"), "audio/webm")),
            ("reference_urls", ("u.txt", io.BytesIO(b"https://x"), "text/plain")),
        ],
        data={"audio_id": "abc"},
    )
    assert response.status_code == 400


def test_compare_audio_rejects_too_many_fields_before_processing(client):
    data = {"audio_id": "abc", "reference_urls": "", "extra": "x"}
    with patch.object(pronunciation_api, "convert_to_wav") as convert:
        response = client.post(COMPARE_URL, data=data, files=_audio_files())
    assert response.status_code == 400
    convert.assert_not_called()


def test_compare_audio_rejects_more_than_one_file(client):
    with patch.object(pronunciation_api, "convert_to_wav") as convert:
        response = client.post(COMPARE_URL, data={"audio_id": "abc"}, files=_audio_files(2))
    assert response.status_code == 400
    convert.assert_not_called()


def test_compare_audio_rejects_oversized_text_field(client):
    data = {"audio_id": "abc", "reference_urls": "x" * (MAX_TEXT_FIELD_BYTES + 1)}
    with patch.object(pronunciation_api, "convert_to_wav") as convert:
        response = client.post(COMPARE_URL, data=data, files=_audio_files())
    assert response.status_code == 400
    convert.assert_not_called()


def test_compare_audio_oversized_audio_keeps_app_level_failure_convention(client, monkeypatch):
    """超大音檔仍是「HTTP 200 + success:false」（前端 sentenceSpeak.jsx 依賴這個約定），且不進轉檔。"""
    monkeypatch.setattr(pronunciation_api.game_config, "PRONUNCIATION_MAX_AUDIO_MB", 0)
    with patch.object(pronunciation_api.game_config, "refresh_game_config_if_stale"), \
         patch.object(pronunciation_api, "convert_to_wav") as convert:
        response = client.post(COMPARE_URL, data={"audio_id": "abc"}, files=_audio_files())
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["error_step"] == "file_too_large"
    convert.assert_not_called()


# ---------- 暫存檔關閉與 API 文件 ----------

@pytest.fixture
def close_calls(monkeypatch):
    """記錄 FormData.close 被呼叫的次數（手動解析表單要自己關暫存檔），並照常執行原本的關閉。"""
    from starlette.datastructures import FormData

    original = FormData.close
    calls = []

    async def spy(self):
        calls.append(1)
        await original(self)

    monkeypatch.setattr(FormData, "close", spy)
    return calls


def test_vision_closes_form_on_success_and_on_error(client, close_calls, monkeypatch):
    patcher, _ = _google_ok()
    with patcher:
        assert client.post(VISION_URL, files={"file": ("a.png", _png(), "image/png")}).status_code == 200
    assert len(close_calls) == 1

    monkeypatch.setattr(vision_module, "MAX_IMAGE_BYTES", 16)
    assert client.post(VISION_URL, files={"file": ("a.png", _png(), "image/png")}).status_code == 413
    assert len(close_calls) == 2


def test_compare_audio_closes_form_on_validation_error_and_app_level_failure(client, close_calls, monkeypatch):
    assert client.post(COMPARE_URL, files=_audio_files()).status_code == 422   # 缺 audio_id
    assert len(close_calls) == 1

    monkeypatch.setattr(pronunciation_api.game_config, "PRONUNCIATION_MAX_AUDIO_MB", 0)
    with patch.object(pronunciation_api.game_config, "refresh_game_config_if_stale"):
        response = client.post(COMPARE_URL, data={"audio_id": "abc"}, files=_audio_files())
    assert response.json()["error_step"] == "file_too_large"
    assert len(close_calls) == 2


def test_openapi_documents_the_multipart_fields_even_though_parsing_is_manual():
    paths = app.openapi()["paths"]
    for path, expected in (
        (VISION_URL, {"file"}),
        (COMPARE_URL, {"user_audio", "audio_id", "reference_urls"}),
    ):
        post = next(op for p, ops in paths.items() if p.endswith(path.removeprefix("/api/v1")) for op in [ops["post"]])
        schema = post["requestBody"]["content"]["multipart/form-data"]["schema"]
        assert set(schema["properties"]) == expected
