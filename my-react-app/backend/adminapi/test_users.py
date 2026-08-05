import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, EDITOR, OWNER

from .models import AuditLog


@contextmanager
def _as_role(role):
    """跟 tests.py 的 _as_role 完全一樣，這裡獨立一份是因為這個檔案是新的
    test*.py（Django 預設的測試探索規則），不方便直接 import tests.py 裡的
    私有 helper。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


def _fake_user_record(uid, email="user@example.com", disabled=False, role=None,
                       verified=True, created=1700000000000, last_sign_in=1700000001000):
    return SimpleNamespace(
        uid=uid,
        email=email,
        email_verified=verified,
        disabled=disabled,
        custom_claims={"role": role} if role else None,
        user_metadata=SimpleNamespace(creation_timestamp=created, last_sign_in_timestamp=last_sign_in),
        provider_data=[SimpleNamespace(provider_id="password")],
    )


def _fake_snapshot(doc_id, data, path=None):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = data is not None
    snap.to_dict.return_value = data
    snap.reference = MagicMock()
    snap.reference.path = path or doc_id
    return snap


def _build_client_router(users_doc=None, notes=None, recordings=None):
    """建一個假的 Firestore client，路由到 P3.2/P3.4 使用者端點實際會用到的
    collection("users")／collection("sharedNotes")／collection_group("recordings")
    三種查詢。回傳 (mock_client, users_doc_ref) 讓呼叫端能斷言 users 文件是否
    被刪除／更新過。"""
    notes = notes if notes is not None else []
    recordings = recordings if recordings is not None else []
    mock_client = MagicMock()

    users_doc_ref = MagicMock()
    users_doc_ref.get.return_value = users_doc
    users_col = MagicMock()
    users_col.document.return_value = users_doc_ref

    notes_query = MagicMock()
    notes_query.where.return_value = notes_query
    notes_query.stream.return_value = notes

    def collection_side_effect(name):
        if name == "users":
            return users_col
        if name == "sharedNotes":
            return notes_query
        raise AssertionError(f"unexpected collection: {name}")
    mock_client.collection.side_effect = collection_side_effect

    recordings_query = MagicMock()
    recordings_query.where.return_value = recordings_query
    recordings_query.stream.return_value = recordings

    def group_side_effect(name):
        if name == "recordings":
            return recordings_query
        raise AssertionError(f"unexpected collection_group: {name}")
    mock_client.collection_group.side_effect = group_side_effect

    mock_client.get_all.return_value = [users_doc] if users_doc is not None else []
    return mock_client, users_doc_ref


class UserListTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_requires_staff_role(self):
        with _as_role(None) as headers:
            resp = self.client.get('/adminapi/users/', **headers)
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_merges_auth_and_firestore_and_filters(self, mock_list_users, mock_client_fn):
        mock_list_users.return_value = [
            _fake_user_record("uid1", email="alice@example.com", role="editor"),
            _fake_user_record("uid2", email="bob@example.com", disabled=True),
        ]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [
            _fake_snapshot("uid1", {"name": "Alice", "identity": "student"}),
            _fake_snapshot("uid2", {"name": "Bob", "identity": "teacher"}),
        ]
        mock_client_fn.return_value = mock_client

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/users/', **headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["count"], 2)
        by_uid = {item["uid"]: item for item in data["results"]}
        self.assertEqual(by_uid["uid1"]["name"], "Alice")
        self.assertEqual(by_uid["uid1"]["role"], "editor")
        self.assertIsNone(by_uid["uid2"]["role"])

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/users/?role=editor', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["uid"], "uid1")

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/users/?disabled=true', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["uid"], "uid2")

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/users/?keyword=alice', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["uid"], "uid1")


class UserDetailTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_not_found_returns_404(self, mock_get_user):
        from firebase_admin.auth import UserNotFoundError
        mock_get_user.side_effect = UserNotFoundError("no such user")
        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/users/missing/', **headers)
        self.assertEqual(resp.status_code, 404)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_merges_content_counts(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        mock_client, _ = _build_client_router(
            users_doc=_fake_snapshot("uid1", {"name": "Alice"}),
            notes=[_fake_snapshot("note1", {"uid": "uid1"})],
            recordings=[
                _fake_snapshot("rec1", {"uid": "uid1"}),
                _fake_snapshot("rec2", {"uid": "uid1"}),
            ],
        )
        mock_client_fn.return_value = mock_client

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/users/uid1/', **headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["content_counts"]["shared_notes"], 1)
        self.assertEqual(data["content_counts"]["pronunciations"], 2)
        self.assertEqual(data["firestore"]["name"], "Alice")


class UserRoleTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_only_owner_can_assign_role(self, mock_get_user, mock_set_role, mock_revoke):
        mock_get_user.return_value = _fake_user_record("uid1")

        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/role/', headers, {"role": "editor"})
        self.assertEqual(resp.status_code, 403)
        mock_set_role.assert_not_called()

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/role/', headers, {"role": "editor"})
        self.assertEqual(resp.status_code, 200)
        mock_set_role.assert_called_once_with("uid1", "editor")
        mock_revoke.assert_called_once_with("uid1")
        log = AuditLog.objects.get(action="assign_role")
        self.assertEqual(log.target_type, "user")
        self.assertEqual(log.target_id, "uid1")

    def test_invalid_role_rejected(self):
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/role/', headers, {"role": "superadmin"})
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_role_none_removes_role(self, mock_get_user, mock_set_role, mock_revoke):
        mock_get_user.return_value = _fake_user_record("uid1", role="editor")
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/role/', headers, {"role": None})
        self.assertEqual(resp.status_code, 200)
        mock_set_role.assert_called_once_with("uid1", None)


class UserSuspendTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_requires_account_manager(self, mock_get_user, mock_set_disabled, mock_revoke):
        mock_get_user.return_value = _fake_user_record("uid1")

        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/suspend/', headers)
        self.assertEqual(resp.status_code, 403)

        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/suspend/', headers)
        self.assertEqual(resp.status_code, 200)
        mock_set_disabled.assert_called_once_with("uid1", True)
        mock_revoke.assert_called_once_with("uid1")
        self.assertEqual(AuditLog.objects.filter(action="suspend").count(), 1)

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_unsuspend(self, mock_get_user, mock_set_disabled, mock_revoke):
        mock_get_user.return_value = _fake_user_record("uid1", disabled=True)
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/unsuspend/', headers)
        self.assertEqual(resp.status_code, 200)
        mock_set_disabled.assert_called_once_with("uid1", False)

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_admin_cannot_suspend_owner(self, mock_get_user, mock_set_disabled, mock_revoke):
        """admin 屬於 ACCOUNT_MANAGERS，角色門檻本身會放行，但目標帳號是
        owner 時要被目標階層擋下——不然 admin 能停權 owner，等於繞過
        ROLE_ASSIGNERS 只留給 owner 的角色階層設計（見 config/roles.py）。"""
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/suspend/', headers)
        self.assertEqual(resp.status_code, 403)
        mock_set_disabled.assert_not_called()

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_owner_can_suspend_owner(self, mock_get_user, mock_set_disabled, mock_revoke):
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/suspend/', headers)
        self.assertEqual(resp.status_code, 200)
        mock_set_disabled.assert_called_once_with("owner-uid", True)


class UserForceLogoutTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_force_logout_only_revokes_sessions(self, mock_get_user, mock_revoke):
        mock_get_user.return_value = _fake_user_record("uid1")
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/force-logout/', headers)
        self.assertEqual(resp.status_code, 200)
        mock_revoke.assert_called_once_with("uid1")
        self.assertEqual(AuditLog.objects.filter(action="force_logout").count(), 1)


class UserExportTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_export_returns_json_attachment_and_logs(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        mock_client, _ = _build_client_router(
            users_doc=_fake_snapshot("uid1", {"name": "Alice"}),
            notes=[_fake_snapshot("note1", {"uid": "uid1", "preview": "hi"})],
        )
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = self.client.get('/adminapi/users/uid1/export/', **headers)
        self.assertEqual(resp.status_code, 200)
        self.assertIn('attachment', resp['Content-Disposition'])
        payload = json.loads(resp.content)
        self.assertEqual(payload["shared_notes"][0]["id"], "note1")
        self.assertEqual(AuditLog.objects.filter(action="export_personal_data").count(), 1)

    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_admin_cannot_export_owner(self, mock_get_user):
        mock_get_user.return_value = _fake_user_record("owner-uid", email="owner@example.com", role=OWNER)
        with _as_role(ADMIN) as headers:
            resp = self.client.get('/adminapi/users/owner-uid/export/', **headers)
        self.assertEqual(resp.status_code, 403)


class UserDeleteTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_confirm_email_mismatch_rejected(self, mock_get_user, mock_delete_auth):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/delete/', headers, {"confirm_email": "wrong@example.com"})
        self.assertEqual(resp.status_code, 400)
        mock_delete_auth.assert_not_called()

    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_admin_cannot_delete_owner(self, mock_get_user, mock_delete_auth):
        """跟停權同一道階層防線：admin 屬於 ACCOUNT_MANAGERS，但目標帳號是
        owner 時要被擋下，email 完全相符也不能繞過——這是比修改角色影響更大
        的操作（帳號直接消失），階層檢查必須先於 email 確認檢查。"""
        mock_get_user.return_value = _fake_user_record("owner-uid", email="owner@example.com", role=OWNER)
        with _as_role(ADMIN) as headers:
            resp = _post_json(
                self.client, '/adminapi/users/owner-uid/delete/', headers,
                {"confirm_email": "owner@example.com"},
            )
        self.assertEqual(resp.status_code, 403)
        mock_delete_auth.assert_not_called()

    @patch("adminapi.firebase_ops.delete_storage_file_by_download_url")
    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_full_delete_flow(self, mock_get_user, mock_client_fn, mock_delete_auth, mock_delete_storage):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        note_snap = _fake_snapshot("note1", {"uid": "uid1"})
        rec_snap = _fake_snapshot("rec1", {"uid": "uid1", "storageUrl": "https://x/o/path?alt=media"})
        users_doc = _fake_snapshot("uid1", {"name": "Alice"})
        mock_client, users_doc_ref = _build_client_router(
            users_doc=users_doc, notes=[note_snap], recordings=[rec_snap],
        )
        mock_client_fn.return_value = mock_client
        mock_delete_storage.return_value = True

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/delete/', headers, {"confirm_email": "alice@example.com"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["results"]
        self.assertEqual(data["shared_notes"]["deleted"], 1)
        self.assertEqual(data["pronunciations"]["deleted"], 1)
        self.assertEqual(data["pronunciations"]["storage_cleanup_failed"], 0)
        self.assertTrue(data["firestore_user_document"]["deleted"])
        self.assertTrue(data["firebase_auth"]["deleted"])
        note_snap.reference.delete.assert_called_once()
        rec_snap.reference.delete.assert_called_once()
        users_doc_ref.delete.assert_called_once()
        mock_delete_auth.assert_called_once_with("uid1")
        self.assertEqual(AuditLog.objects.filter(action="delete_account").count(), 1)

    @patch("adminapi.firebase_ops.delete_storage_file_by_download_url")
    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_storage_cleanup_failure_still_deletes_firestore_doc_but_is_reported(
        self, mock_get_user, mock_client_fn, mock_delete_auth, mock_delete_storage,
    ):
        """Storage 音檔清除失敗時，Firestore 錄音文件仍然會被刪除（整筆錄音
        不該留下一半），但這筆不能算乾淨成功——storage_cleanup_failed 要
        誠實回報，不能被 "deleted": 1 蓋過去讓管理者以為完全清乾淨了。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        rec_snap = _fake_snapshot("rec1", {"uid": "uid1", "storageUrl": "https://x/o/path?alt=media"})
        users_doc = _fake_snapshot("uid1", {"name": "Alice"})
        mock_client, _ = _build_client_router(users_doc=users_doc, notes=[], recordings=[rec_snap])
        mock_client_fn.return_value = mock_client
        mock_delete_storage.return_value = False

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/delete/', headers, {"confirm_email": "alice@example.com"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["results"]
        self.assertEqual(data["pronunciations"]["deleted"], 1)
        self.assertEqual(data["pronunciations"]["storage_cleanup_failed"], 1)
        rec_snap.reference.delete.assert_called_once()

    @patch("adminapi.firebase_ops.delete_storage_file_by_download_url")
    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_partial_failure_still_reports_other_results(self, mock_get_user, mock_client_fn, mock_delete_auth, mock_delete_storage):
        """Firebase Auth 刪除失敗不該讓 Firestore 那幾步的結果消失——三個系統
        沒有跨系統交易，每一步各自成功/失敗，見 user_delete() 的既有設計。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        users_doc = _fake_snapshot("uid1", {"name": "Alice"})
        mock_client, users_doc_ref = _build_client_router(users_doc=users_doc, notes=[], recordings=[])
        mock_client_fn.return_value = mock_client
        mock_delete_auth.side_effect = Exception("firebase down")

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/delete/', headers, {"confirm_email": "alice@example.com"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["results"]
        self.assertFalse(data["firebase_auth"]["deleted"])
        self.assertTrue(data["firestore_user_document"]["deleted"])
        users_doc_ref.delete.assert_called_once()
