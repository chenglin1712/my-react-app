"""訪客翻譯試用的端點行為（C-2）：身分判定、額度、失敗退還、已登入不受影響。

比照 test_translation_endpoint.py：mock 掉 get_db 與 service.translate，額度用記憶體 SQLite。
"""
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

from dictionary_db.connect import get_db
from fastAPI import guest_trial as G
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.translation import service as S
from fastAPI.tests.test_translation_endpoint import _fake_get_db, _fake_result

SECRET = "endpoint-test-secret-" + "abcdefghijklmnopqrstuvwxyz0123456789"
GUEST_ID = "guest-0123456789abcdef0123"
BODY = {"tribe": "tayal", "direction": "zh2tribe", "text": "你好"}
GUEST_HEADERS = {"X-Guest-Id": GUEST_ID}


@pytest.fixture
def env(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    G._metadata.create_all(engine)
    monkeypatch.setattr(G, "_engine", engine)
    monkeypatch.setattr(G, "_PURGE_PROBABILITY", 0)
    monkeypatch.setenv("GUEST_TRIAL_SECRET", SECRET)
    monkeypatch.delenv("GUEST_TRIAL_DAILY_LIMIT", raising=False)
    monkeypatch.delenv("GUEST_TRIAL_IP_DAILY_LIMIT", raising=False)
    monkeypatch.setattr(auth_module, "_auth_dev_bypass", lambda: False)
    return engine


@pytest.fixture
def flags(monkeypatch):
    """translation_enabled 與 guest_translation_enabled 的開關狀態（預設都開）。"""
    state = {"translation_enabled": True, "guest_translation_enabled": True}

    def fake_is_enabled(key, default=True):
        return state.get(key, default)

    monkeypatch.setattr("fastAPI.feature_flags.is_enabled", fake_is_enabled)
    monkeypatch.setattr(
        "fastAPI.feature_flags.is_enabled_fail_closed", lambda key: state.get(key, False),
    )
    return state


@pytest.fixture
def client(env, flags):
    app.dependency_overrides[get_db] = _fake_get_db
    try:
        with patch("fastAPI.usage_events.record_event"), \
             patch("fastAPI.rate_limit_config.get_configured_rate", return_value="1000/minute"):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


def _ok():
    return patch.object(S, "translate", return_value=_fake_result())


def test_request_without_credentials_or_guest_id_is_401(client):
    assert client.post("/api/v1/translation/translate", json=BODY).status_code == 401


def test_guest_can_translate_and_sees_remaining_count(client):
    with _ok():
        response = client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS)
    assert response.status_code == 200
    quota = response.json()["guestQuota"]
    assert quota["limit"] == 10 and quota["remaining"] == 9
    assert quota["resetsAt"].endswith("+08:00")


def test_eleventh_guest_request_is_blocked_with_machine_readable_code(client):
    with _ok() as translate:
        for _ in range(10):
            assert client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS).status_code == 200
        blocked = client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS)
    assert blocked.status_code == 429
    data = blocked.json()
    assert data["code"] == "guest_quota_exhausted" and data["limit"] == 10 and "登入" in data["detail"]
    assert translate.call_count == 10  # 第 11 次完全沒有呼叫 LLM


def test_ip_cap_returns_its_own_code(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_DAILY_LIMIT", "1")
    with _ok():
        assert client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS).status_code == 200
        other = client.post(
            "/api/v1/translation/translate", json=BODY, headers={"X-Guest-Id": "guest-other-0123456789ab"},
        )
    assert other.status_code == 429 and other.json()["code"] == "guest_ip_capped"


def test_guest_flag_off_means_401_as_before(client, flags):
    flags["guest_translation_enabled"] = False
    assert client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS).status_code == 401


def test_guest_flag_defaults_to_closed_when_row_is_missing(client, flags):
    del flags["guest_translation_enabled"]  # fake_is_enabled 會回傳呼叫端給的 default（訪客旗標的 default 是 False）
    assert client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS).status_code == 401


def test_invalid_guest_id_is_401(client):
    for bad in ("short", "has space in it 0123456789", "<script>alert(1)</script>"):
        assert client.post("/api/v1/translation/translate", json=BODY, headers={"X-Guest-Id": bad}).status_code == 401


