"""is_enabled_fail_closed：給放行付費或對外風險的旗標用，資料庫異常時不能沿用舊的「開啟」。"""
import time

import pytest

from fastAPI import feature_flags as F


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    monkeypatch.setattr(F, "_refresh_if_stale", lambda: None)  # 這裡直接操控快取，不碰資料庫
    monkeypatch.setattr(F, "_cache", {})
    monkeypatch.setattr(F, "_last_success", 0.0)


def test_never_fetched_means_closed():
    F._cache["k"] = True
    assert F.is_enabled_fail_closed("k") is False


def test_fresh_enabled_flag_is_open_and_missing_key_is_closed(monkeypatch):
    monkeypatch.setattr(F, "_last_success", time.monotonic())
    F._cache["k"] = True
    assert F.is_enabled_fail_closed("k") is True
    assert F.is_enabled_fail_closed("missing") is False


def test_disabled_flag_is_closed(monkeypatch):
    monkeypatch.setattr(F, "_last_success", time.monotonic())
    F._cache["k"] = False
    assert F.is_enabled_fail_closed("k") is False


def test_stale_cache_that_says_open_is_not_trusted(monkeypatch):
    monkeypatch.setattr(F, "_last_success", time.monotonic() - F._FAIL_CLOSED_MAX_AGE_SECONDS - 5)
    F._cache["k"] = True
    assert F.is_enabled_fail_closed("k") is False
    # 一般的 is_enabled 行為不變：照舊沿用快取
    assert F.is_enabled("k", default=False) is True
