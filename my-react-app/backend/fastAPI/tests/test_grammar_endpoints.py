"""端到端測試（用 TestClient 真的打 HTTP）：稽核修正第 5、6 項。

第 5 項：get_grammar／get_grammar_affixes／get_grammar_quiz_material 的
offset/limit 原本是裸的 int，沒有下限驗證，負值會用 Python 負索引切出
「總數正確、內容對不上頁碼」的錯誤結果，不會報錯。改用 Query(ge=...) 後
應該在進 handler 前就被 FastAPI 擋成 422。

第 6 項：get_grammar_affixes 的 affix_type 原本是完全沒有白名單限制的自由
字串，直接查詢也直接拿去當快取 key；改成白名單驗證後，不支援的值應該回 400。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from dictionary_db.connect import get_db


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with patch("fastAPI.routes.dictionary.grammar._load_grammar", return_value={"tribe": "泰雅語", "sections": []}), \
             patch("fastAPI.routes.dictionary.grammar._load_grammar_affixes", return_value={"tribe": "泰雅語", "affixes": []}), \
             patch("fastAPI.routes.dictionary.grammar._load_grammar_quiz_material", return_value={"tribe": "泰雅語", "rules": []}):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("path", [
    "/api/v1/dictionary/grammar/tayal",
    "/api/v1/dictionary/grammar/tayal/affixes",
    "/api/v1/dictionary/grammar/tayal/quiz",
])
class TestOffsetLimitLowerBound:
    def test_rejects_negative_offset(self, client, path):
        # 稽核報告的重現案例：offset=-1 原本會用負索引切出陣列最後一筆。
        response = client.get(path, params={"offset": -1})
        assert response.status_code == 422

    def test_rejects_zero_or_negative_limit(self, client, path):
        response = client.get(path, params={"limit": 0})
        assert response.status_code == 422
        response = client.get(path, params={"limit": -2})
        assert response.status_code == 422

    def test_accepts_non_negative_offset_and_positive_limit(self, client, path):
        response = client.get(path, params={"offset": 0, "limit": 5})
        assert response.status_code == 200


class TestAffixTypeWhitelist:
    def test_rejects_unsupported_affix_type(self, client):
        response = client.get(
            "/api/v1/dictionary/grammar/tayal/affixes",
            params={"affix_type": "".join(f"random-{i}" for i in range(3))},
        )
        assert response.status_code == 400

    @pytest.mark.parametrize("affix_type", [
        "prefix", "suffix", "infix", "circumfix", "reduplication", "auxiliary",
    ])
    def test_accepts_known_affix_types(self, client, affix_type):
        response = client.get(
            "/api/v1/dictionary/grammar/tayal/affixes",
            params={"affix_type": affix_type},
        )
        assert response.status_code == 200

    def test_omitted_affix_type_still_returns_all(self, client):
        response = client.get("/api/v1/dictionary/grammar/tayal/affixes")
        assert response.status_code == 200
