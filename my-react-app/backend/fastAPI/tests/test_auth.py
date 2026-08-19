"""測試 fastAPI/routes/auth.py 的 verify_firebase_token 依賴注入函式。

重點驗證第 1 項稽核修正：AUTH_DEV_BYPASS 必須同時搭配 DJANGO_DEBUG=True 才會略過
驗證（雙重確認），任何一個是 False 都要照常要求有效 token。
"""
import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from fastAPI.routes import auth as auth_module


def _run(coro):
    return asyncio.run(coro)


class _FakeRequest:
    def __init__(self):
        self.state = MagicMock()


def test_dev_bypass_skips_verification_when_both_flags_true(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "True")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "True")
    request = _FakeRequest()

    result = _run(auth_module.verify_firebase_token(request, authorization=None))

    assert result == {"uid": "dev-user"}
    assert request.state.user == {"uid": "dev-user"}


def test_dev_bypass_ignored_when_auth_dev_bypass_false(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "True")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with pytest.raises(HTTPException) as exc_info:
        _run(auth_module.verify_firebase_token(request, authorization=None))
    assert exc_info.value.status_code == 401


def test_dev_bypass_ignored_when_debug_false(monkeypatch):
    # 正式環境若誤設 AUTH_DEV_BYPASS=True 但 DJANGO_DEBUG=False，仍要求驗證。
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "True")
    request = _FakeRequest()

    with pytest.raises(HTTPException) as exc_info:
        _run(auth_module.verify_firebase_token(request, authorization=None))
    assert exc_info.value.status_code == 401


def test_missing_authorization_header_rejected(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with pytest.raises(HTTPException) as exc_info:
        _run(auth_module.verify_firebase_token(request, authorization="NotBearer xyz"))
    assert exc_info.value.status_code == 401


def test_valid_token_sets_request_state(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(auth_module, "ensure_firebase_initialized"):
        with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "real-user"}):
            result = _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))

    assert result == {"uid": "real-user"}
    assert request.state.user == {"uid": "real-user"}


def test_invalid_token_returns_401(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(auth_module, "ensure_firebase_initialized"):
        with patch("firebase_admin.auth.verify_id_token", side_effect=Exception("bad token")):
            with pytest.raises(HTTPException) as exc_info:
                _run(auth_module.verify_firebase_token(request, authorization="Bearer badtoken"))
    assert exc_info.value.status_code == 401


def test_verifies_with_check_revoked_true(monkeypatch):
    # 獨立審查找到的問題：預設的 verify_id_token() 不查撤銷/停權狀態，強制
    # 登出、停權、收回角色之後，舊 token 在到期前仍會通過驗證。這裡鎖定
    # 「一定有帶 check_revoked=True」，避免這個旗標之後被意外改掉或漏帶。
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(auth_module, "ensure_firebase_initialized"):
        with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "real-user"}) as mock_verify:
            _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))

    mock_verify.assert_called_once_with("sometoken", check_revoked=True)


def test_disabled_user_token_returns_401(monkeypatch):
    # UserDisabledError 不是 InvalidIdTokenError 的子類別（各自獨立繼承自
    # InvalidArgumentError）——這是這次修正特別要接住的分支。
    import firebase_admin.auth as fa

    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(auth_module, "ensure_firebase_initialized"):
        with patch(
            "firebase_admin.auth.verify_id_token",
            side_effect=fa.UserDisabledError("user disabled"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))
    assert exc_info.value.status_code == 401


def test_revoked_token_returns_401(monkeypatch):
    import firebase_admin.auth as fa

    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(auth_module, "ensure_firebase_initialized"):
        with patch(
            "firebase_admin.auth.verify_id_token",
            side_effect=fa.RevokedIdTokenError("token revoked"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))
    assert exc_info.value.status_code == 401


def test_missing_service_account_returns_503(monkeypatch):
    # ensure_firebase_initialized（config/firebase_init.py 共用）沒設定服務帳戶金鑰
    # 時拋 EnvironmentError，這裡驗證 verify_firebase_token 有接住並轉成 503，
    # 不會讓原始 EnvironmentError 直接往外傳。
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(
        auth_module,
        "ensure_firebase_initialized",
        side_effect=EnvironmentError("FIREBASE_SERVICE_ACCOUNT_PATH 未設定"),
    ):
        with pytest.raises(HTTPException) as exc_info:
            _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))
    assert exc_info.value.status_code == 503


def test_malformed_service_account_returns_503_not_uncaught_500(monkeypatch):
    # ensure_firebase_initialized() 丟出非 EnvironmentError（例如服務帳戶金鑰檔案
    # 存在但格式損毀，firebase_admin.credentials.Certificate 會丟 ValueError）時，
    # 原本沒有對應的 except 分支，例外會直接往外傳，變成未經處理的 500——回應仍是
    # JSON（Starlette 的預設例外處理器接住），但語意上該是「服務暫時不可用」的 503。
    # Django 端同一種情境曾經因為 import 順序問題直接變成 UnboundLocalError；FastAPI
    # 這邊 import 順序沒有問題，但同樣缺了乾淨的 503 對應，這裡一併補上。
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(
        auth_module,
        "ensure_firebase_initialized",
        side_effect=ValueError("Invalid certificate"),
    ):
        with pytest.raises(HTTPException) as exc_info:
            _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))
    assert exc_info.value.status_code == 503
