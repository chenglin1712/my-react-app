"""路線圖 #9：串流回覆——stream_claude（斷路器、用量、拒答、取消）、stream_tayal_chat 的事件，
以及 /AIModel/tayal_chat/stream/ 的 SSE 內容、錯誤與額度行為。"""
import json
import os
from unittest.mock import MagicMock, patch

import anthropic
import httpx
from django.core.cache import cache
from django.test import Client, TestCase

from AIModel import quota as daily_quota
from AIModel import views
from AIModel.services import OFF_TOPIC_MESSAGE, sign_reply, stream_tayal_chat
from AIModel.test_dictionary_tools import _FakeLookup, _tool_use_response
from AIModel.tests import _mock_response
from adminapi.models import AiDailyUsage
from config import llm
from config.llm import REFUSAL_MESSAGE, LLMRefusalError


class FakeStream:
    """messages.stream() 回傳的 context manager 的替身。texts 逐段送出；fail 不是 None 時，送完 texts 後丟出它。"""

    def __init__(self, texts=(), final=None, fail=None):
        self.texts, self.fail = list(texts), fail
        self.final = final if final is not None else _mock_response("".join(texts))
        self.closed = False
        self.current_message_snapshot = MagicMock(usage=MagicMock(input_tokens=11, output_tokens=2))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True
        return False

    @property
    def text_stream(self):
        yield from self.texts
        if self.fail is not None:
            raise self.fail

    def get_final_message(self):
        return self.final


def _client(*streams):
    client = MagicMock()
    client.messages.stream.side_effect = list(streams)
    client.with_options.return_value = client       # 設了整體截止時間時，呼叫會經過 with_options
    return client


def _timeout():
    return anthropic.APITimeoutError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))


def _drain(generator):
    """跑完一個 generator，回傳 (yield 出來的東西, return 值)。"""
    items = []
    try:
        while True:
            items.append(next(generator))
    except StopIteration as stop:
        return items, stop.value


