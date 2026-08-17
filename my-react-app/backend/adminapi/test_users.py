import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

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
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


def _patch_json(client, url, headers, payload=None):
    return client.patch(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


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


def _fake_snapshot(doc_id, data, path=None, tribe=None):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = data is not None
    snap.to_dict.return_value = data
    snap.reference = MagicMock()
    snap.reference.path = path or doc_id
    if tribe is not None:
        # pronunciations/{tribe}/recordings/{recordingId} 的真實路徑區段——
        # 給需要驗證 delete_storage_file_by_download_url() 拿到正確
        # expected_path_prefix 的測試用（見 test_account_deletion_scopes_storage_deletion_to_recordings_real_tribe_path）。
        snap.reference.parent.parent.id = tribe
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


class UserCreateTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_requires_account_manager(self):
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1", "name": "New User",
            })
        self.assertEqual(resp.status_code, 403)

    def test_password_too_short_rejected(self):
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "abc", "name": "New User",
            })
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_creates_auth_account_and_firestore_doc(self, mock_create, mock_client_fn):
        mock_create.return_value = _fake_user_record("new-uid", email="new@example.com")
        mock_client, users_doc_ref = _build_client_router(users_doc=None, notes=[], recordings=[])
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1",
                "name": "New User", "identity": "老師",
            })
        self.assertEqual(resp.status_code, 201)
        mock_create.assert_called_once_with("new@example.com", "secret1", display_name="New User")
        users_doc_ref.set.assert_called_once()
        firestore_doc = users_doc_ref.set.call_args[0][0]
        self.assertEqual(firestore_doc["name"], "New User")
        self.assertEqual(firestore_doc["identity"], "老師")
        self.assertEqual(firestore_doc["email"], "new@example.com")
        self.assertEqual(firestore_doc["favorites"][0]["title"], "基礎詞彙")
        self.assertEqual(firestore_doc["user_errors"], {})
        self.assertIn("joinDate", firestore_doc)
        self.assertEqual(AuditLog.objects.filter(action="create_user").count(), 1)

    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_duplicate_email_rejected(self, mock_create):
        from firebase_admin.auth import EmailAlreadyExistsError
        mock_create.side_effect = EmailAlreadyExistsError("dup", cause=None, http_response=None)
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "dup@example.com", "password": "secret1", "name": "Dup",
            })
        self.assertEqual(resp.status_code, 400)

    def test_non_owner_cannot_assign_role_at_creation(self):
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1", "name": "New User", "role": "editor",
            })
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_owner_can_assign_role_at_creation(self, mock_create, mock_client_fn, mock_set_role):
        mock_create.return_value = _fake_user_record("new-uid", email="new@example.com")
        mock_client, _ = _build_client_router(users_doc=None, notes=[], recordings=[])
        mock_client_fn.return_value = mock_client

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1", "name": "New User", "role": "editor",
            })
        self.assertEqual(resp.status_code, 201)
        mock_set_role.assert_called_once_with("new-uid", "editor")
        self.assertTrue(resp.json()["role_assigned"])

    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_role_assignment_failure_still_returns_201_with_created_account(
        self, mock_create, mock_client_fn, mock_set_role,
    ):
        """獨立審查找到的問題：Auth 帳號＋Firestore 文件都已經成功建立，
        角色指派這一步失敗不該讓整個建立操作回報成失敗——帳號本身完整
        可用，只是還沒有角色，屬於可以事後到使用者詳情頁補指派的溫和
        缺陷，不需要走破壞性更大的 rollback（刪掉整個帳號）。但也不能
        靜默吞掉，回應要帶 role_assigned: false 讓前端知道要提醒管理者。"""
        mock_create.return_value = _fake_user_record("new-uid", email="new@example.com")
        mock_client, _ = _build_client_router(users_doc=None, notes=[], recordings=[])
        mock_client_fn.return_value = mock_client
        mock_set_role.side_effect = Exception("role assignment failed")

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1", "name": "New User", "role": "editor",
            })
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.json()["role_assigned"])
        self.assertEqual(resp.json()["uid"], "new-uid")

        log = AuditLog.objects.get(action="create_user")
        self.assertIsNone(log.after["role"])

    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_rolls_back_auth_account_when_firestore_write_fails(self, mock_create, mock_client_fn, mock_delete):
        """Firestore 文件建立失敗時，剛建立的 Auth 帳號要被刪掉，不留下
        「能登入但沒有 users 文件」的半殘帳號。"""
        mock_create.return_value = _fake_user_record("new-uid", email="new@example.com")
        mock_client = MagicMock()
        mock_client.collection.return_value.document.return_value.set.side_effect = Exception("firestore down")
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1", "name": "New User",
            })
        self.assertEqual(resp.status_code, 500)
        mock_delete.assert_called_once_with("new-uid")
        self.assertNotIn("cleanup_required", resp.json())

    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.create_firebase_user")
    def test_rollback_failure_reports_half_broken_account_needs_manual_cleanup(
        self, mock_create, mock_client_fn, mock_delete,
    ):
        """獨立審查找到的問題：Firestore 寫入失敗、連 rollback（刪除剛建立
        的 Auth 帳號）也失敗時，不能只寫 log 就回一句籠統的失敗訊息——
        管理者完全不知道這個 uid 還留著、需要人工清理。回應要明確帶
        uid／auth_created／firestore_created／cleanup_required，不是猜。"""
        mock_create.return_value = _fake_user_record("new-uid", email="new@example.com")
        mock_client = MagicMock()
        mock_client.collection.return_value.document.return_value.set.side_effect = Exception("firestore down")
        mock_client_fn.return_value = mock_client
        mock_delete.side_effect = Exception("rollback also failed")

        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/', headers, {
                "email": "new@example.com", "password": "secret1", "name": "New User",
            })
        self.assertEqual(resp.status_code, 500)
        data = resp.json()
        self.assertEqual(data["uid"], "new-uid")
        self.assertTrue(data["auth_created"])
        self.assertFalse(data["firestore_created"])
        self.assertTrue(data["cleanup_required"])


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

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_owner_cannot_change_own_role(self, mock_get_user, mock_set_role, mock_revoke):
        """就算目標是自己這個 owner 帳號，也不能透過這個端點改自己的角色
        （包含降級或整個拿掉）——一次誤操作就可能永久失去 owner 身分。"""
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/test-uid/role/', headers, {"role": None})
        self.assertEqual(resp.status_code, 403)
        mock_get_user.assert_not_called()
        mock_set_role.assert_not_called()

    @patch("adminapi.firebase_ops.list_all_firebase_users")
    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_cannot_demote_last_remaining_owner(self, mock_get_user, mock_set_role, mock_revoke, mock_list_users):
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        mock_list_users.return_value = [_fake_user_record("owner-uid", role=OWNER)]
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/role/', headers, {"role": "admin"})
        self.assertEqual(resp.status_code, 409)
        mock_set_role.assert_not_called()

    @patch("adminapi.firebase_ops.list_all_firebase_users")
    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_role")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_can_demote_owner_when_another_owner_remains(self, mock_get_user, mock_set_role, mock_revoke, mock_list_users):
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        mock_list_users.return_value = [
            _fake_user_record("test-uid", role=OWNER),
            _fake_user_record("owner-uid", role=OWNER),
        ]
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/role/', headers, {"role": "admin"})
        self.assertEqual(resp.status_code, 200)
        mock_set_role.assert_called_once_with("owner-uid", "admin")


class UserProfileTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_requires_account_manager(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1")
        with _as_role(EDITOR) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"name": "New Name"})
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_updates_name_identity_avatar(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        before_doc = _fake_snapshot("uid1", {"name": "Old Name", "identity": "學生", "avatarUrl": ""})
        after_doc = _fake_snapshot("uid1", {"name": "New Name", "identity": "老師", "avatarUrl": "https://x/a.png"})
        mock_client, users_doc_ref = _build_client_router(users_doc=before_doc, notes=[], recordings=[])
        users_doc_ref.get.side_effect = [before_doc, after_doc]
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {
                "name": "New Name", "identity": "老師", "avatar_url": "https://x/a.png",
            })
        self.assertEqual(resp.status_code, 200)
        users_doc_ref.set.assert_called_once_with(
            {"name": "New Name", "identity": "老師", "avatarUrl": "https://x/a.png"}, merge=True,
        )
        self.assertEqual(AuditLog.objects.filter(action="update_profile").count(), 1)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_empty_name_rejected(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("uid1")
        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"name": "   "})
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_admin_cannot_edit_owner_profile(self, mock_get_user, mock_client_fn):
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/owner-uid/profile/', headers, {"name": "New Name"})
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.set_user_email")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_change_email_syncs_auth_and_firestore(self, mock_get_user, mock_client_fn, mock_set_email):
        mock_get_user.return_value = _fake_user_record("uid1", email="old@example.com")
        before_doc = _fake_snapshot("uid1", {"name": "Alice", "email": "old@example.com"})
        mock_client, users_doc_ref = _build_client_router(users_doc=before_doc, notes=[], recordings=[])
        users_doc_ref.get.side_effect = [before_doc, before_doc]
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"email": "new@example.com"})
        self.assertEqual(resp.status_code, 200)
        mock_set_email.assert_called_once_with("uid1", "new@example.com")
        users_doc_ref.set.assert_called_once_with({"email": "new@example.com"}, merge=True)

    @patch("adminapi.firebase_ops.set_user_email")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_duplicate_email_on_change_rejected(self, mock_get_user, mock_client_fn, mock_set_email):
        from firebase_admin.auth import EmailAlreadyExistsError
        mock_get_user.return_value = _fake_user_record("uid1", email="old@example.com")
        mock_set_email.side_effect = EmailAlreadyExistsError("dup", cause=None, http_response=None)
        mock_client, _ = _build_client_router(users_doc=_fake_snapshot("uid1", {}), notes=[], recordings=[])
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"email": "taken@example.com"})
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.set_user_email")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_firestore_email_write_failure_rolls_back_auth_email(
        self, mock_get_user, mock_client_fn, mock_set_email,
    ):
        """獨立審查找到的問題：Auth email 已經改成功後，Firestore 那一步
        如果失敗，兩邊會永久不一致，且下次重試時因為 Auth 已經是新值，
        不會再嘗試修正 Firestore。這裡驗證失敗時會嘗試把 Auth email 回復
        成原值，讓兩邊至少維持一致（都是舊值），並回傳 500 而不是讓例外
        一路往外拋。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="old@example.com")
        before_doc = _fake_snapshot("uid1", {"name": "Alice", "email": "old@example.com"})
        mock_client, users_doc_ref = _build_client_router(users_doc=before_doc, notes=[], recordings=[])
        users_doc_ref.set.side_effect = Exception("firestore down")
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"email": "new@example.com"})
        self.assertEqual(resp.status_code, 500)
        # 第一次呼叫把 email 改成新值，第二次呼叫（回復）把 email 改回舊值。
        mock_set_email.assert_has_calls([
            call("uid1", "new@example.com"),
            call("uid1", "old@example.com"),
        ])

    @patch("adminapi.firebase_ops.set_user_email")
    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_firestore_email_write_failure_and_rollback_also_fails_reports_inconsistency(
        self, mock_get_user, mock_client_fn, mock_set_email,
    ):
        """Firestore 寫入失敗、連 Auth email 回復也失敗時，不能只寫 log
        就回一句籠統的錯誤——回應要明確告知兩邊已經不一致，需要人工複查。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="old@example.com")
        before_doc = _fake_snapshot("uid1", {"name": "Alice", "email": "old@example.com"})
        mock_client, users_doc_ref = _build_client_router(users_doc=before_doc, notes=[], recordings=[])
        users_doc_ref.set.side_effect = Exception("firestore down")
        mock_client_fn.return_value = mock_client
        mock_set_email.side_effect = [None, Exception("auth rollback also failed")]

        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"email": "new@example.com"})
        self.assertEqual(resp.status_code, 500)
        self.assertIn("不一致", resp.json()["detail"])
        self.assertEqual(resp.json()["uid"], "uid1")

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_firestore_write_failure_without_email_change_does_not_touch_auth(
        self, mock_get_user, mock_client_fn,
    ):
        """只改 name（沒有 email）時 Firestore 寫入失敗，不該嘗試任何 Auth
        email 回復邏輯（一開始就沒有動過 Auth），單純回報失敗即可。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        before_doc = _fake_snapshot("uid1", {"name": "Old Name"})
        mock_client, users_doc_ref = _build_client_router(users_doc=before_doc, notes=[], recordings=[])
        users_doc_ref.set.side_effect = Exception("firestore down")
        mock_client_fn.return_value = mock_client

        with _as_role(ADMIN) as headers:
            resp = _patch_json(self.client, '/adminapi/users/uid1/profile/', headers, {"name": "New Name"})
        self.assertEqual(resp.status_code, 500)
        self.assertNotIn("不一致", resp.json()["detail"])


class UserPasswordTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_requires_account_manager(self, mock_get_user):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/password/', headers, {
                "new_password": "newpass1", "confirm_email": "alice@example.com",
            })
        self.assertEqual(resp.status_code, 403)

    def test_password_too_short_rejected_before_lookup(self):
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/password/', headers, {
                "new_password": "abc", "confirm_email": "alice@example.com",
            })
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_confirm_email_mismatch_rejected(self, mock_get_user):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/password/', headers, {
                "new_password": "newpass1", "confirm_email": "wrong@example.com",
            })
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_admin_cannot_change_owner_password(self, mock_get_user):
        mock_get_user.return_value = _fake_user_record("owner-uid", email="owner@example.com", role=OWNER)
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/password/', headers, {
                "new_password": "newpass1", "confirm_email": "owner@example.com",
            })
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_password")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_successful_change_revokes_sessions_and_logs_without_plaintext(
        self, mock_get_user, mock_set_password, mock_revoke,
    ):
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/password/', headers, {
                "new_password": "supersecret1", "confirm_email": "alice@example.com",
            })
        self.assertEqual(resp.status_code, 200)
        mock_set_password.assert_called_once_with("uid1", "supersecret1")
        mock_revoke.assert_called_once_with("uid1")

        log = AuditLog.objects.get(action="change_password")
        # 稽核紀錄不得含明文密碼——不管是 before／after 都只能有一個布林標記。
        log_blob = json.dumps({"before": log.before, "after": log.after}, ensure_ascii=False)
        self.assertNotIn("supersecret1", log_blob)
        self.assertEqual(log.after, {"password_changed": True, "sessions_revoked": True})
        self.assertTrue(resp.json()["sessions_revoked"])

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_password")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_revoke_sessions_failure_does_not_500_and_reports_honestly(
        self, mock_get_user, mock_set_password, mock_revoke,
    ):
        """獨立審查找到的問題：密碼本身已經改成功是不可逆的既成事實，
        revoke_sessions 失敗不該讓整個請求變成誤導人的 500——那樣管理者
        會誤以為密碼沒改成功，但實際上新密碼已經生效，舊 session 卻還沒
        撤銷。改成誠實回報 sessions_revoked: false，仍然是 200。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        mock_revoke.side_effect = Exception("revoke failed")

        with _as_role(ADMIN) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/password/', headers, {
                "new_password": "supersecret1", "confirm_email": "alice@example.com",
            })
        self.assertEqual(resp.status_code, 200)
        mock_set_password.assert_called_once_with("uid1", "supersecret1")
        self.assertTrue(resp.json()["password_changed"])
        self.assertFalse(resp.json()["sessions_revoked"])

        log = AuditLog.objects.get(action="change_password")
        self.assertEqual(log.after, {"password_changed": True, "sessions_revoked": False})


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

    @patch("adminapi.firebase_ops.list_all_firebase_users")
    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_owner_can_suspend_owner(self, mock_get_user, mock_set_disabled, mock_revoke, mock_list_users):
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        # 系統還有 test-uid（呼叫者自己）跟 owner-uid 兩位有效 owner，停權
        # owner-uid 之後還剩 test-uid 一位，last-owner 檢查應該放行。
        mock_list_users.return_value = [
            _fake_user_record("test-uid", role=OWNER),
            _fake_user_record("owner-uid", role=OWNER),
        ]
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/suspend/', headers)
        self.assertEqual(resp.status_code, 200)
        mock_set_disabled.assert_called_once_with("owner-uid", True)

    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_cannot_suspend_self(self, mock_get_user, mock_set_disabled, mock_revoke):
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/test-uid/suspend/', headers)
        self.assertEqual(resp.status_code, 403)
        mock_get_user.assert_not_called()
        mock_set_disabled.assert_not_called()

    @patch("adminapi.firebase_ops.list_all_firebase_users")
    @patch("adminapi.firebase_ops.revoke_sessions")
    @patch("adminapi.firebase_ops.set_user_disabled")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_cannot_suspend_last_remaining_owner(self, mock_get_user, mock_set_disabled, mock_revoke, mock_list_users):
        mock_get_user.return_value = _fake_user_record("owner-uid", role=OWNER)
        # 全系統只有 owner-uid 這一位有效 owner（呼叫者 test-uid 沒有 role，
        # 例如剛好角色被清空但 token 還沒過期），停權後系統會剩下 0 位 owner。
        mock_list_users.return_value = [_fake_user_record("owner-uid", role=OWNER)]
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/owner-uid/suspend/', headers)
        self.assertEqual(resp.status_code, 409)
        mock_set_disabled.assert_not_called()


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

    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_cannot_delete_self(self, mock_get_user, mock_delete_auth):
        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, '/adminapi/users/test-uid/delete/', headers,
                {"confirm_email": "whatever@example.com"},
            )
        self.assertEqual(resp.status_code, 403)
        mock_get_user.assert_not_called()
        mock_delete_auth.assert_not_called()

    @patch("adminapi.firebase_ops.list_all_firebase_users")
    @patch("adminapi.firebase_ops.delete_firebase_user")
    @patch("adminapi.firebase_ops.get_firebase_user")
    def test_cannot_delete_last_remaining_owner(self, mock_get_user, mock_delete_auth, mock_list_users):
        mock_get_user.return_value = _fake_user_record("owner-uid", email="owner@example.com", role=OWNER)
        mock_list_users.return_value = [_fake_user_record("owner-uid", role=OWNER)]
        with _as_role(OWNER) as headers:
            resp = _post_json(
                self.client, '/adminapi/users/owner-uid/delete/', headers,
                {"confirm_email": "owner@example.com"},
            )
        self.assertEqual(resp.status_code, 409)
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
    def test_account_deletion_scopes_storage_deletion_to_recordings_real_tribe_path(
        self, mock_get_user, mock_client_fn, mock_delete_auth, mock_delete_storage,
    ):
        """expected_path_prefix 必須用文件真正的路徑區段（collection_group
        查詢結果的 reference.parent.parent.id）組出來，不是信任文件內部
        欄位——這是修正「偽造 storageUrl 誘使刪除任意物件」漏洞的一半（另
        一半在 firestore.rules 限制 create 時的 storageUrl 格式）。"""
        mock_get_user.return_value = _fake_user_record("uid1", email="alice@example.com")
        rec_snap = _fake_snapshot(
            "rec1", {"uid": "uid1", "storageUrl": "https://x/o/path?alt=media"}, tribe="tayal",
        )
        users_doc = _fake_snapshot("uid1", {"name": "Alice"})
        mock_client, _ = _build_client_router(users_doc=users_doc, notes=[], recordings=[rec_snap])
        mock_client_fn.return_value = mock_client
        mock_delete_storage.return_value = True

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/users/uid1/delete/', headers, {"confirm_email": "alice@example.com"})

        self.assertEqual(resp.status_code, 200)
        mock_delete_storage.assert_called_once_with(
            "https://x/o/path?alt=media", expected_path_prefix="pronunciations/tayal/",
        )

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
