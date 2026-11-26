"""WP-6 稽核項目的回歸測試：使用者資料位置清單（BE2a-01／02）、稽核不留個資（BE2a-03）、
建立帳號先寫稽核（BE2a-04）、刪除先停權（BE2a-09）、輸入驗證（BE2a-12）、錯誤訊息（BE2a-13／BE1-05）。"""
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase

from config.roles import ADMIN, OWNER

from .models import AuditLog
from .test_users import _as_role, _fake_snapshot, _fake_user_record, _patch_json, _post_json
from .user_data_locations import DELETED_USER_PLACEHOLDER, LOCATIONS


def _fake_client(top_level=None, subcollections=None, calendar=None, recordings=None, users_doc=None):
    """假的 Firestore client：top_level 是 {集合名: [snapshot]}（where().stream()）、subcollections 是 {子集合名: [snapshot]}。"""
    top_level = top_level or {}
    subcollections = subcollections or {}
    client = MagicMock()
    users_doc_ref = MagicMock()
    users_doc_ref.get.return_value = users_doc or _fake_snapshot("uid1", {"name": "Alice", "email": "alice@example.com"})

    def sub(name):
        query = MagicMock()
        query.stream.return_value = subcollections.get(name, [])
        return query
    users_doc_ref.collection.side_effect = sub
    users_col = MagicMock()
    users_col.document.return_value = users_doc_ref

    def collection(name):
        if name == "users":
            return users_col
        col = MagicMock()
        col.where.return_value.stream.return_value = top_level.get(name, [])
        doc = MagicMock()
        doc.get.return_value = calendar if name == "calendar" and calendar is not None else _fake_snapshot("uid1", None)
        col.document.return_value = doc
        return col
    client.collection.side_effect = collection
    group = MagicMock()
    group.where.return_value.stream.return_value = recordings or []
    client.collection_group.return_value = group
    return client, users_doc_ref


