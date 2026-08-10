from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR

from .models import AuditLog
from .system_cache import clear_django_caches, clear_fastapi_caches


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


class ClearDjangoCachesTest(TestCase):
    def setUp(self):
        cache.clear()

    def test_clears_all_three_known_keys(self):
        cache.set("crawler_exam_site_html", "<html>stale</html>")
        cache.set("crawler_news_data", {"stale": True})
        cache.set("crawler_exam_schedule_data", {"stale": True})

        cleared = clear_django_caches()

        self.assertCountEqual(cleared, [
            "crawler_exam_site_html", "crawler_news_data", "crawler_exam_schedule_data",
        ])
        self.assertIsNone(cache.get("crawler_exam_site_html"))
        self.assertIsNone(cache.get("crawler_news_data"))
        self.assertIsNone(cache.get("crawler_exam_schedule_data"))


class ClearFastapiCachesTest(TestCase):
    def test_missing_secret_returns_failure_without_raising(self):
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("INTERNAL_API_SECRET", None)
            success, message = clear_fastapi_caches()
        self.assertFalse(success)
        self.assertIn("INTERNAL_API_SECRET", message)

    def test_successful_call_returns_fastapi_response_body(self):
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {"invalidated": {"words": 5}, "rewarm": "scheduled"}
        with patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"}):
            with patch("adminapi.system_cache.requests.post", return_value=mock_response) as mock_post:
                success, result = clear_fastapi_caches()
        self.assertTrue(success)
        self.assertEqual(result, {"invalidated": {"words": 5}, "rewarm": "scheduled"})
        _, kwargs = mock_post.call_args
        self.assertEqual(kwargs["json"], {"scopes": ["all"], "tribes": None})
        self.assertEqual(kwargs["headers"], {"X-Internal-Secret": "s3cret"})

    def test_connection_failure_returns_failure_without_raising(self):
        import requests as requests_module
        with patch.dict("os.environ", {"INTERNAL_API_SECRET": "s3cret"}):
            with patch(
                "adminapi.system_cache.requests.post",
                side_effect=requests_module.exceptions.ConnectionError("boom"),
            ):
                success, message = clear_fastapi_caches()
        self.assertFalse(success)
        self.assertIn("失敗", message)


class SystemCacheViewsTest(TestCase):
    def setUp(self):
        self.client = Client()
        cache.clear()

    def test_staff_can_list(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/system/cache/', **headers)
        self.assertEqual(response.status_code, 200)
        keys = [item["key"] for item in response.json()["django_caches"]]
        self.assertIn("crawler_exam_site_html", keys)

    def test_learner_without_staff_role_cannot_list(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/system/cache/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_only_publishers_can_clear_django_cache(self):
        with _as_role(EDITOR) as headers:
            response = self.client.post('/adminapi/system/cache/clear-django/', **headers)
        self.assertEqual(response.status_code, 403)

        with _as_role(ADMIN) as headers:
            response = self.client.post('/adminapi/system/cache/clear-django/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn("crawler_news_data", response.json()["cleared_keys"])

    def test_clear_django_cache_writes_audit_log(self):
        with _as_role(ADMIN) as headers:
            self.client.post('/adminapi/system/cache/clear-django/', **headers)
        log = AuditLog.objects.filter(target_type="system_cache", action="clear_django_cache").first()
        self.assertIsNotNone(log)

    def test_clear_fastapi_cache_failure_returns_502(self):
        with patch("adminapi.system_cache_views.clear_fastapi_caches", return_value=(False, "boom")):
            with _as_role(ADMIN) as headers:
                response = self.client.post('/adminapi/system/cache/clear-fastapi/', **headers)
        self.assertEqual(response.status_code, 502)

    def test_clear_fastapi_cache_success_returns_200(self):
        with patch(
            "adminapi.system_cache_views.clear_fastapi_caches",
            return_value=(True, {"invalidated": {"words": 3}, "rewarm": "scheduled"}),
        ):
            with _as_role(ADMIN) as headers:
                response = self.client.post('/adminapi/system/cache/clear-fastapi/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["invalidated"]["words"], 3)

    def test_editor_cannot_clear_fastapi_cache(self):
        with _as_role(EDITOR) as headers:
            response = self.client.post('/adminapi/system/cache/clear-fastapi/', **headers)
        self.assertEqual(response.status_code, 403)
