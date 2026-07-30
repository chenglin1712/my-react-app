"""端到端測試：fastAPI/routes/crawler.py 的 /dictionary/ 端點原本
`except Exception as e: return JSONResponse({"detail": str(e)}, ...)` 直接把
原始例外訊息回給前端（可能洩漏爬蟲實作細節，例如目標網站結構、內部路徑等），
跟 dictionary.py 等其他端點稽核修正後的做法不一致。這裡驗證失敗時只回通用
訊息，例外內容只留在伺服器端的 log。

同一輪稽核修正第 4 項：words 陣列原本沒有長度上限，每個字都會對外部
ILRDF 網站發 2 次請求，也完全沒有限流，帶一個超大陣列就能對外部站發起放大
請求；這裡驗證數量上限與限流是否真的生效。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
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


def test_query_failure_does_not_leak_exception_message(client):
    with patch("fastAPI.routes.crawler.query", side_effect=RuntimeError("internal scraper detail")):
        response = client.post("/api/v1/crawler/dictionary/", json={"words": ["balay"]})

    assert response.status_code == 500
    body = response.json()
    assert "internal scraper detail" not in str(body)
    assert body == {"detail": "伺服器發生錯誤，請稍後再試"}


def test_empty_words_returns_400(client):
    response = client.post("/api/v1/crawler/dictionary/", json={"words": []})
    assert response.status_code == 400


def test_successful_query_returns_definitions(client):
    with patch("fastAPI.routes.crawler.query", return_value={"word_tayal": "balay"}):
        response = client.post("/api/v1/crawler/dictionary/", json={"words": ["balay"]})

    assert response.status_code == 200
    assert response.json() == {"definitions": {"balay": {"word_tayal": "balay"}}}


def test_words_over_cap_rejected_without_querying(client):
    with patch("fastAPI.routes.crawler.query") as mock_query:
        response = client.post("/api/v1/crawler/dictionary/", json={"words": ["w"] * 21})

    assert response.status_code == 400
    # 超過上限要在對外部站發任何請求之前就被擋下來，不能先查了一部分才拒絕。
    mock_query.assert_not_called()


def test_words_at_cap_is_allowed(client):
    with patch("fastAPI.routes.crawler.query", return_value={}):
        response = client.post("/api/v1/crawler/dictionary/", json={"words": ["w"] * 20})
    assert response.status_code == 200


def test_exceeding_rate_limit_returns_429(client):
    from fastAPI.rate_limit import limiter
    limiter.reset()
    try:
        with patch("fastAPI.routes.crawler.query", return_value={}):
            for _ in range(10):
                response = client.post("/api/v1/crawler/dictionary/", json={"words": ["balay"]})
                assert response.status_code == 200
            response = client.post("/api/v1/crawler/dictionary/", json={"words": ["balay"]})
        assert response.status_code == 429
    finally:
        limiter.reset()
