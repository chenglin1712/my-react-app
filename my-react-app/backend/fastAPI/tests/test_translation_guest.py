"""訪客翻譯試用的端點行為（C-2）：身分判定、額度、失敗退還、已登入不受影響。

比照 test_translation_endpoint.py：mock 掉 get_db 與 service.translate，額度用記憶體 SQLite。
"""
from datetime import datetime, timedelta, timezone
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


def _guest_headers(guest_id=GUEST_ID):
    """訪客憑證要用 GUEST_TRIAL_SECRET 簽章，密鑰由 env fixture 設定，所以在測試內才產生。"""
    return {"X-Guest-Token": G._build_token(guest_id, datetime.now(timezone.utc)).token}


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
        response = client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    assert response.status_code == 200
    quota = response.json()["guestQuota"]
    assert quota["limit"] == 10 and quota["remaining"] == 9
    assert quota["resetsAt"].endswith("+08:00")


def test_eleventh_guest_request_is_blocked_with_machine_readable_code(client):
    with _ok() as translate:
        for _ in range(10):
            assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 200
        blocked = client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    assert blocked.status_code == 429
    data = blocked.json()
    assert data["code"] == "guest_quota_exhausted" and data["limit"] == 10 and "登入" in data["detail"]
    assert translate.call_count == 10  # 第 11 次完全沒有呼叫 LLM


