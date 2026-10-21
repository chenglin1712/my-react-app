"""analyze_cache_ttl 的模擬邏輯：用手算得出答案的小例子驗證。"""
import io
from datetime import datetime, timedelta, timezone as dt_timezone

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from AIModel.management.commands.analyze_cache_ttl import MIN_CALLS, near_boundary_count, recommend, simulate_ttl
from adminapi.models import AiUsageLog

T0 = datetime(2026, 10, 21, 8, 0, tzinfo=dt_timezone.utc)


def at(*minutes):
    return [T0 + timedelta(minutes=m) for m in minutes]


class SimulateTtlTest(SimpleTestCase):
    def test_calls_within_the_ttl_are_reads_and_refresh_the_timer(self):
        # 0、4、8 分鐘：每次都在上一次的 5 分鐘內（命中會重設計時），所以只寫入一次
        result = simulate_ttl(at(0, 4, 8), 300, 1.25)
        self.assertEqual((result["writes"], result["reads"]), (1, 2))
        self.assertAlmostEqual(result["cost"], 1.25 + 0.2)

    def test_a_gap_longer_than_the_ttl_rewrites(self):
        result = simulate_ttl(at(0, 6, 12), 300, 1.25)
        self.assertEqual((result["writes"], result["reads"]), (3, 0))

    def test_one_hour_ttl_survives_gaps_the_five_minute_ttl_does_not(self):
        times = at(0, 20, 40, 60)
        five = simulate_ttl(times, 300, 1.25)
        hour = simulate_ttl(times, 3600, 2.0)
        self.assertEqual((five["writes"], hour["writes"], hour["reads"]), (4, 1, 3))
        self.assertLess(hour["cost"], 4.0)                     # 比不快取（4 次全價）便宜
        self.assertGreater(five["cost"], 4.0)                  # 5 分鐘版每次都寫入，比不快取還貴

    def test_the_exact_ttl_boundary_counts_as_a_hit(self):
        self.assertEqual(simulate_ttl(at(0, 5), 300, 1.25)["reads"], 1)

    def test_near_boundary_count_flags_gaps_close_to_the_ttl(self):
        # 間隔 1、4.9、5.2、10 分鐘：只有 4.9 與 5.2 分鐘離 5 分鐘門檻在 30 秒內
        times = at(0, 1, 5.9, 11.1, 21.1)
        self.assertEqual(near_boundary_count(times, 300), 2)

    def test_recommend_picks_the_cheapest(self):
        plain = {"cost": 10.0}
        self.assertEqual(recommend(plain, {"cost": 12.5}, {"cost": 20.0}), "不快取")
        self.assertEqual(recommend(plain, {"cost": 3.0}, {"cost": 4.0}), "5 分鐘版")
        self.assertEqual(recommend(plain, {"cost": 9.0}, {"cost": 4.0}), "1 小時版")


class AnalyzeCommandTest(TestCase):
    def _log(self, minutes_ago, status="ok", feature="chat"):
        row = AiUsageLog.objects.create(feature=feature, uid="u", model="m", status=status)
        AiUsageLog.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(minutes=minutes_ago))

    def test_too_few_calls_gives_no_conclusion(self):
        for n in range(5):
            self._log(n)
        out = io.StringIO()
        call_command("analyze_cache_ttl", stdout=out)
        self.assertIn("不下結論", out.getvalue())
        self.assertNotIn("最省的是", out.getvalue())

    def test_dense_traffic_prefers_the_five_minute_ttl_and_ignores_other_rows(self):
        for n in range(MIN_CALLS + 10):
            self._log(n)                                    # 每分鐘一次
        self._log(1, status="error")                        # 失敗的呼叫不算
        self._log(2, feature="plan")                        # 別的功能不算
        out = io.StringIO()
        call_command("analyze_cache_ttl", stdout=out)
        text = out.getvalue()
        self.assertIn("成功呼叫：40 次", text)
        self.assertIn("最省的是：5 分鐘版", text)

    def test_each_model_is_simulated_on_its_own_timeline(self):
        # 兩個模型交錯呼叫、各自每 6 分鐘一次：合併起來每 3 分鐘一次會全部命中，分開看其實每次都 miss（5 分鐘版）
        for n in range(MIN_CALLS):
            for model, offset in (("model-a", 0), ("model-b", 3)):
                row = AiUsageLog.objects.create(feature="chat", uid="u", model=model, status="ok")
                minutes_ago = n * 6 + offset
                AiUsageLog.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(minutes=minutes_ago))
        out = io.StringIO()
        call_command("analyze_cache_ttl", stdout=out)
        text = out.getvalue()
        self.assertIn("模型 model-a：30 次", text)
        self.assertIn("模型 model-b：30 次", text)
        self.assertEqual(text.count("5 分鐘版：寫入 30 次、讀取 0 次"), 2)

    def test_request_start_is_estimated_as_record_time_minus_latency(self):
        # 兩次紀錄相隔 6 分鐘，但第二次花了 90 秒：實際開始只差 4.5 分鐘，在 5 分鐘內會命中
        for n in range(MIN_CALLS):
            first = AiUsageLog.objects.create(feature="chat", uid="u", model="m", status="ok", latency_ms=0)
            second = AiUsageLog.objects.create(feature="chat", uid="u", model="m", status="ok", latency_ms=90_000)
            base = timezone.now() - timedelta(days=1, minutes=n * 60)
            AiUsageLog.objects.filter(pk=first.pk).update(created_at=base)
            AiUsageLog.objects.filter(pk=second.pk).update(created_at=base + timedelta(minutes=6))
        out = io.StringIO()
        call_command("analyze_cache_ttl", stdout=out)
        self.assertIn("5 分鐘版：寫入 30 次、讀取 30 次", out.getvalue())

    def test_sparse_traffic_prefers_the_one_hour_ttl(self):
        for n in range(MIN_CALLS + 5):
            self._log(n * 20)                               # 每 20 分鐘一次
        out = io.StringIO()
        call_command("analyze_cache_ttl", days=90, stdout=out)
        self.assertIn("最省的是：1 小時版", out.getvalue())