def test_missing_secret_means_guest_trial_is_off(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_SECRET", "")
    assert client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS).status_code == 401


def test_translation_kill_switch_still_applies_to_guests(client, flags):
    flags["translation_enabled"] = False
    response = client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS)
    assert response.status_code == 403
    assert G.status(GUEST_ID).remaining == 10  # 被總開關擋下時不扣次數


def test_failures_before_the_paid_llm_call_refund_the_guest_quota(client):
    for error, status in (
        (S.UnsupportedTribeError("不支援"), 400),
        (S.UnsupportedDirectionError("不支援"), 400),
        (EnvironmentError("ANTHROPIC_API_KEY 未設定"), 503),
    ):
        with patch.object(S, "translate", side_effect=error):
            assert client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS).status_code == status
        assert G.status(GUEST_ID).remaining == 10


def test_failure_after_a_possibly_billed_llm_call_does_not_refund(client):
    """LLM 可能已經計費的失敗不退還，否則反覆觸發就能不耗額度地呼叫付費 LLM。"""
    with patch.object(S, "translate", side_effect=RuntimeError("post-processing exploded")):
        failed = client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS)
    assert failed.status_code == 502
    assert G.status(GUEST_ID).remaining == 9


def test_validation_error_does_not_consume_quota(client):
    response = client.post("/api/v1/translation/translate", json={**BODY, "text": ""}, headers=GUEST_HEADERS)
    assert response.status_code == 422
    assert G.status(GUEST_ID).remaining == 10


def test_guest_quota_endpoint_reports_without_consuming(client):
    first = client.get("/api/v1/translation/guest-quota", headers=GUEST_HEADERS).json()
    assert first == {"isGuest": True, "limit": 10, "remaining": 10, "resetsAt": first["resetsAt"]}
    with _ok():
        client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS)
    assert client.get("/api/v1/translation/guest-quota", headers=GUEST_HEADERS).json()["remaining"] == 9
    assert client.get("/api/v1/translation/guest-quota", headers=GUEST_HEADERS).json()["remaining"] == 9


def test_logged_in_user_is_unaffected_and_uses_no_guest_quota(client, monkeypatch):
    async def fake_verify(request, authorization=None):
        request.state.user = {"uid": "real-user"}
        return request.state.user

    monkeypatch.setattr(auth_module, "verify_firebase_token", fake_verify)
    headers = {"Authorization": "Bearer valid-token", **GUEST_HEADERS}
    with _ok():
        for _ in range(12):  # 超過訪客上限也不受影響
            response = client.post("/api/v1/translation/translate", json=BODY, headers=headers)
            assert response.status_code == 200
            assert response.json()["guestQuota"] is None
    assert client.get("/api/v1/translation/guest-quota", headers=headers).json() == {
        "isGuest": False, "limit": None, "remaining": None, "resetsAt": None,
    }
    with G._engine.connect() as conn:
        assert conn.execute(select(G._usage_table)).fetchall() == []


def test_invalid_token_is_401_and_never_falls_back_to_guest(client, monkeypatch):
    async def reject(request, authorization=None):
        raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")

    monkeypatch.setattr(auth_module, "verify_firebase_token", reject)
    response = client.post(
        "/api/v1/translation/translate", json=BODY, headers={"Authorization": "Bearer expired", **GUEST_HEADERS},
    )
    assert response.status_code == 401
    assert G.status(GUEST_ID).remaining == 10


def test_no_database_means_guest_trial_is_off(client, monkeypatch):
    monkeypatch.setattr(G, "_engine", None)
    response = client.post("/api/v1/translation/translate", json=BODY, headers=GUEST_HEADERS)
    assert response.status_code == 401  # is_ready() 為假：回到原本的「需要登入」


def test_other_routers_still_require_login_for_guests(client):
    assert client.get("/api/v1/sentence/questions", headers=GUEST_HEADERS).status_code == 401
    assert client.get("/api/v1/listening/questions", headers=GUEST_HEADERS).status_code == 401
