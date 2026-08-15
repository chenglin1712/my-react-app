"""端到端測試（TestClient 真的打 HTTP），比照 test_dictionary_endpoints.py 的
既有慣例：mock 掉 get_db／auth 依賴注入，以及 service.translate／
retrieve.get_all_capability_stats（避免依賴本機是否真的有 PostgreSQL）。
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.translation import retrieve as R
from fastAPI.routes.translation import service as S


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with patch("fastAPI.feature_flags.is_enabled", return_value=True), \
             patch("fastAPI.usage_events.record_event"):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


def _fake_result(**overrides):
    base = dict(
        direction="zh2tribe", tribe_full_name="泰雅語", tribe_slug="tayal",
        source_text="今天天氣很好", translation="blaq kayal nya' soni'.",
        match_type="exact_corpus", confidence="high", token_side="target",
        tokens=[S.TokenResult(surface="blaq", status="headword", gloss="好")],
        coverage=S.Coverage(total=1, headword=1, attested=0, derived=0, unsupported=0, corroborated_ratio=1.0),
        warning=None, evidence_sentences=[], evidence_words=[],
        notes="", model_used=None, elapsed_ms=5,
    )
    base.update(overrides)
    return S.TranslationResult(**base)


class TestTranslateEndpoint:
    def test_success_returns_200_with_expected_shape(self, client):
        with patch("fastAPI.routes.translation.api.service.translate", return_value=_fake_result()):
            resp = client.post("/api/v1/translation/translate",
                                json={"text": "今天天氣很好", "tribe": "tayal", "direction": "zh2tribe"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["matchType"] == "exact_corpus"
        assert body["tribeSlug"] == "tayal"
        assert body["tokens"][0]["status"] == "headword"

    def test_feature_flag_disabled_returns_403(self, client):
        with patch("fastAPI.feature_flags.is_enabled", return_value=False):
            resp = client.post("/api/v1/translation/translate",
                                json={"text": "hello", "tribe": "tayal", "direction": "zh2tribe"})
        assert resp.status_code == 403

    def test_unsupported_tribe_returns_400(self, client):
        with patch("fastAPI.routes.translation.api.service.translate",
                    side_effect=S.UnsupportedTribeError("不支援的族語：xx")):
            resp = client.post("/api/v1/translation/translate",
                                json={"text": "hello", "tribe": "xx", "direction": "zh2tribe"})
        assert resp.status_code == 400

    def test_missing_llm_token_returns_503(self, client):
        with patch("fastAPI.routes.translation.api.service.translate",
                    side_effect=EnvironmentError("GITHUB_TOKEN 未設定")):
            resp = client.post("/api/v1/translation/translate",
                                json={"text": "hello", "tribe": "tayal", "direction": "zh2tribe"})
        assert resp.status_code == 503

    def test_non_postgres_dialect_returns_503(self, client):
        with patch("fastAPI.routes.translation.api.service.translate",
                    side_effect=R.UnsupportedDialectError("需要 PostgreSQL")):
            resp = client.post("/api/v1/translation/translate",
                                json={"text": "hello", "tribe": "tayal", "direction": "zh2tribe"})
        assert resp.status_code == 503

    def test_unexpected_exception_returns_502_without_leaking_details(self, client):
        with patch("fastAPI.routes.translation.api.service.translate",
                    side_effect=RuntimeError("internal secret detail")):
            resp = client.post("/api/v1/translation/translate",
                                json={"text": "hello", "tribe": "tayal", "direction": "zh2tribe"})
        assert resp.status_code == 502
        assert "internal secret detail" not in resp.text

    def test_empty_text_rejected_by_validation(self, client):
        resp = client.post("/api/v1/translation/translate",
                            json={"text": "", "tribe": "tayal", "direction": "zh2tribe"})
        assert resp.status_code == 422

    def test_invalid_direction_rejected_by_validation(self, client):
        resp = client.post("/api/v1/translation/translate",
                            json={"text": "hello", "tribe": "tayal", "direction": "sideways"})
        assert resp.status_code == 422


class TestCapabilitiesEndpoint:
    def test_success(self, client):
        stats = {
            "tayal": {"pair_count": 8822, "headword_count": 6202, "has_sentence_audio": True},
            "amis": {"pair_count": 8587, "headword_count": 8809, "has_sentence_audio": False},
            "bunun": {"pair_count": 7192, "headword_count": 4927, "has_sentence_audio": False},
            "kavalan": {"pair_count": 10428, "headword_count": 7288, "has_sentence_audio": True},
            "paiwan": {"pair_count": 4093, "headword_count": 3458, "has_sentence_audio": False},
        }
        with patch("fastAPI.routes.translation.api.R.get_all_capability_stats", return_value=stats):
            resp = client.get("/api/v1/translation/capabilities")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["tribes"]) == 5
        tayal = next(t for t in body["tribes"] if t["tribeSlug"] == "tayal")
        assert tayal["hasSentenceAudio"] is True
        assert tayal["pairCount"] == 8822