def test_ip_cap_returns_its_own_code(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_DAILY_LIMIT", "1")
    with _ok():
        assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 200
        other = client.post(
            "/api/v1/translation/translate", json=BODY, headers=_guest_headers("guest-other-0123456789ab"),
        )
    assert other.status_code == 429 and other.json()["code"] == "guest_ip_capped"


def test_guest_flag_off_means_401_as_before(client, flags):
    flags["guest_translation_enabled"] = False
    assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 401


def test_guest_flag_defaults_to_closed_when_row_is_missing(client, flags):
    del flags["guest_translation_enabled"]  # fake_is_enabled 會回傳呼叫端給的 default（訪客旗標的 default 是 False）
    assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 401


def test_self_made_guest_id_header_is_rejected_and_the_front_end_is_told_to_get_a_token(client):
    """舊版前端自己產生代號放在 X-Guest-Id：現在完全不被接受，也不會建立任何計次資料列。"""
    response = client.post("/api/v1/translation/translate", json=BODY, headers={"X-Guest-Id": GUEST_ID})
    assert response.status_code == 401 and response.json()["code"] == "guest_token_invalid"
    with G._engine.connect() as conn:
        assert conn.execute(select(G._usage_table)).fetchall() == []


def test_bad_tokens_are_401_with_the_machine_readable_code(client):
    good = _guest_headers()["X-Guest-Token"]
    version, guest_id, exp, signature = good.split(".")
    expired = G._build_token(GUEST_ID, datetime.now(timezone.utc) - G.TOKEN_TTL - timedelta(seconds=5)).token
    bad_tokens = [
        "short", "has space in it 0123456789", "<script>alert(1)</script>", "",
        f"{version}.{guest_id}.{exp}.{'0' * 32}",                 # 簽章不符
        f"{version}.{guest_id}.{int(exp) + 10}.{signature}",       # 改了到期時間
        f"{version}.other-id-0123456789abcdef.{exp}.{signature}",  # 換了代號
        f"g2.{guest_id}.{exp}.{signature}",                        # 版本不符
        f"{good}.extra",                                           # 多一段
        f"{version}.{guest_id}.{exp}.{signature.upper()}",         # 簽章大小寫不符
        expired,                                                   # 已過期
        good + "x" * 200,                                          # 過長
    ]
    for bad in bad_tokens:
        response = client.post("/api/v1/translation/translate", json=BODY, headers={"X-Guest-Token": bad})
        assert response.status_code == 401, bad
        assert response.json().get("code") == "guest_token_invalid", bad


def test_token_signed_with_the_previous_key_is_still_accepted_during_rotation(client, monkeypatch):
    old_secret = "previous-token-secret-" + "abcdefghijklmnopqrstuvwxyz012345"
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET", old_secret)
    old_token = G._build_token(GUEST_ID, datetime.now(timezone.utc)).token
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET", "rotated-token-secret-" + "abcdefghijklmnopqrstuvwxyz0123")
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET_PREVIOUS", old_secret)
    with _ok():
        assert client.post("/api/v1/translation/translate", json=BODY, headers={"X-Guest-Token": old_token}).status_code == 200
    monkeypatch.delenv("GUEST_TRIAL_TOKEN_SECRET_PREVIOUS")
    assert client.post("/api/v1/translation/translate", json=BODY, headers={"X-Guest-Token": old_token}).status_code == 401


def test_rotating_the_token_secret_does_not_reset_todays_quota(client, monkeypatch):
    """簽章金鑰與計次用的雜湊金鑰分開：換簽章金鑰只讓舊憑證失效，已經用掉的次數仍然記著。"""
    with _ok():
        client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET", "brand-new-token-secret-" + "abcdefghijklmnopqrstuvwxyz01")
    assert G.status(GUEST_ID).remaining == 9


def test_guest_token_endpoint_issues_a_token_that_works_for_translation(client):
    response = client.post("/api/v1/translation/guest-token")  # 沒帶任何憑證
    assert response.status_code == 200
    data = response.json()
    assert data["token"].startswith("g1.") and data["expiresAt"]
    with _ok():
        translated = client.post("/api/v1/translation/translate", json=BODY, headers={"X-Guest-Token": data["token"]})
    assert translated.status_code == 200 and translated.json()["guestQuota"]["remaining"] == 9


def test_every_new_token_gets_a_different_guest_id(client):
    first = client.post("/api/v1/translation/guest-token").json()["token"]
    second = client.post("/api/v1/translation/guest-token").json()["token"]
    assert first.split(".")[1] != second.split(".")[1]


def test_issue_cap_stops_a_network_from_minting_unlimited_identities(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_ISSUE_DAILY_LIMIT", "2")
    assert client.post("/api/v1/translation/guest-token").status_code == 200
    assert client.post("/api/v1/translation/guest-token").status_code == 200
    capped = client.post("/api/v1/translation/guest-token")
    assert capped.status_code == 429 and capped.json()["code"] == "guest_issue_capped"


def test_renewing_a_valid_token_keeps_the_guest_id_and_does_not_use_the_issue_cap(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_ISSUE_DAILY_LIMIT", "1")
    first = client.post("/api/v1/translation/guest-token").json()["token"]
    for _ in range(3):  # 核發額度只有 1 張，續期不受影響
        renewed = client.post("/api/v1/translation/guest-token", headers={"X-Guest-Token": first})
        assert renewed.status_code == 200
        assert renewed.json()["token"].split(".")[1] == first.split(".")[1]


def test_an_expired_token_cannot_be_renewed_and_counts_as_a_new_issue(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_ISSUE_DAILY_LIMIT", "1")
    expired = G._build_token(GUEST_ID, datetime.now(timezone.utc) - G.TOKEN_TTL - timedelta(seconds=5)).token
    assert client.post("/api/v1/translation/guest-token", headers={"X-Guest-Token": expired}).status_code == 200
    assert client.post("/api/v1/translation/guest-token", headers={"X-Guest-Token": expired}).status_code == 429


def test_guest_token_endpoint_is_closed_when_the_guest_trial_is_off(client, flags, monkeypatch):
    flags["guest_translation_enabled"] = False
    response = client.post("/api/v1/translation/guest-token")
    assert response.status_code == 503 and response.json()["code"] == "guest_unavailable"
    flags["guest_translation_enabled"] = True
    monkeypatch.setenv("GUEST_TRIAL_SECRET", "")
    assert client.post("/api/v1/translation/guest-token").status_code == 503


def test_global_cap_is_off_by_default_and_blocks_everyone_when_set(client, monkeypatch):
    with _ok():
        assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers("guest-a-0123456789abcdef")).status_code == 200
        monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "2")
        assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers("guest-b-0123456789abcdef")).status_code == 200
        assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers("guest-c-0123456789abcdef")).status_code == 200
        blocked = client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers("guest-d-0123456789abcdef"))
    assert blocked.status_code == 429 and blocked.json()["code"] == "guest_global_capped"
    assert G.status("guest-d-0123456789abcdef").remaining == 10  # 被全站上限擋下時，個人次數沒被扣


