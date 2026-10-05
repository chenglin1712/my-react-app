"""REQUIRE_DATABASE_URL：正式環境漏設資料庫時要啟動失敗，不能靜默退回 SQLite。"""
import os
import subprocess
import sys
from pathlib import Path
from unittest import TestCase

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _import_module(module: str, **env_overrides):
    """在乾淨的子行程 import 指定模組（這些檢查發生在 import 當下，無法在已載入的
    測試行程內重現）。回傳 CompletedProcess。"""
    # 設成空字串而不是移除：settings.py 會 load_dotenv() 讀專案根目錄的 .env（本機有
    # 真的 DATABASE_URL），load_dotenv 不覆蓋「已存在」的變數，空字串能擋住它。
    env = dict(os.environ)
    env.update({"DATABASE_URL": "", "DICTIONARY_DATABASE_URL": "", "REQUIRE_DATABASE_URL": ""})
    env.setdefault("DJANGO_SECRET_KEY", "test-secret")
    env["DJANGO_DEBUG"] = "False"
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
    )


class RequireDatabaseUrlTests(TestCase):
    def test_django_settings_fail_fast_when_required_and_missing(self):
        result = _import_module("core.settings", REQUIRE_DATABASE_URL="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REQUIRE_DATABASE_URL", result.stderr)

    def test_django_settings_still_fall_back_to_sqlite_by_default(self):
        result = _import_module("core.settings")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_django_settings_accept_database_url_when_required(self):
        result = _import_module("core.settings", REQUIRE_DATABASE_URL="true",
                                DATABASE_URL="postgresql://u:p@localhost:5432/db")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dictionary_db_fails_fast_when_required_and_missing(self):
        result = _import_module("dictionary_db.connect", REQUIRE_DATABASE_URL="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REQUIRE_DATABASE_URL", result.stderr)

    def test_dictionary_db_still_falls_back_by_default(self):
        result = _import_module("dictionary_db.connect")
        self.assertEqual(result.returncode, 0, result.stderr)