class UserDataLocationsTest(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = Client()
        for target in ("revoke_sessions", "set_user_disabled", "delete_firebase_user"):
            patcher = patch(f"adminapi.firebase_ops.{target}")
            setattr(self, target, patcher.start())
            self.addCleanup(patcher.stop)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_delete_covers_every_location_in_the_shared_list(self, mock_get_user, mock_client_fn):
        """稽核 BE2a-01：雲端筆記、行事曆、作答紀錄、學習統計、規則熟練度都要被刪；檢舉只匿名化。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        cloud_note = _fake_snapshot("n1", {"title": "x"})
        index = _fake_snapshot("summary", {"count": 1})
        calendar = _fake_snapshot("uid1", {"events": []})
        situation = _fake_snapshot("s1", {"userId": "uid1"})
        stats = _fake_snapshot("u1", {"userId": "uid1"})
        report = _fake_snapshot("uid1_target", {"reporterUid": "uid1"})
        client, users_doc_ref = _fake_client(
            top_level={"situations": [situation], "userSituation": [stats], "reports": [report]},
            subcollections={"notes": [cloud_note], "noteIndex": [index]},
            calendar=calendar,
        )
        mock_client_fn.return_value = client

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/uid1/delete/", headers, {"confirm_email": "alice@example.com"})

        self.assertEqual(resp.status_code, 200)
        results = resp.json()["results"]
        for location in LOCATIONS:
            self.assertIn(location.key, results, f"刪除結果缺少 {location.key}")
            self.assertNotIn("error", results[location.key], location.key)
        for snap in (cloud_note, index, calendar, situation, stats):
            snap.reference.delete.assert_called_once()
        report.reference.delete.assert_not_called()
        report.reference.update.assert_called_once_with({"reporterUid": DELETED_USER_PLACEHOLDER})
        self.assertEqual(results["reports"], {"anonymized": 1})

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_delete_suspends_the_account_before_touching_any_data(self, mock_get_user, mock_client_fn):
        """稽核 BE2a-09：先停權並撤銷登入，才開始清資料。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        note = _fake_snapshot("n1", {"uid": "uid1"})
        client, _ = _fake_client(top_level={"sharedNotes": [note]})
        mock_client_fn.return_value = client
        order = []
        self.set_user_disabled.side_effect = lambda *a, **k: order.append("disable")
        note.reference.delete.side_effect = lambda *a, **k: order.append("delete-data")
        self.delete_firebase_user.side_effect = lambda *a, **k: order.append("delete-auth")

        with _as_role(OWNER) as headers:
            _post_json(self.client, "/adminapi/users/uid1/delete/", headers, {"confirm_email": "alice@example.com"})

        self.assertEqual(order[0], "disable")
        self.assertLess(order.index("disable"), order.index("delete-data"))
        self.assertEqual(order[-1], "delete-auth")
        self.set_user_disabled.assert_called_once_with("uid1", True)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_delete_is_aborted_without_deleting_anything_when_suspension_fails(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        note = _fake_snapshot("n1", {"uid": "uid1"})
        client, users_doc_ref = _fake_client(top_level={"sharedNotes": [note]})
        mock_client_fn.return_value = client
        self.set_user_disabled.side_effect = Exception("firebase down")

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/uid1/delete/", headers, {"confirm_email": "alice@example.com"})

        self.assertEqual(resp.status_code, 502)
        note.reference.delete.assert_not_called()
        users_doc_ref.delete.assert_not_called()
        self.delete_firebase_user.assert_not_called()
        self.assertTrue(AuditLog.objects.filter(action="delete_account_failed").exists())

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_audit_log_of_a_deleted_account_keeps_no_personal_data(self, mock_get_user, mock_client_fn):
        """稽核 BE2a-03：稽核紀錄永久保存，不能把 email 與整份使用者文件留在裡面。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        client, _ = _fake_client()
        mock_client_fn.return_value = client

        with _as_role(OWNER) as headers:
            _post_json(self.client, "/adminapi/users/uid1/delete/", headers, {"confirm_email": "alice@example.com"})

        entry = AuditLog.objects.get(action="delete_account")
        self.assertEqual(set(entry.before), {"uid", "role", "disabled"})
        everything = str([(e.before, e.after) for e in AuditLog.objects.all()])
        self.assertNotIn("alice@example.com", everything)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_export_includes_every_location_from_the_same_list(self, mock_get_user, mock_client_fn):
        """稽核 BE2a-02：匯出與刪除用同一份清單，範圍一致。"""
        mock_get_user.return_value = _fake_user_record("uid1")
        calendar = _fake_snapshot("uid1", {"events": [1]})
        client, _ = _fake_client(
            top_level={"situations": [_fake_snapshot("s1", {"userId": "uid1"})]},
            subcollections={"notes": [_fake_snapshot("n1", {"title": "x"})]},
            calendar=calendar,
        )
        mock_client_fn.return_value = client

        with _as_role(OWNER) as headers:
            resp = self.client.get("/adminapi/users/uid1/export/", **headers)

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        exported_keys = set(body["other_firestore_data"]) | {"shared_notes", "pronunciations"}
        self.assertEqual(exported_keys, {location.key for location in LOCATIONS})
        self.assertEqual(len(body["other_firestore_data"]["cloud_notes"]), 1)
        self.assertEqual(len(body["other_firestore_data"]["situations"]), 1)
        self.assertEqual(body["other_firestore_data"]["calendar"][0]["events"], [1])
        self.assertIn("quiz_research_events", body["django_side"])
        self.assertIn("ai_feedback", body["django_side"])


class UserCreateAuditAndValidationTest(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = Client()

    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_create_is_refused_when_the_audit_log_cannot_be_written(self, mock_create):
        """稽核 BE2a-04：建立帳號（含角色）先寫稽核，寫不進去就不建立。"""
        with patch("adminapi._shared.write_audit_log", side_effect=Exception("audit db down")), _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/", headers, {
                "email": "new@example.com", "password": "secret123", "name": "新人", "role": "editor",
            })
        self.assertEqual(resp.status_code, 503)
        mock_create.assert_not_called()

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_the_request_is_logged_before_the_account_exists_with_a_masked_email(self, mock_create, mock_client_fn):
        mock_create.side_effect = lambda *a, **k: self.assertTrue(
            AuditLog.objects.filter(action="create_user_requested").exists(), "建立帳號前必須已有稽核紀錄",
        ) or _fake_user_record("new-uid", email="new@example.com")
        mock_client_fn.return_value = MagicMock()
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/", headers, {
                "email": "new@example.com", "password": "secret123", "name": "新人",
            })
        self.assertEqual(resp.status_code, 201)
        entry = AuditLog.objects.get(action="create_user_requested")
        self.assertEqual(entry.after["email"], "n***@example.com")
        self.assertNotIn("new@example.com", str([(e.target_id, e.after) for e in AuditLog.objects.all()]))

    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_firebase_error_text_is_not_echoed_to_the_client(self, mock_create):
        mock_create.side_effect = ValueError("Malformed email address string: 'x' at https://internal.example/secret")
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, "/adminapi/users/", headers, {
                "email": "bad", "password": "secret123", "name": "新人",
            })
        self.assertEqual(resp.status_code, 400)
        self.assertNotIn("internal.example", resp.json()["detail"])
        self.assertNotIn("Malformed", resp.json()["detail"])
        self.assertTrue(AuditLog.objects.filter(action="create_user_failed").exists())

    def test_non_string_and_oversized_fields_are_400_not_500(self):
        with _as_role(OWNER) as headers:
            for payload in (
                {"email": 123, "password": "secret123", "name": "x"},
                {"email": "a@b.co", "password": "secret123", "name": ["x"]},
                {"email": "a@b.co", "password": "secret123", "name": "x" * 101},
                {"email": "a@b.co", "password": 123456, "name": "x"},
                {"email": "a@b.co", "password": "secret123", "name": "x", "identity": {"a": 1}},
            ):
                resp = _post_json(self.client, "/adminapi/users/", headers, payload)
                self.assertEqual(resp.status_code, 400, payload)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_profile_rejects_non_string_fields(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1")
        mock_client_fn.return_value = MagicMock()
        with _as_role(ADMIN) as headers:
            for payload in ({"name": 5}, {"identity": ["a"]}, {"avatar_url": 1}, {"email": 7}, {"name": "x" * 101}):
                resp = _patch_json(self.client, "/adminapi/users/uid1/profile/", headers, payload)
                self.assertEqual(resp.status_code, 400, payload)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_profile_audit_records_only_the_changed_fields_with_masked_email(self, mock_get_user, mock_client_fn):
        """稽核 BE2a-03：不存整份使用者文件。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        mock_client_fn.return_value = MagicMock()
        before_doc = _fake_snapshot("uid1", {"name": "舊名字", "email": "alice@example.com", "favorites": [1, 2, 3]})
        mock_client_fn.return_value.collection.return_value.document.return_value.get.return_value = before_doc
        with _as_role(ADMIN) as headers:
            _patch_json(self.client, "/adminapi/users/uid1/profile/", headers, {"name": "新名字"})
        entry = AuditLog.objects.get(action="update_profile")
        self.assertEqual(entry.before, {"name": "舊名字"})
        self.assertEqual(entry.after, {"name": "新名字"})


class UsersListCacheTest(TestCase):
    def test_list_cache_is_used_when_asked_and_cleared_by_writes(self):
        from adminapi import firebase_ops

        users = [_fake_user_record("a")]
        page = MagicMock()
        page.users = users
        page.get_next_page.return_value = None
        firebase_ops.invalidate_users_cache()
        with patch("adminapi.firebase_ops.ensure_firebase_initialized"), \
                patch("firebase_admin.auth.list_users", return_value=page) as list_users:
            firebase_ops.list_all_firebase_users(use_cache=True)
            firebase_ops.list_all_firebase_users(use_cache=True)
            self.assertEqual(list_users.call_count, 1)
            firebase_ops.list_all_firebase_users()           # 預設不用快取（owner 數量檢查要即時）
            self.assertEqual(list_users.call_count, 2)
            firebase_ops.invalidate_users_cache()
            firebase_ops.list_all_firebase_users(use_cache=True)
            self.assertEqual(list_users.call_count, 3)
        firebase_ops.invalidate_users_cache()
