"""路線圖 #5：每人每日提問額度（資料庫計數、台灣午夜重置、退還、資料庫出錯時拒絕）與它在 view 的行為。"""
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.db import IntegrityError
from django.test import Client, TestCase

from AIModel import quota
from AIModel.tests import _mock_chat_client
from adminapi.models import AiDailyUsage, FeatureFlag, RateLimitRule

# 台灣 2026-10-21 23:59 與 2026-10-22 00:00（UTC 15:59 與 16:00）
BEFORE_MIDNIGHT = datetime(2026, 10, 21, 15, 59, tzinfo=timezone.utc)
AFTER_MIDNIGHT = datetime(2026, 10, 21, 16, 0, tzinfo=timezone.utc)


class DailyLimitTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_default_is_one_hundred_when_no_rule_exists(self):
        self.assertEqual(quota.daily_limit(), 100)

    def test_the_admin_rate_rule_sets_the_limit(self):
        RateLimitRule.objects.create(key="ai_daily_quota", backend="django", rate="7/d", default_rate="100/d")
        self.assertEqual(quota.daily_limit(), 7)

    def test_a_rule_that_is_not_per_day_falls_back_to_the_default_and_says_so(self):
        RateLimitRule.objects.create(key="ai_daily_quota", backend="django", rate="5/m", default_rate="100/d")
        with self.assertLogs("AIModel.quota", level="ERROR"):
            self.assertEqual(quota.daily_limit(), 100)


