"""路線圖 #6：失敗時的 request id、斷路器狀態事件、拒答分類。"""
from unittest import TestCase
from unittest.mock import MagicMock, patch

import anthropic
import httpx

from config import llm
from config.test_llm_resilience import _caller, _request, _timeout_error


def _server_error(request_id="req_err_1"):
    response = httpx.Response(500, headers={"request-id": request_id}, request=_request())
    return anthropic.InternalServerError("boom", response=response, body=None)


class _RecorderCase(TestCase):
    def setUp(self):
        self.entries = []
        self.addCleanup(llm.set_usage_recorder, llm._usage_recorder)
        llm.set_usage_recorder(self.entries.append)

    def use_breaker(self, threshold, cooldown):
        patcher = patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=threshold, cooldown=cooldown))
        patcher.start()
        self.addCleanup(patcher.stop)

    def breaker_events(self):
        return [e["status"] for e in self.entries if e["feature"] == "breaker"]


class RequestIdOnFailureTests(_RecorderCase):
    def test_api_error_request_id_is_recorded_so_it_can_be_matched_on_anthropic_side(self):
        self.use_breaker(10, 60)
        call, _ = _caller(create_side_effect=_server_error("req_err_42"))
        with self.assertRaises(anthropic.InternalServerError):
            call()
        (entry,) = self.entries
        self.assertEqual((entry["status"], entry["request_id"]), ("server_error", "req_err_42"))

    def test_errors_without_a_request_id_record_an_empty_one(self):
        self.use_breaker(10, 60)
        call, _ = _caller(create_side_effect=_timeout_error())
        with self.assertRaises(anthropic.APITimeoutError):
            call()
        self.assertEqual(self.entries[0]["request_id"], "")

    def test_non_transient_api_error_also_keeps_its_request_id(self):
        self.use_breaker(10, 60)
        response = httpx.Response(400, headers={"request-id": "req_bad"}, request=_request())
        call, _ = _caller(create_side_effect=anthropic.BadRequestError("bad", response=response, body=None))
        with self.assertRaises(anthropic.BadRequestError):
            call()
        self.assertEqual(self.entries[0]["request_id"], "req_bad")


class BreakerEventTests(_RecorderCase):
    def test_opening_is_recorded_as_a_breaker_event_not_an_api_call(self):
        self.use_breaker(2, 60)
        call, _ = _caller(create_side_effect=_timeout_error())
        for _ in range(2):
            with self.assertRaises(anthropic.APITimeoutError):
                call()
        self.assertEqual(self.breaker_events(), ["opened"])
        event = next(e for e in self.entries if e["feature"] == "breaker")
        self.assertEqual((event["uid"], event["request_id"], event["input_tokens"], event["latency_ms"]), ("", "", None, 0))
        self.assertTrue(event["model"])

    def test_full_cycle_open_half_open_probe_failed_half_open_closed(self):
        self.use_breaker(2, 0)                      # 冷卻 0 秒：下一次呼叫就是試探
        failing, _ = _caller(create_side_effect=_timeout_error())
        for _ in range(2):
            with self.assertRaises(anthropic.APITimeoutError):
                failing()
        with self.assertRaises(anthropic.APITimeoutError):   # 試探失敗
            failing()
        ok, _ = _caller()
        ok()                                                  # 再次試探成功
        self.assertEqual(self.breaker_events(), ["opened", "half_open", "probe_failed", "half_open", "closed"])

    def test_calls_rejected_while_open_do_not_emit_more_events(self):
        self.use_breaker(1, 60)
        call, _ = _caller(create_side_effect=_timeout_error())
        with self.assertRaises(anthropic.APITimeoutError):
            call()
        for _ in range(3):
            with self.assertRaises(llm.LLMUnavailableError):
                call()
        self.assertEqual(self.breaker_events(), ["opened"])

    def test_a_failing_recorder_never_breaks_the_llm_call(self):
        self.use_breaker(1, 60)
        llm.set_usage_recorder(MagicMock(side_effect=RuntimeError("db down")))
        call, _ = _caller(create_side_effect=_timeout_error())
        with self.assertRaises(anthropic.APITimeoutError):      # 仍是原本的例外，不是 RuntimeError
            call()

    def test_events_are_written_after_the_breaker_lock_is_released(self):
        """寫入端會碰資料庫；在斷路器的鎖裡寫入，慢一點的資料庫就會卡住所有 LLM 呼叫。"""
        breaker = llm._CircuitBreaker(threshold=1, cooldown=60)
        seen = []

        def recorder(entry):
            seen.append(breaker._lock.acquire(blocking=False))     # 取得鎖代表此刻沒人握著
            if seen[-1]:
                breaker._lock.release()

        self.addCleanup(llm.set_usage_recorder, llm._usage_recorder)
        llm.set_usage_recorder(recorder)
        with patch.object(llm, "_breaker", breaker):
            call, _ = _caller(create_side_effect=_timeout_error())
            with self.assertRaises(anthropic.APITimeoutError):
                call()
        self.assertIn(True, seen)
        self.assertNotIn(False, seen)

    def test_snapshot_reports_state_and_remaining_cooldown(self):
        breaker = llm._CircuitBreaker(threshold=1, cooldown=60)
        self.assertEqual(breaker.snapshot()["state"], "closed")
        breaker.record_failure(False)
        snap = breaker.snapshot()
        self.assertEqual((snap["state"], snap["consecutiveFailures"], snap["threshold"]), ("open", 1, 1))
        self.assertGreater(snap["retryInSeconds"], 55)


class RefusalTests(TestCase):
    def _refused_call(self, category="cyber"):
        inner = MagicMock()
        inner.messages.create.return_value = MagicMock(
            stop_reason="refusal", content=[], _request_id="req_refused", stop_details=MagicMock(category=category),
        )
        return lambda: llm.call_claude(inner, feature="chat", system="s", messages=[{"role": "user", "content": "x"}])

    def test_refusal_carries_its_category_and_logs_it_with_the_request_id(self):
        with patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=3, cooldown=60)):
            with self.assertLogs("config.llm", level="WARNING") as logs, self.assertRaises(llm.LLMRefusalError) as ctx:
                self._refused_call()()
        self.assertEqual(ctx.exception.category, "cyber")
        text = "\n".join(logs.output)
        self.assertIn("category=cyber", text)
        self.assertIn("request_id=req_refused", text)

    def test_missing_stop_details_falls_back_to_unknown(self):
        inner = MagicMock()
        inner.messages.create.return_value = MagicMock(stop_reason="refusal", content=[], _request_id="r", stop_details=None)
        with patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=3, cooldown=60)):
            with self.assertLogs("config.llm", level="WARNING") as logs, self.assertRaises(llm.LLMRefusalError) as ctx:
                llm.call_claude(inner, feature="chat", system="s", messages=[])
        self.assertEqual(ctx.exception.category, "")
        self.assertIn("category=unknown", "\n".join(logs.output))

    def test_refusal_does_not_count_against_the_breaker(self):
        breaker = llm._CircuitBreaker(threshold=1, cooldown=60)
        with patch.object(llm, "_breaker", breaker):
            for _ in range(3):
                with self.assertRaises(llm.LLMRefusalError):
                    self._refused_call()()
        self.assertEqual(breaker.snapshot()["state"], "closed")

    def test_unhandled_refusal_is_a_422_with_the_fixed_message_not_a_502(self):
        status, detail = llm.classify_llm_error(llm.LLMRefusalError("x"))
        self.assertEqual((status, detail), (422, llm.REFUSAL_MESSAGE))
