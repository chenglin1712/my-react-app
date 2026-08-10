"""端到端測試（用 TestClient 真的打 HTTP）：稽核修正第 5、6 項。

第 5 項：get_grammar／get_grammar_affixes／get_grammar_quiz_material 的
offset/limit 原本是裸的 int，沒有下限驗證，負值會用 Python 負索引切出
「總數正確、內容對不上頁碼」的錯誤結果，不會報錯。改用 Query(ge=...) 後
應該在進 handler 前就被 FastAPI 擋成 422。

第 6 項：get_grammar_affixes 的 affix_type 原本是完全沒有白名單限制的自由
字串，直接查詢也直接拿去當快取 key；改成白名單驗證後，不支援的值應該回 400。

（另一輪稽核）第 5 項：grammar.py 的 4 支端點原本完全沒有限流，這裡驗證
@limiter.limit(...) 真的有生效（連續打超過門檻會回 429），search_grammar
沒有走快取、每次都是全表掃描，門檻比其他 3 支端點更嚴格。
"""
from unittest.mock import MagicMock, patch

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


class TestRateLimiting:
    """這兩支測試驗證的是「@limiter.limit(...) 真的有生效」這個機制本身，
    不是限流值動態可調這件事（那個由 test_rate_limit_config_refresh.py
    專門覆蓋）——所以這裡把 rate_limit_config.get_configured_rate() 固定
    成直接回傳呼叫端傳入的預設值，等同「Django 連不上，退回寫死值」的
    情境。沒有這層隔離時，這兩支測試會真的對 127.0.0.1:8000 發 HTTP
    請求（見 rate_limit_config._refresh_if_stale），如果本機剛好有一個
    開發用的 Django server 在跑、且 RateLimitRule 表被後台改過非預設值
    （例如手動驗證時把這個 key 的限流調嚴），測試會用到那個外部、非預期
    的值而非文件裡寫的 20/minute，導致間歇性、環境相依的失敗——這是
    實際發生過的真實案例，不是假設情境。"""

    def test_get_grammar_rate_limited_after_60_calls(self, client):
        from fastAPI.rate_limit import limiter
        limiter.reset()
        try:
            with patch(
                "fastAPI.rate_limit_config.get_configured_rate",
                side_effect=lambda key, default: default,
            ):
                for _ in range(60):
                    response = client.get("/api/v1/dictionary/grammar/tayal")
                    assert response.status_code == 200
                response = client.get("/api/v1/dictionary/grammar/tayal")
            assert response.status_code == 429
        finally:
            limiter.reset()

    def test_search_grammar_rate_limited_after_20_calls(self):
        # search_grammar 沒有走快取、每次都是全表掃描，門檻比其他端點更嚴格
        # （20/minute）。它不經過 client fixture 已經 patch 的 _load_grammar_*，
        # 直接對 db 發 SQL，這裡另外給一個會回空結果的假 db。
        from fastAPI.rate_limit import limiter

        fake_db = MagicMock()
        fake_db.execute.return_value.fetchall.return_value = []

        def _fake_search_db():
            yield fake_db

        app.dependency_overrides[get_db] = _fake_search_db
        app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
        limiter.reset()
        try:
            with patch(
                "fastAPI.rate_limit_config.get_configured_rate",
                side_effect=lambda key, default: default,
            ):
                with TestClient(app) as search_client:
                    for _ in range(20):
                        response = search_client.get(
                            "/api/v1/dictionary/grammar/tayal/search", params={"q": "test"}
                        )
                        assert response.status_code == 200
                    response = search_client.get(
                        "/api/v1/dictionary/grammar/tayal/search", params={"q": "test"}
                    )
            assert response.status_code == 429
        finally:
            limiter.reset()
            app.dependency_overrides.clear()