class ConsumeTests(TestCase):
    def setUp(self):
        cache.clear()
        patcher = patch.object(quota, "daily_limit", return_value=3)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_each_question_counts_until_the_limit_then_is_refused_without_counting(self):
        remaining = [quota.consume("u1", BEFORE_MIDNIGHT).remaining for _ in range(3)]
        self.assertEqual(remaining, [2, 1, 0])
        denied = quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertFalse(denied.allowed)
        self.assertEqual((denied.limit, denied.remaining), (3, 0))
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 3)          # 被拒絕的那次不加

    def test_users_are_counted_separately(self):
        for _ in range(3):
            quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertTrue(quota.consume("u2", BEFORE_MIDNIGHT).allowed)

    def test_the_count_resets_at_taipei_midnight_not_utc_midnight(self):
        for _ in range(3):
            quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertFalse(quota.consume("u1", BEFORE_MIDNIGHT).allowed)
        fresh = quota.consume("u1", AFTER_MIDNIGHT)
        self.assertTrue(fresh.allowed)
        self.assertEqual(fresh.remaining, 2)

    def test_reset_time_is_the_next_taipei_midnight(self):
        result = quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertEqual(result.resets_at, "2026-10-22T00:00:00+08:00")
        self.assertEqual(result.retry_after_seconds(BEFORE_MIDNIGHT), 60)

    def test_a_limit_of_zero_refuses_everything_even_the_first_question(self):
        with patch.object(quota, "daily_limit", return_value=0):
            self.assertFalse(quota.consume("u1", BEFORE_MIDNIGHT).allowed)
        self.assertFalse(AiDailyUsage.objects.exists())

    def test_peek_reports_without_consuming(self):
        quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertEqual(quota.peek("u1", BEFORE_MIDNIGHT).remaining, 2)
        self.assertEqual(quota.peek("u1", BEFORE_MIDNIGHT).remaining, 2)
        self.assertEqual(quota.peek("nobody", BEFORE_MIDNIGHT).remaining, 3)

    def test_losing_the_creation_race_falls_back_to_a_normal_increment(self):
        """今天第一次提問時兩個請求同時建立那一列：輸的那個要改走 UPDATE，而不是失敗或雙雙放行。"""
        updates = iter([0, 1])
        usage = MagicMock()
        usage.objects.filter.return_value.update.side_effect = lambda **kw: next(updates)
        usage.objects.filter.return_value.values_list.return_value.first.return_value = 2
        usage.objects.create.side_effect = IntegrityError("duplicate")
        with patch.object(quota, "_model", return_value=usage):
            result = quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertTrue(result.allowed)
        self.assertEqual(result.remaining, 1)

    def test_a_broken_database_refuses_the_question_instead_of_letting_it_through(self):
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = 0.0
        with patch.object(quota, "_model", side_effect=RuntimeError("table missing")):
            with self.assertLogs("AIModel.quota", level="ERROR"):
                result = quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertFalse(result.allowed)
        self.assertTrue(result.unavailable)
        self.assertFalse(result.tracked)
        data = result.as_dict()
        self.assertTrue(data["unavailable"])
        self.assertIsNone(data["remaining"])        # 不虛構「還剩滿額」

    def test_peek_on_a_broken_database_is_unavailable_not_a_made_up_balance(self):
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = 0.0
        with patch.object(quota, "_model", side_effect=RuntimeError("x")), self.assertLogs("AIModel.quota", level="ERROR"):
            peeked = quota.peek("u1", BEFORE_MIDNIGHT)
        self.assertTrue(peeked.unavailable)
        self.assertFalse(peeked.allowed)

    def test_an_open_breaker_does_not_even_read_the_dynamic_limit_from_the_database(self):
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = quota.time.monotonic() + 60
        with patch.object(quota, "daily_limit") as limit, patch.object(quota, "_model") as model:
            self.assertTrue(quota.consume("u1", BEFORE_MIDNIGHT).unavailable)
            self.assertTrue(quota.peek("u1", BEFORE_MIDNIGHT).unavailable)
        limit.assert_not_called()
        model.assert_not_called()

    def test_a_failed_cleanup_never_changes_the_result_of_a_successful_count(self):
        real_filter = AiDailyUsage.objects.filter

        def filter_that_fails_on_purge(*args, **kwargs):
            if "day__lt" in kwargs:
                raise RuntimeError("purge failed")
            return real_filter(*args, **kwargs)

        with patch.object(quota, "_PURGE_PROBABILITY", 1.0),                 patch.object(AiDailyUsage.objects, "filter", side_effect=filter_that_fails_on_purge),                 self.assertLogs("AIModel.quota", level="ERROR"):
            result = quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertTrue(result.allowed)
        self.assertFalse(result.unavailable)

    def test_a_failure_after_the_increment_rolls_the_count_back(self):
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = 0.0
        quota.consume("u1", BEFORE_MIDNIGHT)                 # 先有一列、count=1
        real_filter = AiDailyUsage.objects.filter
        calls = {"n": 0}

        def flaky(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:                              # 第 2 次呼叫是「讀回 count」
                raise RuntimeError("readback failed")
            return real_filter(*args, **kwargs)

        with patch.object(AiDailyUsage.objects, "filter", side_effect=flaky), self.assertLogs("AIModel.quota", level="ERROR"):
            result = quota.consume("u1", BEFORE_MIDNIGHT)
        self.assertTrue(result.unavailable)
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 1)     # 沒有白扣

    def test_the_breaker_skips_the_database_for_a_few_seconds_then_recovers(self):
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = 0.0
        with patch.object(quota, "_model", side_effect=RuntimeError("x")) as model, self.assertLogs("AIModel.quota", level="ERROR"):
            quota.consume("u1", BEFORE_MIDNIGHT)
            quota.consume("u1", BEFORE_MIDNIGHT)
            quota.peek("u1", BEFORE_MIDNIGHT)
        self.assertEqual(model.call_count, 1)       # 第一次出錯後，期間內不再碰資料庫
        quota._broken_until = 0.0                   # 斷路器到期
        self.assertTrue(quota.consume("u1", BEFORE_MIDNIGHT).allowed)


class RefundTests(TestCase):
    def setUp(self):
        patcher = patch.object(quota, "daily_limit", return_value=3)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_refund_gives_one_back_and_never_goes_below_zero(self):
        first = quota.consume("u1", BEFORE_MIDNIGHT)
        quota.refund("u1", first.day)
        quota.refund("u1", first.day)
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 0)

    def test_refund_without_a_day_or_with_a_broken_database_is_harmless(self):
        quota.refund("u1", None)
        with patch.object(quota, "_model", side_effect=RuntimeError("x")), self.assertLogs("AIModel.quota", level="ERROR"):
            quota.refund("u1", quota.taipei_today())


