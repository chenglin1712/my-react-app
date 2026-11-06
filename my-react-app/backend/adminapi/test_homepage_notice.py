"""首頁頂部通知條欄位（Apple 化步驟 2-6，HOMEPAGE_CONTRACT.md 3.4、4.1）。

欄位：notice_enabled、notice_text、notice_link_url、notice_starts_at、notice_ends_at。
公開端點只在「已啟用、有文字、目前在有效期間內」時輸出 notice {text, link_url}，其餘為 null。
"""
import json
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from adminapi.auth_fixtures import fresh_auth
from config.roles import EDITOR, OWNER

from .models import AuditLog, HomepageConfig

PUBLIC_URL = "/adminapi/public/homepage-config/"
ADMIN_URL = "/adminapi/homepage-config/"


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid", "role": role}
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _iso(delta):
    return (timezone.now() + delta).isoformat()


class NoticeModelTest(TestCase):
    def _config(self, **kwargs):
        config = HomepageConfig.load()
        for key, value in kwargs.items():
            setattr(config, key, value)
        return config

    def test_defaults_are_off_and_empty(self):
        config = HomepageConfig.load()
        self.assertFalse(config.notice_enabled)
        self.assertEqual((config.notice_text, config.notice_link_url), ("", ""))
        self.assertIsNone(config.notice_starts_at)
        self.assertIsNone(config.notice_ends_at)
        self.assertIsNone(config.active_notice())

    def test_active_notice_requires_enabled_and_text(self):
        self.assertIsNone(self._config(notice_enabled=True, notice_text="  ").active_notice())
        self.assertIsNone(self._config(notice_enabled=False, notice_text="公告").active_notice())
        self.assertEqual(
            self._config(notice_enabled=True, notice_text=" 公告 ", notice_link_url="/announcements").active_notice(),
            {"text": "公告", "link_url": "/announcements"},
        )

    def test_window_start_is_inclusive_and_end_is_exclusive(self):
        now = timezone.now()
        base = {"notice_enabled": True, "notice_text": "公告"}
        self.assertIsNone(self._config(**base, notice_starts_at=now + timedelta(seconds=1)).active_notice(now))
        self.assertIsNotNone(self._config(**base, notice_starts_at=now).active_notice(now))
        self.assertIsNotNone(self._config(**base, notice_ends_at=now + timedelta(seconds=1)).active_notice(now))
        self.assertIsNone(self._config(**base, notice_ends_at=now).active_notice(now))

    def test_text_rejects_newlines_and_controls_but_link_must_be_safe(self):
        for text in ("兩行\n文字", "含\x1b", "x" * 121):
            with self.assertRaises(ValidationError, msg=repr(text)):
                self._config(notice_text=text).full_clean()
        for link in ("javascript:alert(1)", "http://example.com", "//evil.example", "/\\evil.example", "https://user:pw@example.com"):
            with self.assertRaises(ValidationError, msg=link):
                self._config(notice_link_url=link).full_clean()
        self._config(notice_text="x" * 120, notice_link_url="https://example.com/a").full_clean()


class NoticeAdminApiTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _patch(self, payload, role=OWNER):
        with _as_role(role) as headers:
            return self.client.patch(ADMIN_URL, data=json.dumps(payload), content_type="application/json", **headers)

    def test_admin_get_includes_notice_fields_with_defaults(self):
        with _as_role(OWNER) as headers:
            data = self.client.get(ADMIN_URL, **headers).json()
        self.assertEqual(data["notice_enabled"], False)
        self.assertEqual((data["notice_text"], data["notice_link_url"]), ("", ""))
        self.assertIsNone(data["notice_starts_at"])
        self.assertIsNone(data["notice_ends_at"])

    def test_owner_sets_everything_and_it_persists_trimmed(self):
        response = self._patch({
            "notice_enabled": True, "notice_text": "　系統維護公告　", "notice_link_url": "/announcements",
            "notice_starts_at": _iso(timedelta(hours=-1)), "notice_ends_at": _iso(timedelta(days=1)),
        })
        self.assertEqual(response.status_code, 200, response.content)
        config = HomepageConfig.load()
        self.assertTrue(config.notice_enabled)
        self.assertEqual(config.notice_text, "系統維護公告")
        self.assertEqual(config.notice_link_url, "/announcements")

    def test_end_must_be_after_start(self):
        for ends in (timedelta(hours=-1), timedelta(hours=0)):
            start = timezone.now()
            response = self._patch({
                "notice_enabled": True, "notice_text": "公告",
                "notice_starts_at": start.isoformat(), "notice_ends_at": (start + ends).isoformat(),
            })
            self.assertEqual(response.status_code, 400)
            self.assertIn("notice_ends_at", response.json()["errors"])
        self.assertFalse(HomepageConfig.load().notice_enabled)

    def test_end_is_checked_against_the_stored_start_on_partial_update(self):
        self._patch({"notice_enabled": True, "notice_text": "公告", "notice_starts_at": _iso(timedelta(days=2))})
        response = self._patch({"notice_ends_at": _iso(timedelta(days=1))})
        self.assertEqual(response.status_code, 400)
        self.assertIn("notice_ends_at", response.json()["errors"])

    def test_enabling_without_text_is_rejected_but_saving_text_while_disabled_is_fine(self):
        response = self._patch({"notice_enabled": True})
        self.assertEqual(response.status_code, 400)
        self.assertIn("notice_text", response.json()["errors"])
        self.assertEqual(self._patch({"notice_text": "先存著", "notice_enabled": False}).status_code, 200)
        self.assertEqual(self._patch({"notice_enabled": True}).status_code, 200)
        self.assertEqual(self._patch({"notice_text": "   "}).status_code, 400)

    def test_unsafe_link_and_bad_text_are_400(self):
        for payload in (
            {"notice_link_url": "javascript:alert(1)"},
            {"notice_link_url": "http://example.com"},
            {"notice_link_url": "//evil.example"},
            {"notice_text": "兩行\n文字"},
            {"notice_text": "x" * 121},
        ):
            response = self._patch(payload)
            self.assertEqual(response.status_code, 400, payload)

    def test_editor_cannot_write(self):
        self.assertEqual(self._patch({"notice_text": "公告"}, role=EDITOR).status_code, 403)
        self.assertEqual(HomepageConfig.load().notice_text, "")

    def test_other_fields_are_untouched_by_a_notice_patch(self):
        config = HomepageConfig.load()
        config.tagline = "標語"
        config.save()
        self._patch({"notice_text": "公告"})
        self.assertEqual(HomepageConfig.load().tagline, "標語")

    def test_audit_log_records_notice_changes(self):
        self._patch({"notice_text": "公告"})
        log = AuditLog.objects.filter(target_type="homepage_config").latest("id")
        self.assertEqual(log.before["notice_text"], "")
        self.assertEqual(log.after["notice_text"], "公告")


class NoticePublicApiTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _save(self, **kwargs):
        config = HomepageConfig.load()
        for key, value in kwargs.items():
            setattr(config, key, value)
        config.save()

    def test_default_is_null(self):
        self.assertIsNone(self.client.get(PUBLIC_URL).json()["notice"])

    def test_active_notice_exposes_only_text_and_link(self):
        self._save(notice_enabled=True, notice_text="公告", notice_link_url="/announcements",
                   notice_starts_at=timezone.now() - timedelta(hours=1), notice_ends_at=timezone.now() + timedelta(hours=1))
        data = self.client.get(PUBLIC_URL).json()
        self.assertEqual(data["notice"], {"text": "公告", "link_url": "/announcements"})
        self.assertNotIn("notice_enabled", data)
        self.assertNotIn("notice_starts_at", data)
        self.assertNotIn("notice_ends_at", data)

    def test_not_yet_started_expired_or_disabled_are_null_and_not_leaked(self):
        cases = (
            {"notice_enabled": True, "notice_text": "還沒到", "notice_starts_at": timezone.now() + timedelta(hours=1)},
            {"notice_enabled": True, "notice_text": "已過期", "notice_ends_at": timezone.now() - timedelta(seconds=1)},
            {"notice_enabled": False, "notice_text": "關閉中"},
        )
        for kwargs in cases:
            self._save(**{"notice_starts_at": None, "notice_ends_at": None, **kwargs})
            response = self.client.get(PUBLIC_URL)
            self.assertIsNone(response.json()["notice"], kwargs)
            self.assertNotIn(kwargs["notice_text"], response.content.decode(), kwargs)

    def test_admin_save_is_visible_on_the_next_public_read(self):
        with _as_role(OWNER) as headers:
            self.client.patch(ADMIN_URL, data=json.dumps({"notice_enabled": True, "notice_text": "公告"}),
                              content_type="application/json", **headers)
        self.assertEqual(self.client.get(PUBLIC_URL).json()["notice"]["text"], "公告")
        self.assertEqual(self.client.get(PUBLIC_URL)["Cache-Control"], "no-cache")
