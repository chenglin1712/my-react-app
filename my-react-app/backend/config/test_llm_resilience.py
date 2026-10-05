"""config/llm.py 的 timeout／重試設定、斷路器與錯誤分類。"""
from unittest import TestCase
from unittest.mock import MagicMock, patch

import anthropic
import httpx

from config import llm


def _request():
    return httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _timeout_error():
    return anthropic.APITimeoutError(request=_request())


def _rate_limit_error():
    return anthropic.RateLimitError("limited", response=httpx.Response(429, request=_request()), body=None)


def _bad_request_error():
    return anthropic.BadRequestError("bad", response=httpx.Response(400, request=_request()), body=None)


def _completions(create_side_effect=None, text="ok"):
    inner = MagicMock()
    if create_side_effect is not None:
        inner.messages.create.side_effect = create_side_effect
    else:
        block = MagicMock(type="text", text=text)
        inner.messages.create.return_value = MagicMock(stop_reason="end_turn", content=[block])
    return llm._ChatCompletions(inner), inner


class ClassifyLlmErrorTests(TestCase):
    def test_status_codes(self):
        self.assertEqual(llm.classify_llm_error(_timeout_error())[0], 504)
        self.assertEqual(llm.classify_llm_error(_rate_limit_error())[0], 429)
        self.assertEqual(llm.classify_llm_error(llm.LLMUnavailableError("x"))[0], 503)
        self.assertEqual(llm.classify_llm_error(RuntimeError("boom"))[0], 502)

    def test_message_never_leaks_exception_text(self):
        _, detail = llm.classify_llm_error(RuntimeError("secret internal path /srv/app"))
        self.assertNotIn("secret", detail)


class CircuitBreakerTests(TestCase):
    def setUp(self):
        patcher = patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=3, cooldown=60))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_opens_after_consecutive_transient_failures_and_skips_provider(self):
        comp, inner = _completions(create_side_effect=_timeout_error())
        for _ in range(3):
            with self.assertRaises(anthropic.APITimeoutError):
                comp.create(model="m", messages=[{"role": "user", "content": "hi"}])
        self.assertEqual(inner.messages.create.call_count, 3)

        with self.assertRaises(llm.LLMUnavailableError):
            comp.create(model="m", messages=[{"role": "user", "content": "hi"}])
        self.assertEqual(inner.messages.create.call_count, 3)  # 第 4 次沒有打到供應商

    def test_success_resets_failure_count(self):
        bad, _ = _completions(create_side_effect=_rate_limit_error())
        good, _ = _completions()
        for _ in range(2):
            with self.assertRaises(anthropic.RateLimitError):
                bad.create(model="m", messages=[{"role": "user", "content": "x"}])
        good.create(model="m", messages=[{"role": "user", "content": "x"}])
        for _ in range(2):
            with self.assertRaises(anthropic.RateLimitError):
                bad.create(model="m", messages=[{"role": "user", "content": "x"}])
        # 成功之後重新計數，4 次失敗中間夾一次成功，不會達到門檻 3
        good.create(model="m", messages=[{"role": "user", "content": "x"}])

    def test_non_transient_errors_do_not_count(self):
        comp, inner = _completions(create_side_effect=_bad_request_error())
        for _ in range(5):
            with self.assertRaises(anthropic.BadRequestError):
                comp.create(model="m", messages=[{"role": "user", "content": "x"}])
        self.assertEqual(inner.messages.create.call_count, 5)

    def test_allows_one_trial_after_cooldown(self):
        breaker = llm._CircuitBreaker(threshold=1, cooldown=10)
        with patch("config.llm.time.monotonic", return_value=100.0):
            breaker.record_failure()
            with self.assertRaises(llm.LLMUnavailableError):
                breaker.before_call()
        with patch("config.llm.time.monotonic", return_value=111.0):
            breaker.before_call()  # 冷卻結束，放行試探
            with self.assertRaises(llm.LLMUnavailableError):
                breaker.before_call()  # 試探結果未出時，其他請求仍被擋
            breaker.record_success()
            breaker.before_call()  # 成功後恢復


class ClientConfigurationTests(TestCase):
    def test_client_is_built_with_timeout_and_retries(self):
        with patch.object(llm, "_client", None), \
             patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}), \
             patch("config.llm.anthropic.Anthropic") as ctor:
            llm.get_llm_client()
        _, kwargs = ctor.call_args
        self.assertEqual(kwargs["timeout"], llm._TIMEOUT_SECONDS)
        self.assertEqual(kwargs["max_retries"], llm._MAX_RETRIES)
        self.assertGreater(kwargs["timeout"], 0)
