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


def _caller(create_side_effect=None, text="ok", stop_reason="end_turn"):
    """回傳 (call, inner)：call() 透過 llm.call_claude 發一次請求，inner 是假的 SDK client。"""
    inner = MagicMock()
    if create_side_effect is not None:
        inner.messages.create.side_effect = create_side_effect
    else:
        block = MagicMock(type="text", text=text)
        inner.messages.create.return_value = MagicMock(stop_reason=stop_reason, content=[block])

    def call():
        return llm.call_claude(inner, feature="chat", system="s", messages=[{"role": "user", "content": "hi"}])

    return call, inner


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
        call, inner = _caller(create_side_effect=_timeout_error())
        for _ in range(3):
            with self.assertRaises(anthropic.APITimeoutError):
                call()
        self.assertEqual(inner.messages.create.call_count, 3)

        with self.assertRaises(llm.LLMUnavailableError):
            call()
        self.assertEqual(inner.messages.create.call_count, 3)  # 第 4 次沒有打到供應商

    def test_success_resets_failure_count(self):
        bad, _ = _caller(create_side_effect=_rate_limit_error())
        good, _ = _caller()
        for _ in range(2):
            with self.assertRaises(anthropic.RateLimitError):
                bad()
        good()
        for _ in range(2):
            with self.assertRaises(anthropic.RateLimitError):
                bad()
        # 成功之後重新計數，4 次失敗中間夾一次成功，不會達到門檻 3
        good()

    def test_non_transient_errors_do_not_count(self):
        call, inner = _caller(create_side_effect=_bad_request_error())
        for _ in range(5):
            with self.assertRaises(anthropic.BadRequestError):
                call()
        self.assertEqual(inner.messages.create.call_count, 5)

    def test_refusal_raises_but_does_not_count_as_provider_failure(self):
        """拒答是模型的決定，不是供應商故障：丟出例外讓呼叫端回錯誤，但不累計斷路器失敗。"""
        refused, inner = _caller(stop_reason="refusal")
        for _ in range(5):
            with self.assertRaises(RuntimeError):
                refused()
        self.assertEqual(inner.messages.create.call_count, 5)  # 門檻 3，沒被擋下

    def test_rejected_by_open_breaker_never_touches_provider_or_probe_slot(self):
        breaker = MagicMock()
        breaker.before_call.side_effect = llm.LLMUnavailableError("open")
        call, inner = _caller()
        with patch.object(llm, "_breaker", breaker):
            with self.assertRaises(llm.LLMUnavailableError):
                call()
        inner.messages.create.assert_not_called()
        breaker.abort_probe.assert_not_called()

    def test_probe_with_non_transient_error_releases_probe_slot(self):
        breaker = MagicMock()
        breaker.before_call.return_value = True  # 這次是試探請求
        call, _ = _caller(create_side_effect=_bad_request_error())
        with patch.object(llm, "_breaker", breaker):
            with self.assertRaises(anthropic.BadRequestError):
                call()
        breaker.abort_probe.assert_called_once()
        breaker.record_failure.assert_not_called()

    def test_probe_with_transient_error_records_failure_not_abort(self):
        breaker = MagicMock()
        breaker.before_call.return_value = True
        call, _ = _caller(create_side_effect=_timeout_error())
        with patch.object(llm, "_breaker", breaker):
            with self.assertRaises(anthropic.APITimeoutError):
                call()
        breaker.record_failure.assert_called_once_with(True)
        breaker.abort_probe.assert_not_called()

    def test_success_is_recorded_before_refusal_is_raised(self):
        breaker = MagicMock()
        breaker.before_call.return_value = False
        call, _ = _caller(stop_reason="refusal")
        with patch.object(llm, "_breaker", breaker):
            with self.assertRaises(RuntimeError):
                call()
        breaker.record_success.assert_called_once_with(False)
        breaker.record_failure.assert_not_called()

    def test_response_without_usage_or_request_id_still_succeeds(self):
        """紀錄用量／request id 只是附帶的；欄位缺漏不能讓已成功的呼叫變失敗。"""
        call, inner = _caller()
        inner.messages.create.return_value = MagicMock(
            spec=["stop_reason", "content"], stop_reason="end_turn",
            content=[MagicMock(type="text", text="ok")],
        )
        self.assertEqual(llm.extract_text(call()), "ok")

    def test_request_shape_is_native_anthropic(self):
        call, inner = _caller()
        call()
        _, kwargs = inner.messages.create.call_args
        self.assertEqual(kwargs["system"], "s")
        self.assertEqual(kwargs["messages"], [{"role": "user", "content": "hi"}])
        settings = llm.get_settings("chat")
        self.assertEqual(kwargs["model"], settings.model)
        self.assertEqual(kwargs["max_tokens"], settings.max_tokens)
        self.assertEqual(kwargs["output_config"], {"effort": settings.effort})
        self.assertNotIn("temperature", kwargs)

    def test_effort_is_omitted_when_the_feature_has_no_effort(self):
        call, inner = _caller()
        with patch.dict("os.environ", {"LLM_EFFORT_CHAT": "default"}):
            call()
        _, kwargs = inner.messages.create.call_args
        self.assertNotIn("output_config", kwargs)


