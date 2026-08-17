"""測試 main.py 新增的全域 Exception handler（P4 review BE-28）不會影響
兩種原本就有專屬 handler 的例外：

1. HTTPException——FastAPI 內建的 handler，端點自己 raise 的狀態碼／訊息
   要原封不動回傳，不能被新的全域 handler 蓋成通用的 500。
2. RateLimitExceeded——slowapi 在 main.py 註冊的專屬 handler，一樣要繼續
   回 429，不能被新的全域 handler 蓋掉。

Starlette 在組 middleware stack 時，把「Exception／500」註冊的 handler
放進最外層的 ServerErrorMiddleware，其餘（含 HTTPException／
RateLimitExceeded）留在內層的 ExceptionMiddleware——內層一律比外層先
攔到，這裡直接用行為驗證這個機制沒有被新 handler 意外蓋掉。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.rate_limit import limiter
from fastAPI.routes import auth as auth_module


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


def test_http_exception_from_route_is_not_overridden_by_global_handler(client):
    # analyze_image 沒收到 file 時會 raise HTTPException(400, "未收到圖片")，
    # 這裡確認狀態碼／detail 維持原樣，不會被全域 Exception handler 蓋成 500。
    response = client.post("/api/v1/vision/analyze_image/")
    assert response.status_code == 400
    assert response.json() == {"detail": "未收到圖片"}


def test_rate_limit_exceeded_still_returns_429_not_500(client):
    # 跟 test_grammar_endpoints.py 的 TestRateLimiting 同一套隔離手法：固定
    # get_configured_rate 直接回傳呼叫端預設值，避免依賴本機是否剛好有
    # Django server 在跑、規則被改過非預設值。
    limiter.reset()
    try:
        with patch(
            "fastAPI.rate_limit_config.get_configured_rate",
            side_effect=lambda key, default: default,
        ):
            for _ in range(10):
                # 沒帶 file 就會在進到限流計數之後、路由邏輯之前的最前面
                # 直接回 400——一樣會計入限流次數，不需要真的準備圖片。
                response = client.post("/api/v1/vision/analyze_image/")
                assert response.status_code == 400
            response = client.post("/api/v1/vision/analyze_image/")
        assert response.status_code == 429
    finally:
        limiter.reset()
