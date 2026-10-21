from adminapi.auth_fixtures import fresh_auth
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from config.roles import ANALYST

from . import ai_usage
from .models import AiUsageLog


@contextmanager
def _as_role(role):
    """跟 test_feature_flags.py 的 _as_role 完全一樣。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _log(feature="chat", model="claude-sonnet-5", status="ok", uid="u1", days_ago=0, **tokens):
    row = AiUsageLog.objects.create(
        feature=feature, model=model, status=status, uid=uid,
        input_tokens=tokens.get("input", 0), output_tokens=tokens.get("output", 0),
        cache_read_tokens=tokens.get("cache_read", 0), cache_write_tokens=tokens.get("cache_write", 0),
        latency_ms=tokens.get("latency", 100),
    )
    if days_ago:
        # auto_now_add 不能在建立時指定，建立後再改。
        AiUsageLog.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
    return row


class RecordAiUsageTest(TestCase):
    def test_writes_a_row_and_treats_missing_tokens_as_zero(self):
        ai_usage.record_ai_usage({
            "feature": "review", "uid": "u9", "model": "claude-haiku-5-5", "status": "timeout",
            "request_id": "", "input_tokens": None, "output_tokens": None,
            "cache_read_tokens": None, "cache_write_tokens": None, "latency_ms": 25000,
        })
        row = AiUsageLog.objects.get()
        self.assertEqual((row.feature, row.status, row.input_tokens, row.output_tokens), ("review", "timeout", 0, 0))
        self.assertEqual(row.latency_ms, 25000)

    def test_a_real_llm_call_in_django_writes_a_row_through_the_registered_recorder(self):
        from unittest.mock import MagicMock
        from config import llm

        client = MagicMock()
        client.messages.create.return_value = MagicMock(
            stop_reason="end_turn", _request_id="req_abc", content=[MagicMock(type="text", text="hi")],
            usage=MagicMock(input_tokens=11, output_tokens=5, cache_read_input_tokens=0, cache_creation_input_tokens=0),
        )
        llm.call_claude(client, feature="chat", system="s", messages=[], uid="u-real")
        row = AiUsageLog.objects.get()
        self.assertEqual((row.uid, row.request_id, row.input_tokens, row.output_tokens), ("u-real", "req_abc", 11, 5))


class FastApiTableStaysInSyncTest(TestCase):
    def test_fastapi_insert_table_covers_every_django_column(self):
        """FastAPI 用 SQLAlchemy Core 手動組的 Table 沒有共用 schema 來源，欄位對不上時
        INSERT 會在正式環境才失敗（而且被吞掉），這裡在 CI 擋下來。"""
        from fastAPI import ai_usage_events

        django_columns = {f.column for f in AiUsageLog._meta.get_fields() if getattr(f, "column", None)} - {"id"}
        fastapi_columns = {c.name for c in ai_usage_events._ai_usage_table.columns}
        self.assertEqual(django_columns, fastapi_columns)
        self.assertEqual(ai_usage_events._ai_usage_table.name, AiUsageLog._meta.db_table)


class EstimateCostTest(TestCase):
    def test_known_model_cost(self):
        # sonnet-5：輸入 $2、輸出 $10 每百萬；1,000,000 輸入 + 100,000 輸出 = 2 + 1 = $3
        self.assertAlmostEqual(ai_usage.estimate_cost_usd("claude-sonnet-5", 1_000_000, 100_000), 3.0)

    def test_cache_read_is_a_tenth_and_cache_write_is_one_and_a_quarter_of_input_price(self):
        self.assertAlmostEqual(ai_usage.estimate_cost_usd("claude-sonnet-5", 0, 0, cache_read_tokens=1_000_000), 0.2)
        self.assertAlmostEqual(ai_usage.estimate_cost_usd("claude-sonnet-5", 0, 0, cache_write_tokens=1_000_000), 2.5)

    def test_unknown_model_is_none_not_zero(self):
        self.assertIsNone(ai_usage.estimate_cost_usd("some-future-model", 1000, 1000))


class SummarizeTest(TestCase):
    def test_empty_database_returns_zeros_and_a_continuous_daily_series(self):
        data = ai_usage.summarize(7)
        self.assertEqual(data["totals"]["calls"], 0)
        self.assertIsNone(data["totals"]["cacheHitRate"])
        self.assertIsNone(data["totals"]["latencyP50Ms"])
        self.assertEqual(len(data["daily"]), 7)
        self.assertEqual(data["byFeature"], [])

    def test_totals_groups_and_cost(self):
        _log(feature="chat", input=1000, output=200, cache_read=500, latency=100)
        _log(feature="chat", input=1000, output=200, latency=300)
        _log(feature="review", model="claude-haiku-5-5", input=2000, output=100, latency=200)
        _log(feature="chat", status="timeout")

        data = ai_usage.summarize(7)
        totals = data["totals"]
        self.assertEqual(totals["calls"], 4)
        self.assertEqual(totals["errors"], 1)
        self.assertEqual(totals["inputTokens"], 4000)
        self.assertEqual(totals["cacheReadTokens"], 500)
        # 快取命中率 = 500 / (4000 + 500 + 0)
        self.assertAlmostEqual(totals["cacheHitRate"], round(500 / 4500, 4))
        # 延遲百分位數只算成功的呼叫：100、200、300
        self.assertEqual(totals["latencyP50Ms"], 200)
        self.assertEqual(totals["latencySampleSize"], 3)
        self.assertFalse(totals["costIncomplete"])

        by_feature = {row["feature"]: row for row in data["byFeature"]}
        self.assertEqual(by_feature["chat"]["calls"], 3)
        self.assertEqual(by_feature["review"]["calls"], 1)
        self.assertEqual({row["status"]: row["calls"] for row in data["byStatus"]}, {"ok": 3, "timeout": 1})

    def test_cost_is_flagged_incomplete_when_a_model_has_no_price(self):
        _log(model="some-future-model", input=1000, output=100)
        self.assertTrue(ai_usage.summarize(7)["totals"]["costIncomplete"])

    def test_failed_calls_with_zero_tokens_do_not_flag_cost_incomplete(self):
        _log(model="some-future-model", status="timeout")
        self.assertFalse(ai_usage.summarize(7)["totals"]["costIncomplete"])

    def test_rows_outside_the_window_are_excluded(self):
        _log(days_ago=0)
        _log(days_ago=10)
        self.assertEqual(ai_usage.summarize(7)["totals"]["calls"], 1)
        self.assertEqual(ai_usage.summarize(30)["totals"]["calls"], 2)

    def test_window_starts_at_local_midnight_so_early_morning_rows_are_kept(self):
        """台灣當日 00:30 是 UTC 前一天 16:30；起點若用 UTC 午夜就會漏掉這筆。"""
        from datetime import datetime, time
        from zoneinfo import ZoneInfo

        taipei = ZoneInfo("Asia/Taipei")
        with timezone.override(taipei):
            today = timezone.localdate()
            early = timezone.make_aware(datetime.combine(today, time(0, 30)), taipei)
            row = _log()
            AiUsageLog.objects.filter(pk=row.pk).update(created_at=early)
            with patch("django.utils.timezone.now", return_value=early + timedelta(hours=1)):
                data = ai_usage.summarize(1)
        self.assertEqual(data["totals"]["calls"], 1)
        self.assertEqual(data["daily"][-1]["date"], today.isoformat())
        self.assertEqual(data["daily"][-1]["calls"], 1)

    def test_days_is_clamped(self):
        self.assertEqual(ai_usage.summarize(0)["days"], 1)
        self.assertEqual(ai_usage.summarize(10_000)["days"], ai_usage.MAX_DAYS)

    def test_top_users_are_ranked_and_guests_are_labelled(self):
        for _ in range(3):
            _log(uid="heavy")
        _log(uid="light")
        _log(uid="")
        users = ai_usage.summarize(7)["topUsers"]
        self.assertEqual(users[0]["uid"], "heavy")
        self.assertEqual(users[0]["calls"], 3)
        self.assertIn("（訪客）", [u["uid"] for u in users])


class AiUsageEndpointTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_staff_can_read_the_summary(self):
        _log(input=10, output=5)
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/ai-usage/?days=7', **headers)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["totals"]["calls"], 1)
        self.assertEqual(body["days"], 7)

    def test_default_days_is_seven(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/ai-usage/', **headers)
        self.assertEqual(response.json()["days"], 7)

    def test_non_staff_is_forbidden(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/ai-usage/', **headers)
        self.assertEqual(response.status_code, 403)

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_unauthenticated_is_rejected(self):
        self.assertEqual(self.client.get('/adminapi/ai-usage/').status_code, 401)

    def test_invalid_days_is_rejected(self):
        for bad in ("abc", "0", "91", "-3"):
            with _as_role(ANALYST) as headers:
                response = self.client.get(f'/adminapi/ai-usage/?days={bad}', **headers)
            self.assertEqual(response.status_code, 400, bad)

    def test_only_get_is_allowed(self):
        with _as_role(ANALYST) as headers:
            response = self.client.post('/adminapi/ai-usage/', **headers)
        self.assertEqual(response.status_code, 405)

    def test_response_never_contains_prompt_or_output_fields(self):
        _log()
        with _as_role(ANALYST) as headers:
            text = self.client.get('/adminapi/ai-usage/', **headers).content.decode()
        for forbidden in ("prompt", "message", "content", "response_text"):
            self.assertNotIn(f'"{forbidden}"', text)
