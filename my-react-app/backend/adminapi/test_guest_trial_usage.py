"""訪客翻譯試用計次表（C-2）：model 約束與清理指令。寫入端在 FastAPI（fastAPI/guest_trial.py）。"""
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from adminapi.models import GuestTranslationUsage

_TAIPEI = timedelta(hours=8)


def _today_taipei():
    return (timezone.now() + _TAIPEI).date()


class GuestTranslationUsageModelTest(TestCase):
    def test_same_day_scope_and_key_cannot_be_duplicated(self):
        today = _today_taipei()
        GuestTranslationUsage.objects.create(day=today, scope="browser", key_hash="a" * 64, count=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            GuestTranslationUsage.objects.create(day=today, scope="browser", key_hash="a" * 64, count=1)

    def test_same_key_is_allowed_for_other_scope_or_day(self):
        today = _today_taipei()
        GuestTranslationUsage.objects.create(day=today, scope="browser", key_hash="a" * 64, count=1)
        GuestTranslationUsage.objects.create(day=today, scope="ip", key_hash="a" * 64, count=1)
        GuestTranslationUsage.objects.create(day=today - timedelta(days=1), scope="browser", key_hash="a" * 64, count=1)
        self.assertEqual(GuestTranslationUsage.objects.count(), 3)


class PurgeGuestTrialUsageCommandTest(TestCase):
    def setUp(self):
        today = _today_taipei()
        for offset in (0, 1, 3, 4, 10):
            GuestTranslationUsage.objects.create(
                day=today - timedelta(days=offset), scope="browser", key_hash=f"{offset:064d}", count=1,
            )

    def _run(self, *args):
        out = StringIO()
        call_command("purge_guest_trial_usage", *args, stdout=out)
        return out.getvalue()

    def test_default_keeps_three_days_and_deletes_older(self):
        output = self._run()
        self.assertIn("已刪除 2 筆", output)
        remaining = sorted((_today_taipei() - r.day).days for r in GuestTranslationUsage.objects.all())
        self.assertEqual(remaining, [0, 1, 3])

    def test_days_option(self):
        self._run("--days", "0")
        self.assertEqual(GuestTranslationUsage.objects.count(), 1)

    def test_negative_days_deletes_nothing(self):
        self._run("--days", "-1")
        self.assertEqual(GuestTranslationUsage.objects.count(), 5)