class UsageRecordingTests(TestCase):
    """每次呼叫（含失敗）都交給已註冊的寫入端；寫入端出錯不能影響 LLM 呼叫。"""

    def setUp(self):
        patcher = patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=3, cooldown=60))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.entries = []
        # 還原成測試前的寫入端（Django 啟動時已註冊 adminapi 的），不要留下 None 影響其他測試。
        self.addCleanup(llm.set_usage_recorder, llm._usage_recorder)
        llm.set_usage_recorder(self.entries.append)

    def _ok_caller(self):
        call, inner = _caller()
        inner.messages.create.return_value = MagicMock(
            stop_reason="end_turn", _request_id="req_123",
            content=[MagicMock(type="text", text="ok")],
            usage=MagicMock(input_tokens=100, output_tokens=20, cache_read_input_tokens=50, cache_creation_input_tokens=7),
        )
        return call

    def test_successful_call_is_recorded_with_tokens_and_request_id(self):
        self._ok_caller()()
        (entry,) = self.entries
        self.assertEqual(entry["feature"], "chat")
        self.assertEqual(entry["status"], "ok")
        self.assertEqual(entry["request_id"], "req_123")
        self.assertEqual(
            (entry["input_tokens"], entry["output_tokens"], entry["cache_read_tokens"], entry["cache_write_tokens"]),
            (100, 20, 50, 7),
        )
        self.assertGreaterEqual(entry["latency_ms"], 0)
        self.assertEqual(entry["model"], llm.get_settings("chat").model)

    def test_explicit_uid_and_context_uid(self):
        call, inner = _caller()
        llm.call_claude(inner, feature="chat", system="s", messages=[], uid="u-explicit")
        token = llm.current_uid.set("u-context")
        try:
            call()
        finally:
            llm.current_uid.reset(token)
        self.assertEqual([e["uid"] for e in self.entries], ["u-explicit", "u-context"])

    def test_failures_are_recorded_with_a_status_and_no_tokens(self):
        for error, status in [(_timeout_error(), "timeout"), (_rate_limit_error(), "rate_limit"), (_bad_request_error(), "error")]:
            call, _ = _caller(create_side_effect=error)
            with self.assertRaises(type(error)):
                call()
            self.assertEqual(self.entries[-1]["status"], status)
            self.assertIsNone(self.entries[-1]["input_tokens"])

    def test_open_breaker_is_recorded_and_never_reaches_the_provider(self):
        failing, _ = _caller(create_side_effect=_timeout_error())
        for _ in range(3):
            with self.assertRaises(anthropic.APITimeoutError):
                failing()
        call, inner = _caller()
        with self.assertRaises(llm.LLMUnavailableError):
            call()
        inner.messages.create.assert_not_called()
        self.assertEqual(self.entries[-1]["status"], "breaker_open")

    def test_refusal_is_recorded_as_refusal(self):
        call, _ = _caller(stop_reason="refusal")
        with self.assertRaises(RuntimeError):
            call()
        self.assertEqual(self.entries[-1]["status"], "refusal")

    def test_non_numeric_usage_fields_are_recorded_as_none(self):
        call, _ = _caller()  # 預設的 MagicMock 回應：usage 與 _request_id 都不是真的數字／字串
        call()
        entry = self.entries[-1]
        self.assertIsNone(entry["input_tokens"])
        self.assertIsNone(entry["cache_write_tokens"])
        self.assertEqual(entry["request_id"], "")

    def test_a_broken_recorder_never_breaks_the_call(self):
        llm.set_usage_recorder(MagicMock(side_effect=RuntimeError("db down")))
        call, _ = _caller()
        self.assertEqual(llm.extract_text(call()), "ok")

    def test_no_recorder_registered_is_fine(self):  # 還原由 setUp 的 addCleanup 負責
        llm.set_usage_recorder(None)
        call, _ = _caller()
        self.assertEqual(llm.extract_text(call()), "ok")


class ExtractTextTests(TestCase):
    def test_joins_text_blocks_and_skips_other_types(self):
        response = MagicMock(content=[
            MagicMock(type="thinking", text="不該出現"),
            MagicMock(type="text", text="哈"),
            MagicMock(type="text", text="囉"),
        ])
        self.assertEqual(llm.extract_text(response), "哈囉")

    def test_no_text_blocks_returns_empty_string(self):
        self.assertEqual(llm.extract_text(MagicMock(content=[])), "")


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
