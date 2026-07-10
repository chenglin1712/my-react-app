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

    with patch.object(auth_module, "_ensure_firebase"):
        with patch("firebase_admin.auth.verify_id_token", return_value={"uid": "real-user"}):
            result = _run(auth_module.verify_firebase_token(request, authorization="Bearer sometoken"))

    assert result == {"uid": "real-user"}
    assert request.state.user == {"uid": "real-user"}


def test_invalid_token_returns_401(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "False")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
    request = _FakeRequest()

    with patch.object(auth_module, "_ensure_firebase"):
        with patch("firebase_admin.auth.verify_id_token", side_effect=Exception("bad token")):
            with pytest.raises(HTTPException) as exc_info:
                _run(auth_module.verify_firebase_token(request, authorization="Bearer badtoken"))
    assert exc_info.value.status_code == 401
