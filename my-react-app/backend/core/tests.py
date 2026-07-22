import json
import os
import subprocess
import sys
from pathlib import Path

from django.test import TestCase, Client, override_settings
from django.urls import path

from core import error_views

BASE_DIR = Path(__file__).resolve().parent.parent


class HealthCheckTest(TestCase):
    """對應 FastAPI 側的 /health（backend/fastAPI/main.py），Django 原本沒有
    對應端點，也不需要登入。"""

    def test_health_check_returns_ok(self):
        response = Client().get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_health_check_returns_503_when_database_unavailable(self):
        from unittest.mock import patch

        with patch("core.views.connection") as mock_connection:
            mock_connection.cursor.side_effect = Exception("database is gone")
            response = Client().get('/health/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "error")

    def test_health_check_returns_503_when_cache_unavailable(self):
        from unittest.mock import patch

        with patch("core.views.cache") as mock_cache:
            mock_cache.set.side_effect = Exception("cache is gone")
            response = Client().get('/health/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "error")


class JsonErrorHandlersTest(TestCase):
    """core/error_views.py 這波新增的全站 JSON 錯誤處理器（handler400/403/404/500），
    原本完全沒有測試——沒人驗證 DEBUG=False 時真的回傳 JSON，而不是 Django 預設的
    HTML 錯誤頁（這個專案底下沒有任何 HTML 頁面，統一回 JSON 是這幾個 app 共同的
    約定）。先各自單元測試 handler 本身的回應格式，再用兩個端到端測試證明
    urls.py 的 handler404/500 真的有被 Django 的例外處理機制呼叫到。
    """

    def test_json_400_response(self):
        response = error_views.json_400(None)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content), {"detail": "請求格式錯誤"})

    def test_json_403_response(self):
        response = error_views.json_403(None)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content), {"detail": "沒有權限執行此操作"})

    def test_json_404_response(self):
        response = error_views.json_404(None)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content), {"detail": "找不到此資源"})

    def test_json_500_response(self):
        response = error_views.json_500(None)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(json.loads(response.content), {"detail": "伺服器發生錯誤，請稍後再試"})

    @override_settings(DEBUG=False)
    def test_unknown_url_returns_json_not_html(self):
        response = Client().get('/this-path-does-not-exist/')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "找不到此資源"})
        self.assertEqual(response["Content-Type"], "application/json")

    @override_settings(DEBUG=False, ROOT_URLCONF=__name__)
    def test_unhandled_exception_returns_json_not_html(self):
        # 用這個測試模組自己當 ROOT_URLCONF（下面定義的 urlpatterns/handler500），
        # 掛一個故意丟例外的 view，證明 DEBUG=False 時 Django 真的會呼叫
        # core.error_views.json_500，而不是顯示除錯用的互動式 traceback 頁面
        # 或正式環境預設的 HTML 錯誤頁。
        response = Client(raise_request_exception=False).get('/broken/')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "伺服器發生錯誤，請稍後再試"})
        self.assertEqual(response["Content-Type"], "application/json")


def _broken_view(request):
    raise ValueError("deliberately broken, for test_unhandled_exception_returns_json_not_html")


urlpatterns = [
    path('broken/', _broken_view),
]
handler400 = "core.error_views.json_400"
handler403 = "core.error_views.json_403"
handler404 = "core.error_views.json_404"
handler500 = "core.error_views.json_500"


class SentryInitTest(TestCase):
    """core/settings.py 的 Sentry 初始化本身沒有測試覆蓋。settings.py 是 process
    啟動時只載入一次的模組，沒辦法在同一個測試進程裡乾淨地用不同的 SENTRY_DSN
    重新載入，所以改用子進程跑 manage.py check 驗證：有無設定 SENTRY_DSN 都不能
    讓 Django 啟動失敗（見 Round 6 手動驗證過的行為，這裡把它變成自動化迴歸測試）。
    """

    def _run_check(self, env_overrides):
        env = os.environ.copy()
        env.update(env_overrides)
        result = subprocess.run(
            [sys.executable, "manage.py", "check"],
            cwd=str(BASE_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result

    def test_startup_succeeds_without_sentry_dsn(self):
        env = os.environ.copy()
        env.pop("SENTRY_DSN", None)
        result = self._run_check({})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_startup_succeeds_with_sentry_dsn_set(self):
        result = self._run_check({"SENTRY_DSN": "https://fake@fake.ingest.sentry.io/123"})
        self.assertEqual(result.returncode, 0, result.stderr)


class CsrfTrustedOriginsBlankEnvTest(TestCase):
    """os.getenv(key, default) 的 default 只有在 key 完全沒出現在環境變數裡才會
    生效——.env 裡寫 CSRF_TRUSTED_ORIGINS=（有這一行、值是空字串，.env.example
    就是留空當範本）一樣算「有出現」，會直接把內建的本機開發預設值蓋掉變成空
    清單。settings.py 是 process 啟動時才算一次的模組層級程式碼，沒辦法在同一個
    測試進程裡乾淨地用不同的環境變數重新載入，改用子進程實際驗證這個情境。
    """

    def test_blank_csrf_trusted_origins_falls_back_to_default(self):
        env = os.environ.copy()
        env["DJANGO_SECRET_KEY"] = env.get("DJANGO_SECRET_KEY", "test-secret")
        env["DJANGO_SETTINGS_MODULE"] = "core.settings"
        env["CSRF_TRUSTED_ORIGINS"] = ""
        result = subprocess.run(
            [sys.executable, "-c", "import django; django.setup(); from django.conf import settings; print(settings.CSRF_TRUSTED_ORIGINS)"],
            cwd=str(BASE_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("127.0.0.1:8000", result.stdout)
        self.assertNotEqual(result.stdout.strip(), "[]")

    def test_blank_allowed_origins_falls_back_to_default(self):
        env = os.environ.copy()
        env["DJANGO_SECRET_KEY"] = env.get("DJANGO_SECRET_KEY", "test-secret")
        env["DJANGO_SETTINGS_MODULE"] = "core.settings"
        env["ALLOWED_ORIGINS"] = ""
        result = subprocess.run(
            [sys.executable, "-c", "import django; django.setup(); from django.conf import settings; print(settings.CORS_ALLOWED_ORIGINS)"],
            cwd=str(BASE_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("localhost:5173", result.stdout)
        self.assertNotEqual(result.stdout.strip(), "[]")
