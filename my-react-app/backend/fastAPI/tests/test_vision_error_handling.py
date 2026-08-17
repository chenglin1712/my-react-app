"""測試 fastAPI/routes/vision.py 的 analyze_image 例外處理（稽核修正第 2 項，
P4 review BE-28 之後更新）：原本結尾的
`except Exception as e: raise HTTPException(status_code=500, detail=str(e))`
把原始例外訊息直接回給前端（可能洩漏 Google Vision 回應內容／內部細節），
而且完全沒有記 log。

BE-28 把這段「log + 回通用訊息」的收尾從 vision.py 本身搬到 main.py 註冊的
全域 Exception handler（見 main.py 的 `_unhandled_exception_handler`）——
analyze_image 現在不再自己攔截這個例外，讓它往外傳到全域 handler。這裡改
用 `raise_server_exceptions=False` 的 TestClient（否則 Starlette 的
ServerErrorMiddleware 送出回應後還是會把原始例外往外重新拋出，讓測試本身
炸掉而不是能對回應內容斷言），並改為監看 main.py 的 `logger.exception`。
"""
import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fastAPI import main as main_module
from fastAPI.main import app
from fastAPI.routes import auth as auth_module


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
        with TestClient(app, raise_server_exceptions=False) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_analyze_image_masks_internal_exception_and_logs(client, monkeypatch):
    from fastAPI.routes import vision as vision_module

    monkeypatch.setattr(vision_module, "CLOUD_API_URL", "https://vision.example.com/?key=")
    monkeypatch.setattr(vision_module, "CLOUD_API_KEY", "dummy-key")

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post, \
         patch.object(main_module, "logger") as mock_logger:
        mock_post.side_effect = RuntimeError("internal detail: /secret/path leaked from google")

        response = client.post(
            "/api/v1/vision/analyze_image/",
            files={"file": ("test.png", _fake_png_bytes(), "image/png")},
        )

    assert response.status_code == 500
    assert response.json()["detail"] == "伺服器發生錯誤，請稍後再試"
    assert "internal detail" not in response.text
    assert "/secret/path" not in response.text
    # 原本這個 except 區塊完全沒有記 log；確認例外現在確實有被全域 handler 記錄下來。
    mock_logger.exception.assert_called_once()
