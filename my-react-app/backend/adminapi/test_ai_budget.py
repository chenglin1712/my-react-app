"""路線圖 #5：全站月預算（80% 提醒、100% 自動關閉助手、之後手動開啟不會被再次關閉）。

價目：claude-sonnet-5 輸入 $2／百萬 token、輸出 $10／百萬 token（見 ai_usage.MODEL_PRICES_PER_MTOK）。
"""
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from adminapi import ai_budget
from adminapi.ai_usage import summarize
from adminapi.models import AiUsageLog, AuditLog, FeatureFlag

MODEL = "claude-sonnet-5"


def spend(dollars, model=MODEL, when=None):
    """寫一筆用量，輸入 token 剛好等於這個金額（輸入 $2／百萬 token）。"""
    row = AiUsageLog.objects.create(
        feature="chat", model=model, status="ok", input_tokens=int(dollars / 2 * 1_000_000),
    )
    if when is not None:
        AiUsageLog.objects.filter(pk=row.pk).update(created_at=when)
    return row


class BudgetSettingTests(TestCase):
    def test_only_a_positive_number_counts_as_a_budget(self):
        for raw, expected in (("50", 50.0), (" 12.5 ", 12.5), ("", None), ("abc", None), ("0", None), ("-3", None), ("inf", None)):
            with self.subTest(raw=raw), patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": raw}):
                self.assertEqual(ai_budget.monthly_budget_usd(), expected)

    def test_a_budget_that_is_filled_in_but_invalid_is_reported_not_silently_ignored(self):
        ai_budget._invalid_budget_reported.clear()
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "five"}), self.assertLogs("adminapi.ai_budget", level="ERROR"):
            self.assertIsNone(ai_budget.monthly_budget_usd())

    def test_the_month_boundary_is_taipei_midnight_regardless_of_django_time_zone(self):
        from datetime import datetime, timezone as tz
        # 台灣 10/31 23:59 與 11/1 00:00（UTC 15:59 與 16:00）
        before = ai_budget.month_start(datetime(2026, 10, 31, 15, 59, tzinfo=tz.utc))
        after = ai_budget.month_start(datetime(2026, 10, 31, 16, 0, tzinfo=tz.utc))
        self.assertEqual((before.month, after.month), (10, 11))
        self.assertEqual(after.isoformat(), "2026-11-01T00:00:00+08:00")

    def test_unset_budget_means_nothing_happens(self):
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI", enabled=True)
        spend(1000)
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": ""}):
            self.assertEqual(ai_budget.enforce()["level"], "none")
        self.assertTrue(FeatureFlag.objects.get(key="ai_assistant_enabled").enabled)


class EvaluateTests(TestCase):
    def setUp(self):
        cache.clear()
        patcher = patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "10"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_levels_follow_the_eighty_and_hundred_percent_thresholds(self):
        for dollars, level in ((1, "ok"), (7.9, "ok"), (8, "warning"), (9.9, "warning"), (10, "exceeded"), (25, "exceeded")):
            with self.subTest(dollars=dollars):
                AiUsageLog.objects.all().delete()
                spend(dollars)
                self.assertEqual(ai_budget.evaluate(use_cache=False)["level"], level)

    def test_only_this_month_counts_and_breaker_events_are_ignored(self):
        spend(9)                                                              # 本月
        spend(500, when=ai_budget.month_start() - timedelta(days=1))          # 上個月
        AiUsageLog.objects.create(feature="breaker", model=MODEL, status="opened")
        result = ai_budget.evaluate(use_cache=False)
        self.assertAlmostEqual(result["spentUsd"], 9.0, places=2)
        self.assertEqual(result["level"], "warning")

    def test_output_and_cache_tokens_are_priced(self):
        AiUsageLog.objects.create(
            feature="chat", model=MODEL, status="ok", input_tokens=1_000_000, output_tokens=1_000_000,
            cache_read_tokens=1_000_000, cache_write_tokens=1_000_000,
        )
        # 輸入 2 + 輸出 10 + 快取讀取 0.2 + 快取寫入 2.5
        self.assertAlmostEqual(ai_budget.evaluate(use_cache=False)["spentUsd"], 14.7, places=2)

    def test_a_model_missing_from_the_price_table_is_flagged_incomplete_and_priced_at_the_highest_known_rate(self):
        spend(1)
        AiUsageLog.objects.create(feature="chat", model="some-new-model", status="ok", input_tokens=5_000_000)
        result = ai_budget.evaluate(use_cache=False)
        self.assertTrue(result["incomplete"])
        # 5 百萬輸入 token × 表中最貴輸入價 $10／百萬 = $50，加上前面的 $1；漏算會讓預算保護失效
        self.assertAlmostEqual(result["spentUsd"], 51.0, places=2)
        self.assertEqual(result["level"], "exceeded")

    def test_the_result_is_cached_but_a_changed_budget_is_not_served_from_the_old_cache(self):
        spend(1)
        self.assertEqual(ai_budget.evaluate()["level"], "ok")
        spend(20)
        self.assertEqual(ai_budget.evaluate()["level"], "ok")                 # 60 秒內沿用快取
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "15"}):
            self.assertEqual(ai_budget.evaluate()["level"], "exceeded")       # 預算改了就重算