class StreamClaudeTests(TestCase):
    def setUp(self):
        self.entries = []
        self.addCleanup(llm.set_usage_recorder, llm._usage_recorder)
        llm.set_usage_recorder(self.entries.append)
        patcher = patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=2, cooldown=60))
        self.breaker = patcher.start()
        self.addCleanup(patcher.stop)

    def _stream(self, client, **kw):
        return llm.stream_claude(client, feature="chat", system="s", messages=[{"role": "user", "content": "hi"}], uid="u1", **kw)

    def test_text_comes_out_piece_by_piece_and_the_final_message_is_returned(self):
        stream = FakeStream(["你", "好"])
        texts, final = _drain(self._stream(_client(stream)))
        self.assertEqual(texts, ["你", "好"])
        self.assertEqual(llm.extract_text(final), "你好")
        self.assertTrue(stream.closed)
        self.assertEqual([e["status"] for e in self.entries], ["ok"])

    def test_the_request_has_the_same_shape_as_a_normal_call_including_tools(self):
        client = _client(FakeStream(["x"]))
        _drain(self._stream(client, tools=[{"name": "t"}], tool_choice={"type": "none"}))
        request = client.messages.stream.call_args.kwargs
        self.assertEqual((request["model"], request["tool_choice"]), ("claude-sonnet-5", {"type": "none"}))
        self.assertEqual(request["tools"], [{"name": "t"}])
        self.assertNotIn("stream", request)

    def test_a_refusal_is_known_only_at_the_end_and_raises_after_the_text(self):
        refused = _mock_response("")
        refused.stop_reason = "refusal"
        refused.stop_details = MagicMock(category="other")
        generator = self._stream(_client(FakeStream(["部分"], final=refused)))
        self.assertEqual(next(generator), "部分")
        with self.assertLogs("config.llm", level="WARNING"), self.assertRaises(LLMRefusalError):
            next(generator)
        self.assertEqual(self.entries[-1]["status"], "refusal")
        self.assertEqual(self.breaker.snapshot()["consecutiveFailures"], 0)     # 拒答不算供應商故障

    def test_a_connection_that_drops_mid_stream_counts_against_the_breaker_and_is_recorded(self):
        generator = self._stream(_client(FakeStream(["半截"], fail=_timeout())))
        self.assertEqual(next(generator), "半截")
        with self.assertRaises(anthropic.APITimeoutError):
            next(generator)
        self.assertEqual(self.entries[-1]["status"], "timeout")
        self.assertEqual(self.breaker.snapshot()["consecutiveFailures"], 1)

    def test_closing_the_generator_cancels_cleanly_without_blaming_the_provider(self):
        stream = FakeStream(["一", "二", "三"])
        generator = self._stream(_client(stream))
        next(generator)
        generator.close()                                   # 使用者按停止／連線關閉
        self.assertTrue(stream.closed)                      # 串流確實被中止
        entry = self.entries[-1]
        self.assertEqual(entry["status"], "cancelled")
        self.assertEqual((entry["input_tokens"], entry["output_tokens"]), (11, 2))
        self.assertEqual(self.breaker.snapshot()["consecutiveFailures"], 0)

    def test_an_open_breaker_refuses_before_any_request_is_made(self):
        for _ in range(2):
            self.breaker.record_failure(False)
        client = _client()
        with self.assertRaises(llm.LLMUnavailableError):
            next(self._stream(client))
        client.messages.stream.assert_not_called()

    def test_cancelling_a_half_open_probe_after_it_got_text_proves_the_provider_is_up_and_closes_the_breaker(self):
        # generator 只會在 yield 處被關閉，所以「取消」一定發生在收到第一個字之後
        breaker = llm._CircuitBreaker(threshold=1, cooldown=0)
        breaker.record_failure(False)
        with patch.object(llm, "_breaker", breaker):
            generator = self._stream(_client(FakeStream(["a"])))
            next(generator)
            generator.close()
        self.assertEqual(breaker.snapshot()["state"], "closed")

    def test_the_light_model_has_its_own_breaker_so_its_failures_cannot_block_the_main_model(self):
        light = llm._CircuitBreaker(threshold=1, cooldown=60)
        with patch.object(llm, "_light_breaker", light):
            failing = MagicMock()
            failing.messages.create.side_effect = _timeout()
            with self.assertRaises(anthropic.APITimeoutError):
                llm.call_claude(failing, feature="route", system="s", messages=[{"role": "user", "content": "x"}], uid="u")
            self.assertEqual(light.snapshot()["state"], "open")
            self.assertEqual(self.breaker.snapshot()["consecutiveFailures"], 0)      # 主模型的斷路器沒被牽動
            ok = MagicMock()
            ok.messages.create.return_value = _mock_response("fine")
            llm.call_claude(ok, feature="chat", system="s", messages=[{"role": "user", "content": "x"}], uid="u")


class DeadlineTests(TestCase):
    """設了整體截止時間後，每次呼叫的逾時被壓在剩餘時間內，並且不重試。"""

    def setUp(self):
        self.addCleanup(llm.set_usage_recorder, llm._usage_recorder)
        llm.set_usage_recorder(None)
        patcher = patch.object(llm, "_breaker", llm._CircuitBreaker(threshold=2, cooldown=60))
        self.breaker = patcher.start()
        self.addCleanup(patcher.stop)

    def _set_deadline(self, seconds_from_now):
        import time
        token = llm.llm_deadline.set(time.monotonic() + seconds_from_now)
        self.addCleanup(llm.llm_deadline.reset, token)

    def test_the_call_timeout_is_capped_by_the_remaining_time_and_retries_are_off(self):
        self._set_deadline(10)
        client = _client(FakeStream(["x"]))
        _drain(llm.stream_claude(client, feature="chat", system="s", messages=[{"role": "user", "content": "x"}]))
        options = client.with_options.call_args.kwargs
        self.assertEqual(options["max_retries"], 0)
        self.assertLessEqual(options["timeout"], 10)

    def test_too_little_time_left_raises_before_any_request_and_without_touching_the_breaker(self):
        self._set_deadline(0.5)
        client = _client()
        with self.assertRaises(llm.LLMDeadlineError):
            llm.call_claude(client, feature="chat", system="s", messages=[{"role": "user", "content": "x"}])
        client.messages.create.assert_not_called()
        self.assertEqual(self.breaker.snapshot()["consecutiveFailures"], 0)
        self.assertIsInstance(llm.LLMDeadlineError("x"), TimeoutError)

    def test_without_a_deadline_the_client_is_used_as_is(self):
        client = MagicMock()
        client.messages.create.return_value = _mock_response("ok")
        llm.call_claude(client, feature="chat", system="s", messages=[{"role": "user", "content": "x"}])
        client.with_options.assert_not_called()


