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


class CircuitBreakerStateMachineTests(TestCase):
    """直接測 _CircuitBreaker 的狀態轉換（時間用 monotonic 的假值控制）。"""

    def _open_breaker(self, cooldown=30):
        breaker = llm._CircuitBreaker(threshold=1, cooldown=cooldown)
        with patch("config.llm.time.monotonic", return_value=0.0):
            breaker.before_call()
            breaker.record_failure(False)  # 開啟，opened_at = 0
        return breaker

    def test_only_one_probe_even_when_probe_outlasts_cooldown(self):
        """回歸測試：試探請求耗時超過冷卻時間（例如試探逾時 25 秒、冷卻 30 秒再多一點），
        原本會放行第二個並行試探。"""
        breaker = self._open_breaker()
        with patch("config.llm.time.monotonic", return_value=31.0):
            self.assertTrue(breaker.before_call())          # 第 1 個試探
        with patch("config.llm.time.monotonic", return_value=100.0):  # 遠超過冷卻
            with self.assertRaises(llm.LLMUnavailableError):
                breaker.before_call()                        # 第 2 個仍被擋

    def test_probe_failure_restarts_cooldown_from_failure_time(self):
        breaker = self._open_breaker()
        with patch("config.llm.time.monotonic", return_value=31.0):
            self.assertTrue(breaker.before_call())
        with patch("config.llm.time.monotonic", return_value=61.0):
            breaker.record_failure(True)                     # 試探在 t=61 才失敗
        with patch("config.llm.time.monotonic", return_value=80.0):
            with self.assertRaises(llm.LLMUnavailableError):
                breaker.before_call()                        # 61 + 30 = 91 之前都不放行
        with patch("config.llm.time.monotonic", return_value=92.0):
            self.assertTrue(breaker.before_call())           # 冷卻從失敗當下重算

    def test_probe_success_closes_the_breaker(self):
        breaker = self._open_breaker()
        with patch("config.llm.time.monotonic", return_value=31.0):
            self.assertTrue(breaker.before_call())
            breaker.record_success(True)
            self.assertFalse(breaker.before_call())          # 已恢復，普通請求直接通過

    def test_late_result_of_a_normal_request_does_not_close_an_open_breaker(self):
        """在斷路器開啟之前送出、之後才回來的普通請求，成功不能讓斷路器誤判為已恢復。"""
        breaker = self._open_breaker()
        breaker.record_success(False)
        with patch("config.llm.time.monotonic", return_value=1.0):
            with self.assertRaises(llm.LLMUnavailableError):
                breaker.before_call()

    def test_aborted_probe_releases_the_probe_slot(self):
        breaker = self._open_breaker()
        with patch("config.llm.time.monotonic", return_value=31.0):
            self.assertTrue(breaker.before_call())
            breaker.abort_probe()                            # 試探因非暫時性錯誤結束
            self.assertTrue(breaker.before_call())           # 下一個請求可以接手試探

    def test_concurrent_callers_get_exactly_one_probe(self):
        import threading

        breaker = self._open_breaker()
        results = []
        barrier = threading.Barrier(8)

        def attempt():
            barrier.wait()
            try:
                results.append(breaker.before_call())
            except llm.LLMUnavailableError:
                results.append("rejected")

        with patch("config.llm.time.monotonic", return_value=31.0):
            threads = [threading.Thread(target=attempt) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(results.count(True), 1)
        self.assertEqual(results.count("rejected"), 7)


class TimeoutBudgetTests(TestCase):
    """逾時預算必須由內而外逐層放大：LLM 最長等待 < gunicorn timeout < nginx 讀取逾時，
    否則內層的逾時與斷路器處理來不及執行，worker 或連線就先被外層強制中斷。"""

    @staticmethod
    def _read(relative):
        from pathlib import Path
        return (Path(__file__).resolve().parents[2] / relative).read_text(encoding="utf-8")

    def test_llm_worst_case_is_below_gunicorn_and_nginx_timeouts(self):
        import re

        backoff_allowance = 8  # SDK 退避重試最多再多等的秒數（保守估計）
        llm_worst_case = (llm._MAX_RETRIES + 1) * llm._TIMEOUT_SECONDS + backoff_allowance

        gunicorn = int(re.search(r"--timeout\s+(\d+)", self._read("docker-compose.prod.yml")).group(1))
        nginx = int(re.search(r"proxy_read_timeout\s+(\d+)s", self._read("deploy/nginx.conf")).group(1))

        self.assertLess(llm_worst_case, gunicorn, "gunicorn --timeout 要大於 LLM 最長等待")
        self.assertLess(gunicorn, nginx, "nginx proxy_read_timeout 要大於 gunicorn --timeout")


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