class QuotaInViewsTests(TestCase):
    def setUp(self):
        cache.clear()
        for name, value in (("verify", ({"uid": "u1"}, None)), ("profile", None)):
            target = "AIModel.views.verify_firebase_token" if name == "verify" else "AIModel.views.load_profile"
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        limit = patch.object(quota, "daily_limit", return_value=2)
        limit.start()
        self.addCleanup(limit.stop)

    def _chat(self, payload=None):
        return Client().post(
            "/AIModel/tayal_chat/", data=json.dumps(payload or {"message": "你好"}), content_type="application/json",
        )

    @patch("AIModel.views._get_client")
    def test_a_successful_answer_reports_the_remaining_questions(self, get_client):
        get_client.return_value = _mock_chat_client("哈囉")
        body = self._chat().json()
        self.assertEqual(body["quota"]["limit"], 2)
        self.assertEqual(body["quota"]["remaining"], 1)
        self.assertTrue(body["quota"]["tracked"])

    @patch("AIModel.views._get_client")
    def test_the_question_after_the_last_one_gets_429_with_a_reset_time_and_never_reaches_the_model(self, get_client):
        client = _mock_chat_client("哈囉")
        get_client.return_value = client
        self._chat()
        self._chat()
        calls_before = client.messages.create.call_count
        response = self._chat()
        self.assertEqual(response.status_code, 429)
        body = response.json()
        self.assertEqual(body["code"], "ai_daily_quota_exceeded")
        self.assertEqual(body["quota"]["remaining"], 0)
        self.assertIn("+08:00", body["quota"]["resetsAt"])
        self.assertGreaterEqual(int(response["Retry-After"]), 1)
        self.assertEqual(client.messages.create.call_count, calls_before)

    @patch("AIModel.views._get_client")
    def test_a_failed_model_call_gives_the_question_back(self, get_client):
        client = MagicMock()
        client.messages.create.side_effect = RuntimeError("boom")
        get_client.return_value = client
        self.assertEqual(self._chat().status_code, 502)
        self.assertEqual(AiDailyUsage.objects.get(uid="u1").count, 0)

    @patch("AIModel.views._get_client")
    def test_a_broken_quota_database_gives_503_and_never_reaches_the_model_or_refunds(self, get_client):
        client = _mock_chat_client("不該被呼叫")
        get_client.return_value = client
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = 0.0
        with patch.object(quota, "_model", side_effect=RuntimeError("table missing")),                 patch("AIModel.views.daily_quota.refund") as refund, self.assertLogs("AIModel.quota", level="ERROR"):
            response = self._chat()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "ai_quota_unavailable")
        self.assertNotIn("table missing", response.content.decode("utf-8"))
        client.messages.create.assert_not_called()
        refund.assert_not_called()

    def test_the_quota_endpoint_is_503_when_the_database_is_broken(self):
        self.addCleanup(setattr, quota, "_broken_until", 0.0)
        quota._broken_until = 0.0
        with patch.object(quota, "_model", side_effect=RuntimeError("x")), self.assertLogs("AIModel.quota", level="ERROR"):
            response = Client().get("/AIModel/quota/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "ai_quota_unavailable")

    @patch("AIModel.views._get_client")
    def test_invalid_requests_do_not_use_up_a_question(self, get_client):
        get_client.return_value = _mock_chat_client("x")
        self.assertEqual(self._chat({"message": ""}).status_code, 400)
        self.assertEqual(self._chat({"message": "hi", "tribe": "nope"}).status_code, 400)
        self.assertFalse(AiDailyUsage.objects.exists())

    @patch("AIModel.views._get_client")
    def test_while_the_assistant_is_switched_off_nothing_is_counted(self, get_client):
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI", enabled=False)
        self.assertEqual(self._chat().status_code, 403)
        self.assertFalse(AiDailyUsage.objects.exists())

    @patch("AIModel.views.search_tayal_words_bulk", return_value={})
    @patch("AIModel.views._get_client")
    def test_the_review_endpoint_shares_the_same_daily_allowance(self, get_client, _words):
        get_client.return_value = _mock_chat_client("補充")
        post = lambda: Client().post(
            "/AIModel/review_tayal_chat/", data=json.dumps({"message": "lokah su"}), content_type="application/json",
        )
        self._chat()
        first = post()
        self.assertEqual(first.json()["quota"]["remaining"], 0)
        self.assertEqual(post().status_code, 429)

    def test_the_quota_endpoint_reads_without_consuming_and_only_accepts_get(self):
        client = Client()
        for _ in range(2):
            body = client.get("/AIModel/quota/").json()
            self.assertEqual((body["limit"], body["remaining"]), (2, 2))
        self.assertFalse(AiDailyUsage.objects.exists())
        self.assertEqual(client.post("/AIModel/quota/").status_code, 405)
