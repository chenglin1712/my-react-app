"""端到端測試：fastAPI/routes/crawler.py 的 /dictionary/ 端點原本
`except Exception as e: return JSONResponse({"detail": str(e)}, ...)` 直接把
原始例外訊息回給前端（可能洩漏爬蟲實作細節，例如目標網站結構、內部路徑等），
跟 dictionary.py 等其他端點稽核修正後的做法不一致。這裡驗證失敗時只回通用
訊息，例外內容只留在伺服器端的 log。
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
