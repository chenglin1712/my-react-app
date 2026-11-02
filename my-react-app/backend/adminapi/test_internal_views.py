"""FastAPI → Django 的內部預算評估端點（稽核 AI-1）。"""
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase

from adminapi.models import FeatureFlag

URL = "/adminapi/internal/ai-budget/enforce/"
SECRET = "k" * 20 + "AbCdEfGh1234567890"


class InternalBudgetEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.http = Client()

    def _post(self, secret=SECRET, env_secret=SECRET):
        headers = {"HTTP_X_INTERNAL_SECRET": secret} if secret is not None else {}
        with patch.dict("os.environ", {"INTERNAL_API_SECRET": env_secret}):
            return self.http.post(URL, **headers)

    def test_only_post_is_accepted(self):
        self.assertEqual(self.http.get(URL).status_code, 405)

    def test_no_secret_configured_is_503_and_never_evaluates(self):
        with patch("adminapi.internal_views.ai_budget.enforce") as enforce:
            response = self._post(secret="anything", env_secret="")
        self.assertEqual(response.status_code, 503)
        enforce.assert_not_called()

    def test_a_too_short_secret_is_503(self):
        with patch("adminapi.internal_views.ai_budget.enforce") as enforce, self.assertLogs("adminapi.internal_views", level="ERROR"):
            response = self._post(secret="short", env_secret="short")
        self.assertEqual(response.status_code, 503)
        enforce.assert_not_called()

    def test_missing_or_wrong_secret_is_401(self):
        with patch("adminapi.internal_views.ai_budget.enforce") as enforce:
            self.assertEqual(self._post(secret=None).status_code, 401)
            self.assertEqual(self._post(secret="x" * 40).status_code, 401)
        enforce.assert_not_called()

    def test_correct_secret_runs_the_evaluation_and_returns_only_the_level(self):
        with patch("adminapi.internal_views.ai_budget.enforce", return_value={"level": "ok", "spentUsd": 3.0}) as enforce:
            response = self._post()
        self.assertEqual((response.status_code, response.json()), (200, {"level": "ok"}))
        enforce.assert_called_once()

    def test_exceeding_the_budget_through_the_endpoint_switches_translation_off(self):
        from adminapi.test_ai_budget import spend

        FeatureFlag.objects.create(key="translation_enabled", label="翻譯", enabled=True)
        spend(10.5)
        with patch.dict("os.environ", {"AI_MONTHLY_BUDGET_USD": "10"}), self.assertLogs("adminapi.ai_budget", level="CRITICAL"):
            response = self._post()
        self.assertEqual(response.json(), {"level": "exceeded"})
        self.assertFalse(FeatureFlag.objects.get(key="translation_enabled").enabled)