class EnforceTests(TestCase):
    def setUp(self):
        cache.clear()
        patcher = patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "10"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.flag = FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI", enabled=True)

    def test_eighty_percent_warns_once_per_month_and_does_not_switch_anything_off(self):
        spend(8.5)
        with self.assertLogs("adminapi.ai_budget", level="ERROR") as logs:
            ai_budget.enforce()
        self.assertIn("85%", logs.output[0])
        cache.delete("adminapi:ai_budget:evaluation")
        with self.assertNoLogs("adminapi.ai_budget", level="ERROR"):
            ai_budget.enforce()
        self.flag.refresh_from_db()
        self.assertTrue(self.flag.enabled)

    def test_hundred_percent_switches_the_assistant_off_and_writes_an_audit_record(self):
        spend(10.5)
        with self.assertLogs("adminapi.ai_budget", level="CRITICAL"):
            result = ai_budget.enforce()
        self.assertEqual(result["level"], "exceeded")
        self.flag.refresh_from_db()
        self.assertFalse(self.flag.enabled)
        self.assertEqual(self.flag.updated_by, "system:ai_budget")
        audit = AuditLog.objects.get(action="ai_budget_auto_disable")
        self.assertEqual((audit.actor_uid, audit.target_id), ("system", "ai_assistant_enabled"))
        self.assertEqual(audit.before, {"enabled": True})
        self.assertEqual(audit.after["enabled"], False)

    def test_after_an_admin_turns_it_back_on_it_is_not_switched_off_again_this_month(self):
        spend(10.5)
        with self.assertLogs("adminapi.ai_budget", level="CRITICAL"):
            ai_budget.enforce()
        FeatureFlag.objects.filter(key="ai_assistant_enabled").update(enabled=True)
        cache.clear()
        spend(5)
        ai_budget.enforce()
        self.assertTrue(FeatureFlag.objects.get(key="ai_assistant_enabled").enabled)
        self.assertEqual(AuditLog.objects.filter(action="ai_budget_auto_disable").count(), 1)

    def test_an_admin_who_already_switched_it_off_does_not_use_up_the_monthly_auto_disable(self):
        FeatureFlag.objects.filter(key="ai_assistant_enabled").update(enabled=False)
        spend(10.5)
        ai_budget.enforce()
        self.assertFalse(AuditLog.objects.filter(action="ai_budget_auto_disable").exists())

    def test_a_missing_flag_row_is_reported_loudly_instead_of_pretending_it_was_switched_off(self):
        self.flag.delete()
        spend(10.5)
        with self.assertLogs("adminapi.ai_budget", level="ERROR") as logs:
            ai_budget.enforce()
        self.assertTrue(any("找不到旗標" in line for line in logs.output))
        self.assertFalse(AuditLog.objects.filter(action="ai_budget_auto_disable").exists())

    def test_a_failure_inside_the_check_never_raises_into_the_request(self):
        with patch.object(ai_budget, "evaluate", side_effect=RuntimeError("db down")):
            with self.assertLogs("adminapi.ai_budget", level="ERROR"):
                self.assertEqual(ai_budget.enforce()["level"], "none")


class BudgetInUsageSummaryTests(TestCase):
    def test_the_summary_exposes_budget_state_and_the_per_user_daily_limit(self):
        cache.clear()
        spend(9)
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "10"}):
            budget = summarize(7)["budget"]
        self.assertEqual((budget["level"], budget["budgetUsd"], budget["warnRatio"]), ("warning", 10.0, 0.8))
        self.assertEqual(budget["dailyLimitPerUser"], 100)
        self.assertIn("monthStart", budget)

    def test_without_a_budget_the_summary_says_so(self):
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": ""}):
            budget = summarize(7)["budget"]
        self.assertEqual((budget["level"], budget["budgetUsd"]), ("none", None))


class BudgetGateInViewsTests(TestCase):
    """超過預算後，下一個到達的 AI 助手請求會觸發自動關閉並得到 403。"""

    def setUp(self):
        cache.clear()
        FeatureFlag.objects.create(key="ai_assistant_enabled", label="AI", enabled=True)
        for target in ("AIModel.views.verify_firebase_token",):
            patcher = patch(target, return_value=({"uid": "u1"}, None))
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_the_first_request_after_the_budget_is_exceeded_is_refused_and_flips_the_flag(self):
        import json
        from django.test import Client

        spend(11)
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "10"}), self.assertLogs("adminapi.ai_budget", level="CRITICAL"):
            response = Client().post(
                "/AIModel/tayal_chat/", data=json.dumps({"message": "你好"}), content_type="application/json",
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "ai_assistant_disabled")
        self.assertFalse(FeatureFlag.objects.get(key="ai_assistant_enabled").enabled)
