"""listening／sentence 題目端點的限流（稽核 AI-6）：原本是 FastAPI 路由裡唯一沒有 @limiter.limit 的兩支。

做法同 test_grammar_endpoints.py：用不支援的族語代碼讓端點在進入運算前就回 400（不需要資料庫），
連續打超過門檻應該回 429。get_configured_rate 固定成回傳預設值，不連 Django。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.rate_limit import limiter
from fastAPI.routes import auth as auth_module


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    limiter.reset()
    try:
        with patch("fastAPI.rate_limit_config.get_configured_rate", side_effect=lambda key, default: default):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()
        limiter.reset()


@pytest.mark.parametrize("path", ["/api/v1/listening/questions", "/api/v1/sentence/questions"])
def test_question_endpoints_are_rate_limited(client, path):
    for _ in range(30):
        assert client.get(path, params={"tribe": "not-a-tribe"}).status_code == 400
    assert client.get(path, params={"tribe": "not-a-tribe"}).status_code == 429

