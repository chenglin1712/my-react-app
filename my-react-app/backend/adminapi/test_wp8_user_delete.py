"""WP-8 追加：沒有 email 的帳號改用 confirm_uid 確認刪除（見 user_views._delete_confirmation）。"""
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase

from config.roles import ADMIN, OWNER

from .models import AuditLog
from .test_users import _as_role, _fake_user_record, _post_json
from .test_wp6_users import _fake_client

_URL = "/adminapi/users/uid1/delete/"


class DeleteConfirmationTest(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = Client()
        for target in ("revoke_sessions", "set_user_disabled", "delete_firebase_user"):
            patcher = patch(f"adminapi.firebase_ops.{target}")
            setattr(self, target, patcher.start())
            self.addCleanup(patcher.stop)
        client_patcher = patch("adminapi.firebase_ops.get_firestore_client")
        self.mock_client_fn = client_patcher.start()
        self.addCleanup(client_patcher.stop)
        self.mock_client_fn.return_value = _fake_client()[0]
        user_patcher = patch("adminapi.firebase_ops.get_firebase_user")
        self.mock_get_user = user_patcher.start()
        self.addCleanup(user_patcher.stop)

    def _delete(self, payload, role=OWNER):
        with _as_role(role) as headers:
            return _post_json(self.client, _URL, headers, payload)

    def test_account_without_email_is_deleted_with_matching_uid(self):
        self.mock_get_user.return_value = _fake_user_record("uid1", email=None)
        resp = self._delete({"confirm_uid": "uid1"})
        self.assertEqual(resp.status_code, 200)
        self.delete_firebase_user.assert_called_once_with("uid1")
        entry = AuditLog.objects.get(action="delete_account")
        self.assertEqual(entry.after["confirmed_by"], "uid")

    def test_uid_surrounding_whitespace_is_ignored_but_case_is_not(self):
        self.mock_get_user.return_value = _fake_user_record("uid1", email="")
        self.assertEqual(self._delete({"confirm_uid": "  uid1 "}).status_code, 200)

        self.delete_firebase_user.reset_mock()
        resp = self._delete({"confirm_uid": "UID1"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("confirm_uid", resp.json()["errors"])
        self.delete_firebase_user.assert_not_called()

    def test_account_without_email_rejects_wrong_missing_or_non_string_uid(self):
        self.mock_get_user.return_value = _fake_user_record("uid1", email=None)
        for payload in ({"confirm_uid": "uid2"}, {}, {"confirm_uid": ["uid1"]}, {"confirm_email": ""}):
            with self.subTest(payload=payload):
                resp = self._delete(payload)
                self.assertEqual(resp.status_code, 400)
        self.set_user_disabled.assert_not_called()
        self.delete_firebase_user.assert_not_called()
        self.assertFalse(AuditLog.objects.filter(action="delete_account").exists())

    def test_account_with_email_cannot_be_confirmed_by_uid(self):
        """確認強度不降低：有 email 的帳號只接受 email。"""
        self.mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        resp = self._delete({"confirm_uid": "uid1"})
        self.assertEqual(resp.status_code, 400)
        self.delete_firebase_user.assert_not_called()

    def test_account_with_email_records_email_confirmation_without_the_address(self):
        self.mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        resp = self._delete({"confirm_email": "alice@example.com"})
        self.assertEqual(resp.status_code, 200)
        entry = AuditLog.objects.get(action="delete_account")
        self.assertEqual(entry.after, {"status": "started", "confirmed_by": "email"})
        everything = str([(e.before, e.after) for e in AuditLog.objects.all()])
        self.assertNotIn("alice@example.com", everything)

    def test_non_string_confirm_email_is_400_not_500(self):
        self.mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        self.assertEqual(self._delete({"confirm_email": 123}).status_code, 400)

    def test_owner_protection_still_applies_before_uid_confirmation(self):
        self.mock_get_user.return_value = _fake_user_record("uid1", email=None, role=OWNER)
        resp = self._delete({"confirm_uid": "uid1"}, role=ADMIN)
        self.assertEqual(resp.status_code, 403)
        self.delete_firebase_user.assert_not_called()

    def test_cannot_delete_self_even_with_uid(self):
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/test-uid/delete/", headers, {"confirm_uid": "test-uid"})
        self.assertEqual(resp.status_code, 403)
        self.mock_get_user.assert_not_called()
