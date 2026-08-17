"""測試 fastAPI/routes/pronunciation/api.py 的 compare_audio 例外處理
（P4 review BE-28）：原本每個步驟的 except Exception as e 都把 str(e)
原封不動放進回給前端的 error 欄位，可能洩漏檔案路徑、底層函式庫例外訊息
等內部細節，跟同一輪稽核的 vision.py／dictionary/search.py「只記 log，
回前端通用訊息」的原則不一致。

compare_audio 本身的「HTTP 200 + success:false」約定刻意保留不動——前端
frontend/components/_quiz_questions/sentenceSpeak.jsx 明確依賴這個約定，
見 pronunciation/api.py 的說明——這裡只驗證 error 欄位不再洩漏例外內容、
且真正的例外確實有被記錄下來。
"""
import io
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.pronunciation import api as pronunciation_api
from fastAPI.routes.pronunciation import model as pronunciation_model


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _post_compare_audio(client, **extra_form):
    return client.post(
        "/api/v1/quiz/compare_audio/",
        files={"user_audio": ("speech.webm", io.BytesIO(b"fake-audio-bytes"), "audio/webm")},
        data={"audio_id": "test_audio_1", **extra_form},
    )


def test_user_embedding_failure_masks_internal_exception_and_logs(client, monkeypatch):
    monkeypatch.setattr(pronunciation_model, "_ffmpeg_path", "/fake/ffmpeg")

    with patch.object(pronunciation_api, "convert_to_wav", return_value=b"fake-wav-bytes"), \
         patch.object(pronunciation_api, "bytes_to_tensor", return_value=("fake-wave", 16000)), \
         patch.object(
             pronunciation_api, "get_wav2vec2",
             side_effect=RuntimeError("internal detail: /secret/model/checkpoint.pt not found"),
         ), \
         patch.object(pronunciation_api._logger, "exception") as mock_log:
        response = _post_compare_audio(client)

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["error_step"] == "user_embedding"
    assert body["error"] == "語音特徵擷取失敗，請稍後再試"
    assert "internal detail" not in response.text
    assert "/secret/model/checkpoint.pt" not in response.text
    mock_log.assert_called_once()


def test_unexpected_failure_outside_named_steps_masks_internal_exception_and_logs(client, monkeypatch):
    """Step E 組裝最終回應時發生非預期例外（不屬於任一具名步驟），要落到
    最外層的 except Exception，一樣不能把例外內容洩漏到 error 欄位。"""
    monkeypatch.setattr(pronunciation_model, "_ffmpeg_path", "/fake/ffmpeg")
    monkeypatch.setattr(pronunciation_api.game_config, "PRONUNCIATION_PASS_THRESHOLD", "not_a_number")

    with patch.object(pronunciation_api, "convert_to_wav", return_value=b"fake-wav-bytes"), \
         patch.object(pronunciation_api, "bytes_to_tensor", return_value=("fake-wave", 16000)), \
         patch.object(pronunciation_api, "get_wav2vec2", return_value="fake-model"), \
         patch.object(pronunciation_api, "_get_embedding", return_value="fake-embedding"), \
         patch.object(pronunciation_api, "fetch_audio_from_id", return_value=b"fake-target-bytes"), \
         patch.object(pronunciation_api, "_score_from_bytes", return_value=0.9), \
         patch.object(pronunciation_api._logger, "exception") as mock_log:
        response = _post_compare_audio(client)

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["error_step"] == "unknown_error"
    assert body["error"] == "評分過程發生未預期的錯誤，請稍後再試"
    assert "not_a_number" not in response.text
    mock_log.assert_called_once()
