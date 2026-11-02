"""fastAPI/budget_guard.py：節流、設定檢查、不外洩密鑰的通知（稽核 AI-1）。"""
from unittest.mock import patch

import pytest

from fastAPI import budget_guard

SECRET = "k" * 20 + "AbCdEfGh1234567890"


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    monkeypatch.setattr(budget_guard, "_last_poke", 0.0)
    monkeypatch.setattr(budget_guard, "_warned", False)
    monkeypatch.delenv("DJANGO_INTERNAL_BASE_URL", raising=False)


def test_without_a_secret_nothing_is_sent(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    with patch.object(budget_guard.threading, "Thread") as thread:
        assert budget_guard.poke(now=100.0) is False
    thread.assert_not_called()


def test_a_weak_secret_is_refused_and_logged_once(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "short")
    with patch.object(budget_guard.threading, "Thread") as thread, patch.object(budget_guard.logger, "error") as log_error:
        assert budget_guard.poke(now=100.0) is False
        assert budget_guard.poke(now=200.0) is False
    thread.assert_not_called()
    assert log_error.call_count == 1


def test_a_plain_http_remote_base_url_is_refused(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", SECRET)
    monkeypatch.setenv("DJANGO_INTERNAL_BASE_URL", "http://example.com")
    with patch.object(budget_guard.threading, "Thread") as thread, patch.object(budget_guard.logger, "error"):
        assert budget_guard.poke(now=100.0) is False
    thread.assert_not_called()


def test_it_is_throttled_to_one_notification_per_interval(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", SECRET)
    with patch.object(budget_guard.threading, "Thread") as thread:
        assert budget_guard.poke(now=100.0) is True
        assert budget_guard.poke(now=100.0 + budget_guard.INTERVAL_SECONDS - 1) is False
        assert budget_guard.poke(now=100.0 + budget_guard.INTERVAL_SECONDS) is True
    assert thread.call_count == 2


def test_send_posts_the_secret_without_following_redirects():
    with patch.object(budget_guard.requests, "post") as post:
        post.return_value.status_code = 200
        budget_guard._send(SECRET, "http://127.0.0.1:8000")
    args, kwargs = post.call_args
    assert args[0] == "http://127.0.0.1:8000/adminapi/internal/ai-budget/enforce/"
    assert kwargs["headers"] == {"X-Internal-Secret": SECRET}
    assert kwargs["allow_redirects"] is False


def test_send_never_raises_and_never_logs_the_secret():
    with patch.object(budget_guard.requests, "post", side_effect=ConnectionError(f"boom {SECRET}")), \
            patch.object(budget_guard.logger, "warning") as warning:
        budget_guard._send(SECRET, "http://127.0.0.1:8000")
    assert warning.called
    assert SECRET not in str(warning.call_args.args)
