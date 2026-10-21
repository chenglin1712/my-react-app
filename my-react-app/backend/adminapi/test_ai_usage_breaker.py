"""後台「AI 用量」的斷路器區塊（路線圖 #6）：事件存在用量表，但不能混進呼叫統計。"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from adminapi.ai_usage import summarize
from adminapi.models import AiUsageLog


class BreakerSummaryTests(TestCase):
    def _event(self, status, minutes_ago):
        row = AiUsageLog.objects.create(feature="breaker", model="claude-sonnet-5", status=status)
        AiUsageLog.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(minutes=minutes_ago))

    def test_events_are_listed_newest_first_with_a_label_and_a_last_event(self):
        self._event("opened", 30)
        self._event("half_open", 10)
        self._event("closed", 9)
        breaker = summarize(7)["breaker"]
        self.assertEqual([e["event"] for e in breaker["events"]], ["closed", "half_open", "opened"])
        self.assertEqual(breaker["lastEvent"], "closed")
        self.assertIn("恢復正常", breaker["events"][0]["label"])

    def test_events_are_not_counted_as_api_calls_cost_or_errors(self):
        AiUsageLog.objects.create(feature="chat", model="claude-sonnet-5", status="ok", input_tokens=100, output_tokens=10)
        for status in ("opened", "half_open", "probe_failed"):
            self._event(status, 5)
        result = summarize(7)
        self.assertEqual(result["totals"]["calls"], 1)
        self.assertEqual(result["totals"]["errors"], 0)
        self.assertEqual([f["feature"] for f in result["byFeature"]], ["chat"])
        self.assertEqual([s["status"] for s in result["byStatus"]], ["ok"])

    def test_without_events_the_section_is_empty_but_still_reports_this_process(self):
        breaker = summarize(7)["breaker"]
        self.assertEqual((breaker["events"], breaker["lastEvent"]), ([], None))
        self.assertEqual(breaker["thisProcess"]["state"], "closed")
        self.assertIn("retryInSeconds", breaker["thisProcess"])

    def test_only_the_most_recent_twenty_events_are_returned(self):
        for n in range(25):
            self._event("opened", n + 1)
        self.assertEqual(len(summarize(7)["breaker"]["events"]), 20)