def test_failures_before_the_llm_call_also_refund_the_global_slot(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "1")
    with patch.object(S, "translate", side_effect=S.UnsupportedTribeError("不支援")):
        assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 400
    with _ok():
        assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 200


def test_missing_secret_means_guest_trial_is_off(client, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_SECRET", "")
    assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == 401


def test_translation_kill_switch_still_applies_to_guests(client, flags):
    flags["translation_enabled"] = False
    response = client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    assert response.status_code == 403
    assert G.status(GUEST_ID).remaining == 10  # 被總開關擋下時不扣次數


def test_failures_before_the_paid_llm_call_refund_the_guest_quota(client):
    for error, status in (
        (S.UnsupportedTribeError("不支援"), 400),
        (S.UnsupportedDirectionError("不支援"), 400),
        (EnvironmentError("ANTHROPIC_API_KEY 未設定"), 503),
    ):
        with patch.object(S, "translate", side_effect=error):
            assert client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers()).status_code == status
        assert G.status(GUEST_ID).remaining == 10


def test_failure_after_a_possibly_billed_llm_call_does_not_refund(client):
    """LLM 可能已經計費的失敗不退還，否則反覆觸發就能不耗額度地呼叫付費 LLM。"""
    with patch.object(S, "translate", side_effect=RuntimeError("post-processing exploded")):
        failed = client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    assert failed.status_code == 502
    assert G.status(GUEST_ID).remaining == 9


def test_validation_error_does_not_consume_quota(client):
    response = client.post("/api/v1/translation/translate", json={**BODY, "text": ""}, headers=_guest_headers())
    assert response.status_code == 422
    assert G.status(GUEST_ID).remaining == 10


def test_guest_quota_endpoint_reports_without_consuming(client):
    first = client.get("/api/v1/translation/guest-quota", headers=_guest_headers()).json()
    assert first == {"isGuest": True, "limit": 10, "remaining": 10, "resetsAt": first["resetsAt"]}
    with _ok():
        client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    assert client.get("/api/v1/translation/guest-quota", headers=_guest_headers()).json()["remaining"] == 9
    assert client.get("/api/v1/translation/guest-quota", headers=_guest_headers()).json()["remaining"] == 9


def test_logged_in_user_is_unaffected_and_uses_no_guest_quota(client, monkeypatch):
    async def fake_verify(request, authorization=None):
        request.state.user = {"uid": "real-user"}
        return request.state.user

    monkeypatch.setattr(auth_module, "verify_firebase_token", fake_verify)
    headers = {"Authorization": "Bearer valid-token", **_guest_headers()}
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
        "/api/v1/translation/translate", json=BODY, headers={"Authorization": "Bearer expired", **_guest_headers()},
    )
    assert response.status_code == 401
    assert G.status(GUEST_ID).remaining == 10


def test_no_database_means_guest_trial_is_off(client, monkeypatch):
    monkeypatch.setattr(G, "_engine", None)
    response = client.post("/api/v1/translation/translate", json=BODY, headers=_guest_headers())
    assert response.status_code == 401  # is_ready() 為假：回到原本的「需要登入」


def test_other_routers_still_require_login_for_guests(client):
    assert client.get("/api/v1/sentence/questions", headers=_guest_headers()).status_code == 401
    assert client.get("/api/v1/listening/questions", headers=_guest_headers()).status_code == 401
