"""測試 fastAPI/routes/vision.py 的 analyze_image 例外處理（稽核修正第 2 項）：
原本結尾的 except Exception as e: raise HTTPException(status_code=500, detail=str(e))
把原始例外訊息直接回給前端（可能洩漏 Google Vision 回應內容／內部細節），
而且完全沒有記 log。跟同一輪稽核的 search.py／grammar.py／audio_proxy.py
同一套做法：只記 log，回給前端的是通用訊息。
"""
import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes import vision as vision_module


async def _fake_auth():
    return {"uid": "test-user"}


def _fake_png_bytes() -> bytes:
    """analyze_image 在打 Google Vision 之前會先用 Pillow 本地驗證檔案內容
    是不是可解碼的圖片（見 vision.py 的說明），單純的假 bytes 會在打到
    httpx mock 之前就被這一關擋成 400，讓下面測的 500 遮罩行為根本沒被
    執行到。這裡改成真的組一張最小的 1x1 PNG，先通過本地驗證，才能繼續
    往下走到 httpx.AsyncClient.post 這一步。"""
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client():
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_analyze_image_masks_internal_exception_and_logs(client, monkeypatch):
    monkeypatch.setattr(vision_module, "CLOUD_API_URL", "https://vision.example.com/?key=")
    monkeypatch.setattr(vision_module, "CLOUD_API_KEY", "dummy-key")

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post, \
         patch.object(vision_module._logger, "exception") as mock_log:
        mock_post.side_effect = RuntimeError("internal detail: /secret/path leaked from google")

        response = client.post(
            "/api/v1/vision/analyze_image/",
            files={"file": ("test.png", _fake_png_bytes(), "image/png")},
        )

    assert response.status_code == 500
    assert response.json()["detail"] == "伺服器發生錯誤，請稍後再試"
    assert "internal detail" not in response.text
    assert "/secret/path" not in response.text
    # 原本這個 except 區塊完全沒有記 log；確認例外現在確實有被記錄下來。
    mock_log.assert_called_once()