def _chat(client, **kw):
    kwargs = dict(profile={}, uid="u1", history=[], lookup=None)
    kwargs.update(kw)
    return list(stream_tayal_chat(client, "泰雅語", kw.pop("message", "你好嗎"), **{k: v for k, v in kwargs.items() if k != "message"}))


class StreamTayalChatTests(TestCase):
    def test_deltas_then_one_signed_done_with_the_full_text(self):
        events = _chat(_client(FakeStream(["你好", "，同學"])))
        self.assertEqual([e["type"] for e in events], ["delta", "delta", "done"])
        done = events[-1]
        self.assertEqual(done["message"], "你好，同學")
        self.assertEqual(done["sig"], sign_reply("u1", "你好，同學"))

    def test_the_dictionary_tool_loop_streams_every_round_and_returns_all_the_text(self):
        first = FakeStream(["我來查一下。"], final=_tool_use_response(("search_words", {"keywords": ["lokah"]})))
        second = FakeStream(["辭典收錄：你好。"])
        client = _client(first, second)
        events = _chat(client, lookup=_FakeLookup({"lokah": ["你好"]}))
        self.assertEqual(events[-1]["message"], "我來查一下。辭典收錄：你好。")
        self.assertEqual(client.messages.stream.call_count, 2)
        self.assertTrue(first.closed and second.closed)

    def test_a_refusal_after_some_text_ends_with_the_fixed_message_so_the_client_can_replace_it(self):
        refused = _mock_response("")
        refused.stop_reason = "refusal"
        refused.stop_details = None
        events = _chat(_client(FakeStream(["開頭"], final=refused)))
        self.assertEqual(events[0], {"type": "delta", "t": "開頭"})
        self.assertEqual((events[-1]["message"], events[-1]["refused"]), (REFUSAL_MESSAGE, True))

    def test_a_study_plan_is_not_streamed_it_arrives_whole_in_done(self):
        plan = {"title": "一週", "events": []}
        client = MagicMock()
        client.messages.create.return_value = _mock_response(json.dumps(plan))
        with patch("AIModel.services.validate_study_plan", return_value=plan):
            events = _chat(client, message="幫我排一週讀書計畫")
        self.assertEqual([e["type"] for e in events], ["done"])
        self.assertIn("study_plan", events[0])
        client.messages.stream.assert_not_called()

    @patch.dict(os.environ, {"AI_INTENT_ROUTING": "1"})
    def test_with_routing_off_topic_ends_immediately_without_streaming_the_big_model(self):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(json.dumps({"intent": "off_topic", "confidence": "high"}))
        events = _chat(client)
        self.assertEqual([e["type"] for e in events], ["done"])
        self.assertEqual(events[0]["message"], OFF_TOPIC_MESSAGE)
        client.messages.stream.assert_not_called()

    @patch.dict(os.environ, {"AI_INTENT_ROUTING": "1"})
    def test_chitchat_streams_from_the_light_model(self):
        client = _client(FakeStream(["嗨！"]))
        client.messages.create.return_value = _mock_response(json.dumps({"intent": "chitchat", "confidence": "high"}))
        events = _chat(client)
        self.assertEqual(events[-1]["message"], "嗨！")
        self.assertEqual(client.messages.stream.call_args.kwargs["model"], "claude-haiku-5-5")


def _parse_sse(response):
    """把 SSE 內容拆成 [(event, data)]。"""
    raw = b"".join(response.streaming_content).decode("utf-8")
    events = []
    for block in filter(None, raw.split("\n\n")):
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append((lines["event"], json.loads(lines["data"])))
    return events


class StreamEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        for target, value in (("verify_firebase_token", ({"uid": "u1"}, None)), ("load_profile", None)):
            patcher = patch(f"AIModel.views.{target}", return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        limit = patch.object(daily_quota, "daily_limit", return_value=3)
        limit.start()
        self.addCleanup(limit.stop)

    def _post(self, payload=None):
        return Client().post(
            "/AIModel/tayal_chat/stream/", data=json.dumps(payload or {"message": "你好"}), content_type="application/json",
        )

    @patch("AIModel.views._get_client")
    def test_the_response_is_an_unbuffered_event_stream_with_deltas_then_done_and_quota(self, get_client):
        get_client.return_value = _client(FakeStream(["哈", "囉"]))
        response = self._post()
        self.assertTrue(response.streaming)
        self.assertEqual(response["Content-Type"], "text/event-stream; charset=utf-8")
        self.assertEqual(response["X-Accel-Buffering"], "no")
        self.assertIn("no-cache", response["Cache-Control"])
        events = _parse_sse(response)
        self.assertEqual([name for name, _ in events], ["delta", "delta", "done"])
        done = events[-1][1]
        self.assertEqual((done["message"], done["quota"]["remaining"]), ("哈囉", 2))
        self.assertEqual(done["sig"], sign_reply("u1", "哈囉"))

    @patch("AIModel.views._get_client")
    def test_errors_before_streaming_are_ordinary_json_with_the_same_codes_as_the_normal_endpoint(self, get_client):
        get_client.return_value = _client()
        self.assertEqual(self._post({"message": ""}).status_code, 400)
        self.assertEqual(Client().get("/AIModel/tayal_chat/stream/").status_code, 405)
        self.assertFalse(AiDailyUsage.objects.exists())                           # 格式錯誤不扣額度

        with patch.object(daily_quota, "daily_limit", return_value=0):
            response = self._post()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "ai_daily_quota_exceeded")

    @patch("AIModel.views._get_client")
    def test_a_failure_halfway_becomes_an_error_event_and_gives_the_question_back(self, get_client):
        get_client.return_value = _client(FakeStream(["半截"], fail=_timeout()))
        with self.assertLogs("AIModel.views", level="ERROR"):
            events = _parse_sse(self._post())
        self.assertEqual([name for name, _ in events], ["delta", "error"])
        self.assertEqual(events[-1][1]["status"], 504)
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 0)

    @patch("AIModel.views._get_client")
    def test_a_refusal_ends_with_done_flagged_refused_and_keeps_the_question_counted(self, get_client):
        refused = _mock_response("")
        refused.stop_reason = "refusal"
        refused.stop_details = None
        get_client.return_value = _client(FakeStream(["開頭"], final=refused))
        events = _parse_sse(self._post())
        done = events[-1][1]
        self.assertEqual((events[-1][0], done["message"], done["refused"]), ("done", REFUSAL_MESSAGE, True))
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 1)

    @patch("AIModel.views._get_client")
    def test_the_user_stopping_does_not_refund_and_closes_the_upstream_stream(self, get_client):
        upstream = FakeStream(["一", "二", "三"])
        get_client.return_value = _client(upstream)
        response = self._post()
        iterator = iter(response.streaming_content)
        next(iterator)                                       # 收到第一段後使用者按停止，伺服器收到連線關閉
        # 伺服器關閉的是 SSE generator。不用 response.close()：它會連帶觸發 request_finished 而關掉測試的資料庫連線。
        response._iterator.close()
        self.assertTrue(upstream.closed)
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 1)

    @patch("AIModel.views._get_client")
    def test_a_stream_that_runs_past_the_deadline_is_ended_with_a_timeout_error_event(self, get_client):
        get_client.return_value = _client(FakeStream(["一", "二", "三"]))
        with patch.object(views, "STREAM_DEADLINE_SECONDS", -1), self.assertLogs("AIModel.views", level="ERROR"):
            events = _parse_sse(self._post())
        self.assertEqual(events[-1][0], "error")
        self.assertEqual(events[-1][1]["status"], 504)
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 0)
