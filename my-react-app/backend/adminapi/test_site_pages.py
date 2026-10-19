"""公開說明頁（隱私與資料、聯絡我們）正文：預設內容、後台權限、驗證、稽核、衝突與公開端點。

兩頁行為相同，共用同一組測試（見 SitePageMixin），各頁只補自己的預設內容與 mailto 規則。"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import ADMIN, ANALYST, EDITOR, OWNER

from .models import AuditLog, ContactPage, PrivacyPolicy



@contextmanager
def _as_role(role, uid="test-uid"):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": uid}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


class SitePageMixin:
    model = None
    ADMIN_URL = ""
    PUBLIC_URL = ""
    TARGET_TYPE = ""

    def setUp(self):
        cache.clear()
        self.client = Client()

    def call(self, method, path, payload=None, role=OWNER, uid="test-uid"):
        with _as_role(role, uid) as headers:
            fn = getattr(self.client, method)
            if payload is None:
                return fn(path, **headers)
            return fn(path, data=json.dumps(payload), content_type="application/json", **headers)

    def test_public_endpoint_needs_no_login_and_hides_maintenance_fields(self):
        response = self.client.get(self.PUBLIC_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"content", "updated_at"})
        self.assertEqual(response["Cache-Control"], "no-cache")
        self.assertEqual(self.client.post(self.PUBLIC_URL).status_code, 405)

    def test_staff_can_read_but_only_publishers_can_write(self):
        for role in (OWNER, ADMIN, EDITOR, ANALYST):
            self.assertEqual(self.call("get", self.ADMIN_URL, role=role).status_code, 200, role)
        for role in (EDITOR, ANALYST, None):
            self.assertIn(self.call("patch", self.ADMIN_URL, {"content": _doc("x")}, role=role).status_code, (401, 403), role)
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": _doc("x"), "base_updated_at": self._base()}, role=ADMIN).status_code, 200)

    def _base(self):
        return self.call("get", self.ADMIN_URL).json()["updated_at"]

    def test_update_is_public_immediately_and_audited(self):
        response = self.call("patch", self.ADMIN_URL, {"content": _doc("新的隱私說明"), "base_updated_at": self._base()}, uid="boss")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["updated_by"], "boss")
        public = self.client.get(self.PUBLIC_URL).json()
        self.assertEqual(public["content"], _doc("新的隱私說明"))
        log = AuditLog.objects.filter(target_type=self.TARGET_TYPE, action="update").first()
        self.assertIsNotNone(log)

    def test_stale_edit_is_rejected_with_409_and_keeps_newer_content(self):
        stale = self._base()
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": _doc("先存的"), "base_updated_at": stale}).status_code, 200)
        response = self.call("patch", self.ADMIN_URL, {"content": _doc("後存的"), "base_updated_at": stale})
        self.assertEqual(response.status_code, 409)
        self.assertIn("其他人", response.json()["detail"])
        self.assertEqual(self.client.get(self.PUBLIC_URL).json()["content"], _doc("先存的"))
        fresh = self._base()
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": _doc("再改"), "base_updated_at": fresh}).status_code, 200)

    def test_missing_base_version_is_rejected(self):
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": _doc("x")}).status_code, 400)
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": _doc("x"), "base_updated_at": "不是時間"}).status_code, 400)

    def test_rejects_missing_or_invalid_content(self):
        base = self._base()
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"base_updated_at": base}).status_code, 400)
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": {"type": "doc", "content": [{"type": "script"}]}, "base_updated_at": base}).status_code, 400)
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": "<script>x</script>", "base_updated_at": base}).status_code, 400)
        link = {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]}]}]}
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": link, "base_updated_at": base}).status_code, 400)
        self.assertNotIn("javascript", json.dumps(self.model.load().content))

    def test_stays_a_single_row(self):
        self.model.load()
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.model.objects.create(content=_doc("另一筆"))
        self.assertEqual(self.model.objects.count(), 1)

    def test_link_rules_allow_plain_mailto_only(self):
        base = self._base()

        def doc(href):
            return {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "信箱", "marks": [{"type": "link", "attrs": {"href": href}}]}]}]}

        for bad in ("mailto:", "mailto:a@b", "mailto:a@b.org?subject=x", "mailto:a@b.org,c@d.org", "mailto:a b@c.org", "MAILTO:evil", "mailto:a@b.org%0Abcc=x", "mailto:a@b.org\n", "mailto:a@b.org\r\nBcc: x@y.org"):
            response = self.call("patch", self.ADMIN_URL, {"content": doc(bad), "base_updated_at": base})
            self.assertEqual(response.status_code, 400, bad)
        response = self.call("patch", self.ADMIN_URL, {"content": doc("mailto:help@example.org"), "base_updated_at": base})
        self.assertEqual(response.status_code, 200, response.content)


class PrivacyPolicyTests(SitePageMixin, TestCase):
    model = PrivacyPolicy
    ADMIN_URL = "/adminapi/privacy-policy/"
    PUBLIC_URL = "/adminapi/public/privacy-policy/"
    TARGET_TYPE = "privacy_policy"

    def test_migration_seeds_current_privacy_text(self):
        content = json.dumps(PrivacyPolicy.load().content, ensure_ascii=False)
        for phrase in ("不保存明文 IP", "原則上只保留 3 天", "筆記預設只存在你的瀏覽器", "選擇分享後，錄音會上傳"):
            self.assertIn(phrase, content)
        self.assertNotIn("草稿", content)


class ContactPageTests(SitePageMixin, TestCase):
    model = ContactPage
    ADMIN_URL = "/adminapi/contact-page/"
    PUBLIC_URL = "/adminapi/public/contact-page/"
    TARGET_TYPE = "contact_page"

    def test_migration_seeds_previous_contact_text(self):
        content = json.dumps(ContactPage.load().content, ensure_ascii=False)
        for phrase in ("聯絡方式籌備中。", "先看看這些", "/help", "/privacy"):
            self.assertIn(phrase, content)

    def test_two_pages_are_independent(self):
        base = self._base()
        self.assertEqual(self.call("patch", self.ADMIN_URL, {"content": _doc("只改聯絡"), "base_updated_at": base}).status_code, 200)
        self.assertNotIn("只改聯絡", json.dumps(PrivacyPolicy.load().content, ensure_ascii=False))
