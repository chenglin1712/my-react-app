"""範例環境檔不能把危險的開發設定當預設：它常被直接複製成正式環境的 .env（S-11）。"""
import re
from pathlib import Path

from django.test import SimpleTestCase

ENV_EXAMPLE = Path(__file__).resolve().parents[2] / ".env.example"


def _value(name: str):
    for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        match = re.match(rf"^{name}\s*=\s*(.*?)\s*(#.*)?$", line)
        if match:
            return match.group(1)
    return None


class EnvExampleDefaultsTests(SimpleTestCase):
    def test_auth_bypass_is_off_by_default(self):
        self.assertIn(_value("AUTH_DEV_BYPASS"), ("False", ""))

    def test_debug_is_off_by_default(self):
        self.assertIn(_value("DJANGO_DEBUG"), ("False", ""))

    def test_both_flags_are_never_true_together(self):
        self.assertFalse(_value("AUTH_DEV_BYPASS") == "True" and _value("DJANGO_DEBUG") == "True")
