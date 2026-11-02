"""config/internal_api.py：內部 API 密鑰長度與呼叫位址檢查（稽核 DEP-7）。"""
import os
import subprocess
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from adminapi.dictionary_cache import invalidate_dictionary_cache
from config.internal_api import MIN_SECRET_LENGTH, base_url_problem, configuration_problems, secret_problem

BACKEND_DIR = Path(__file__).resolve().parent.parent
GOOD_SECRET = "x" * MIN_SECRET_LENGTH


class SecretProblemTest(TestCase):
    def test_unset_is_not_a_problem_here(self):
        self.assertIsNone(secret_problem(""))
        self.assertIsNone(secret_problem(None))

    def test_length_boundary(self):
        self.assertIsNotNone(secret_problem("x" * (MIN_SECRET_LENGTH - 1)))
        self.assertIsNone(secret_problem(GOOD_SECRET))

    def test_message_does_not_contain_the_secret(self):
        self.assertNotIn("abc", secret_problem("abc"))


class BaseUrlProblemTest(TestCase):
    def test_accepted(self):
        for url in (
            "http://127.0.0.1:8001", "http://127.0.0.2:8001", "http://localhost:8001", "http://LOCALHOST",
            "http://[::1]:8001", "https://fastapi.internal.example", "https://10.0.0.5:8443",
        ):
            with self.subTest(url=url):
                self.assertIsNone(base_url_problem(url))

    def test_rejected(self):
        for url in (
            "http://10.0.0.5:8001", "http://fastapi.internal.example", "http://localhost.evil.example",
            "http://127.0.0.1.evil.example", "ftp://127.0.0.1", "127.0.0.1:8001", "", "http://",
            "https://", "http://user:pw@127.0.0.1:8001", "http://127.0.0.1:notaport",
        ):
            with self.subTest(url=url):
                self.assertIsNotNone(base_url_problem(url))


class ConfigurationProblemsTest(TestCase):
    def test_empty_environment_has_no_problems(self):
        self.assertEqual(configuration_problems({}), [])

    def test_collects_both_problems(self):
        problems = configuration_problems({"INTERNAL_API_SECRET": "short", "FASTAPI_INTERNAL_BASE_URL": "http://10.0.0.5"})
        self.assertEqual(len(problems), 2)


class DictionaryCacheGuardTest(TestCase):
    def test_short_secret_or_remote_http_sends_nothing(self):
        for env in (
            {"INTERNAL_API_SECRET": "short"},
            {"INTERNAL_API_SECRET": GOOD_SECRET, "FASTAPI_INTERNAL_BASE_URL": "http://10.0.0.5:8001"},
        ):
            with self.subTest(env=env), patch.dict("os.environ", env), \
                    patch("adminapi.dictionary_cache.requests.post") as mock_post:
                invalidate_dictionary_cache(["words"])
                mock_post.assert_not_called()

    def test_good_configuration_sends(self):
        with patch.dict("os.environ", {"INTERNAL_API_SECRET": GOOD_SECRET, "FASTAPI_INTERNAL_BASE_URL": ""}), \
                patch("adminapi.dictionary_cache.requests.post") as mock_post:
            invalidate_dictionary_cache(["words"])
            mock_post.assert_called_once()


def _import_settings(**env_overrides):
    # 檢查發生在 import settings 當下，要在乾淨的子行程重現。空字串蓋掉 .env 裡可能有的值（load_dotenv 不覆蓋已存在的變數）。
    env = dict(os.environ)
    env.update({
        "DATABASE_URL": "", "DICTIONARY_DATABASE_URL": "", "REQUIRE_DATABASE_URL": "",
        "INTERNAL_API_SECRET": "", "FASTAPI_INTERNAL_BASE_URL": "",
        "DJANGO_SECRET_KEY": "x" * 50, "DJANGO_DEBUG": "False", "PYTHONIOENCODING": "utf-8",
    })
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-c", "import core.settings"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
    )


class SettingsStartupTest(TestCase):
    def test_short_secret_in_production_fails_startup(self):
        result = _import_settings(INTERNAL_API_SECRET="short")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("太短", result.stderr)

    def test_remote_http_url_in_production_fails_startup(self):
        result = _import_settings(INTERNAL_API_SECRET=GOOD_SECRET, FASTAPI_INTERNAL_BASE_URL="http://10.0.0.5:8001")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("明文", result.stderr)

    def test_good_configuration_starts(self):
        result = _import_settings(INTERNAL_API_SECRET=GOOD_SECRET, FASTAPI_INTERNAL_BASE_URL="http://127.0.0.1:8001")
        self.assertEqual(result.returncode, 0, result.stderr[-800:])

    def test_debug_mode_does_not_block_local_development(self):
        result = _import_settings(DJANGO_DEBUG="True", INTERNAL_API_SECRET="short")
        self.assertEqual(result.returncode, 0, result.stderr[-800:])
