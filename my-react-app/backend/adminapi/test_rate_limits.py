import json
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR, OWNER

from ._shared import ip_rate_limited_response, rate_limited_response
from .models import AuditLog, RateLimitRule
from .rate_limits import get_configured_rate


@contextmanager
def _as_role(role):
    """跟 test_quizbank.py 的 _as_role 完全一樣。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _patch_json(client, url, headers, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


class RateLimitRuleAdminTest(TestCase):
    """setUp／tearDown 都要清快取——get_configured_rate() 的短 TTL（30 秒）
    快取活在 Django 的行程層級 cache，不像資料庫那樣每個 TestCase 自動
    交易回滾隔離。這裡建立的 RateLimitRule（key="user_create" 等既有
    生產程式碼真的會用到的 group 名稱）如果快取沒清乾淨，30 秒內接著跑的
    其他測試檔（例如 test_users.py 對同一個 group 發真實請求）會意外套用
    到這裡測試用的極低 rate 值，被真的判定為超過限流而回 429，而不是
    測試原本要驗證的邏輯——這正是這次改動上線前在完整套件跑一輪才抓到
    的真實測試隔離坑，值得留言警示。"""

    def setUp(self):
        self.client = Client()
        cache.clear()
        self.rule = RateLimitRule.objects.create(
            key="quiz_vocab_item_create", backend=RateLimitRule.BACKEND_DJANGO,
            rate="30/m", default_rate="30/m", description="配合題詞彙建立",
        )
        self.fastapi_rule = RateLimitRule.objects.create(
            key="quiz_compare_audio", backend=RateLimitRule.BACKEND_FASTAPI,
            rate="20/minute", default_rate="20/minute", description="發音評分",
        )

    def tearDown(self):
        cache.clear()

    def test_staff_can_list(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/rate-limit-rules/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 2)

    def test_learner_without_staff_role_cannot_list(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/rate-limit-rules/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_filter_by_backend(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/rate-limit-rules/?backend=fastapi', **headers)
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["key"], "quiz_compare_audio")

    def test_only_publishers_can_update(self):
        with _as_role(EDITOR) as headers:
            response = _patch_json(
                self.client, f'/adminapi/rate-limit-rules/{self.rule.pk}/', headers, {"rate": "5/m"},
            )
        self.assertEqual(response.status_code, 403)

        with _as_role(ADMIN) as headers:
            response = _patch_json(
                self.client, f'/adminapi/rate-limit-rules/{self.rule.pk}/', headers, {"rate": "5/m"},
            )
        self.assertEqual(response.status_code, 200)
        self.rule.refresh_from_db()
        self.assertEqual(self.rule.rate, "5/m")

    def test_key_and_backend_are_read_only(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, f'/adminapi/rate-limit-rules/{self.rule.pk}/', headers,
                {"rate": "5/m", "key": "hacked_key", "backend": "fastapi"},
            )
        self.assertEqual(response.status_code, 200)
        self.rule.refresh_from_db()
        self.assertEqual(self.rule.key, "quiz_vocab_item_create")
        self.assertEqual(self.rule.backend, RateLimitRule.BACKEND_DJANGO)

    def test_invalid_rate_format_rejected(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, f'/adminapi/rate-limit-rules/{self.rule.pk}/', headers, {"rate": "not-a-rate"},
            )
        self.assertEqual(response.status_code, 400)

    def test_update_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, f'/adminapi/rate-limit-rules/{self.rule.pk}/', headers, {"rate": "1/m"})
        log = AuditLog.objects.filter(target_type="rate_limit_rule", action="update").first()
        self.assertIsNotNone(log)

    def test_public_endpoint_only_returns_fastapi_backend_rules(self):
        response = self.client.get('/adminapi/public/fastapi-rate-limit-rules/')
        self.assertEqual(response.status_code, 200)
        rules = response.json()["rules"]
        self.assertEqual(rules, {"quiz_compare_audio": "20/minute"})
        self.assertNotIn("quiz_vocab_item_create", rules)

    def test_public_endpoint_does_not_require_login(self):
        response = self.client.get('/adminapi/public/fastapi-rate-limit-rules/')
        self.assertEqual(response.status_code, 200)


class GetConfiguredRateTest(TestCase):
    """rate_limits.get_configured_rate()：adminapi/_shared.py／AIModel／
    CrosswordPuzzle／crawler 四個限流呼叫端共用的查表工具。setUp／tearDown
    都清快取的理由見 RateLimitRuleAdminTest 的說明——這裡用的是
    "user_create" 這個真實 group 名稱，特別需要避免快取洩漏到其他測試檔。"""

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_returns_default_when_no_rule_exists(self):
        rate = get_configured_rate("nonexistent_key", "60/m")
        self.assertEqual(rate, "60/m")

    def test_returns_db_value_when_rule_exists(self):
        RateLimitRule.objects.create(
            key="user_create", backend=RateLimitRule.BACKEND_DJANGO,
            rate="3/m", default_rate="10/m",
        )
        rate = get_configured_rate("user_create", "10/m")
        self.assertEqual(rate, "3/m")

    def test_result_is_cached_and_does_not_requery_db_within_ttl(self):
        RateLimitRule.objects.create(
            key="user_create", backend=RateLimitRule.BACKEND_DJANGO,
            rate="3/m", default_rate="10/m",
        )
        get_configured_rate("user_create", "10/m")  # 第一次呼叫，查資料庫並快取

        with patch("adminapi.models.RateLimitRule.objects") as mock_manager:
            rate = get_configured_rate("user_create", "10/m")
        mock_manager.filter.assert_not_called()
        self.assertEqual(rate, "3/m")

    def test_not_found_result_is_also_cached(self):
        get_configured_rate("nonexistent_key", "60/m")  # 第一次呼叫，查無紀錄

        with patch("adminapi.models.RateLimitRule.objects") as mock_manager:
            rate = get_configured_rate("nonexistent_key", "60/m")
        mock_manager.filter.assert_not_called()
        self.assertEqual(rate, "60/m")

    def test_db_error_falls_back_to_default_without_raising(self):
        with patch("adminapi.models.RateLimitRule.objects") as mock_manager:
            mock_manager.filter.side_effect = Exception("db error")
            rate = get_configured_rate("user_create", "10/m")
        self.assertEqual(rate, "10/m")


class SharedRateLimitHelpersUseConfiguredRateTest(TestCase):
    """驗證 _shared.py 的 rate_limited_response／ip_rate_limited_response
    真的把資料庫查到的 rate 傳給 is_ratelimited，而不是繼續用呼叫端字面
    傳入的值——這是這次改動的核心行為，61 個既有呼叫點完全不用改的前提
    就是這兩個函式內部正確查表。"""

    def setUp(self):
        cache.clear()
        RateLimitRule.objects.create(
            key="user_create", backend=RateLimitRule.BACKEND_DJANGO,
            rate="3/m", default_rate="10/m",
        )

    def tearDown(self):
        cache.clear()

    def test_rate_limited_response_passes_configured_rate_to_is_ratelimited(self):
        factory_request = type("_Req", (), {"META": {}})()
        with patch("adminapi._shared.is_ratelimited", return_value=False) as mock_is_ratelimited:
            rate_limited_response(factory_request, {"uid": "u1"}, group="user_create", rate="10/m")
        _, kwargs = mock_is_ratelimited.call_args
        self.assertEqual(kwargs["rate"], "3/m")

    def test_ip_rate_limited_response_passes_configured_rate_to_is_ratelimited(self):
        factory_request = type("_Req", (), {"META": {}})()
        with patch("adminapi._shared.is_ratelimited", return_value=False) as mock_is_ratelimited:
            ip_rate_limited_response(factory_request, group="user_create", rate="10/m")
        _, kwargs = mock_is_ratelimited.call_args
        self.assertEqual(kwargs["rate"], "3/m")

    def test_falls_back_to_literal_rate_when_no_rule_configured(self):
        factory_request = type("_Req", (), {"META": {}})()
        with patch("adminapi._shared.is_ratelimited", return_value=False) as mock_is_ratelimited:
            rate_limited_response(factory_request, {"uid": "u1"}, group="never_seeded_key", rate="42/m")
        _, kwargs = mock_is_ratelimited.call_args
        self.assertEqual(kwargs["rate"], "42/m")
