import json
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import EDITOR, OWNER

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


def _fake_snapshot(doc_id, data, path=None):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = data is not None
    snap.to_dict.return_value = data
    snap.reference = MagicMock()
    snap.reference.path = path or doc_id
    return snap


class FakeDocRef:
    """最小可行的假 DocumentReference：get()/update()/delete()/collection()。"""
    def __init__(self, snapshot=None):
        self.snapshot = snapshot if snapshot is not None else _fake_snapshot("missing", None)
        self.update = MagicMock()
        self.delete = MagicMock()
        self._subcollections = {}

    def get(self):
        return self.snapshot

    def collection(self, name):
        return self._subcollections.setdefault(name, FakeCollection())


class FakeCollection:
    """最小可行的假 CollectionReference／Query：where／order_by 回傳自己
    （模擬鏈式呼叫），stream() 回傳預先塞好的文件，document(id) 回傳對應的
    FakeDocRef（沒有預先註冊的 id 會拿到一個 exists=False 的假文件，模擬
    Firestore「查無此文件」的行為）。"""
    def __init__(self, docs=None):
        self._docs = docs or []
        self._doc_refs = {}

    def where(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def stream(self):
        return self._docs

    def document(self, doc_id):
        if doc_id not in self._doc_refs:
            self._doc_refs[doc_id] = FakeDocRef()
        return self._doc_refs[doc_id]

    def set_document(self, doc_id, data):
        ref = FakeDocRef(_fake_snapshot(doc_id, data))
        self._doc_refs[doc_id] = ref
        return ref


def _build_client(collections=None, groups=None):
    collections = collections or {}
    groups = groups or {}
    mock_client = MagicMock()
    mock_client.collection.side_effect = lambda name: collections.get(name, FakeCollection())
    mock_client.collection_group.side_effect = lambda name: groups.get(name, FakeCollection())
    return mock_client


class NoteListTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_requires_staff_role(self):
        with _as_role(None) as headers:
            resp = self.client.get('/adminapi/moderation/notes/', **headers)
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_lists_notes_with_report_counts_and_filters(self, mock_client_fn):
        notes = FakeCollection(docs=[
            _fake_snapshot("note1", {"preview": "hello world", "username": "Alice", "deleted": False}),
            _fake_snapshot("note2", {"preview": "other", "username": "Bob", "deleted": False}),
        ])
        reports = FakeCollection(docs=[
            _fake_snapshot("r1", {"status": "pending", "targetType": "note", "targetId": "note1"}),
        ])
        mock_client_fn.return_value = _build_client(collections={"sharedNotes": notes, "reports": reports})

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/notes/', **headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["count"], 2)
        by_id = {item["id"]: item for item in data["results"]}
        self.assertEqual(by_id["note1"]["report_count"], 1)
        self.assertEqual(by_id["note2"]["report_count"], 0)

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/notes/?keyword=hello', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], "note1")

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/notes/?has_reports=true', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], "note1")


class NoteToggleDeletedTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_404_for_missing_note(self, mock_client_fn):
        mock_client_fn.return_value = _build_client(collections={"sharedNotes": FakeCollection()})
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/moderation/notes/missing/toggle-deleted/', headers)
        self.assertEqual(resp.status_code, 404)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_requires_account_manager(self, mock_client_fn):
        notes = FakeCollection()
        notes.set_document("note1", {"deleted": False})
        mock_client_fn.return_value = _build_client(collections={"sharedNotes": notes})
        with _as_role(EDITOR) as headers:
            resp = _post_json(self.client, '/adminapi/moderation/notes/note1/toggle-deleted/', headers)
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_toggles_deleted_flag(self, mock_client_fn):
        notes = FakeCollection()
        doc_ref = notes.set_document("note1", {"deleted": False})
        mock_client_fn.return_value = _build_client(collections={"sharedNotes": notes})

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/moderation/notes/note1/toggle-deleted/', headers)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["deleted"])
        doc_ref.update.assert_called_once_with({"deleted": True})
        self.assertEqual(AuditLog.objects.filter(action="toggle_note_deleted").count(), 1)


class RecordingListTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_extracts_tribe_from_path_and_filters(self, mock_client_fn):
        recordings = FakeCollection(docs=[
            _fake_snapshot("rec1", {"word": "abas", "uid": "u1"}, path="pronunciations/tayal/recordings/rec1"),
            _fake_snapshot("rec2", {"word": "kolong", "uid": "u2"}, path="pronunciations/amis/recordings/rec2"),
        ])
        reports = FakeCollection(docs=[])
        mock_client_fn.return_value = _build_client(
            collections={"reports": reports}, groups={"recordings": recordings},
        )

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/recordings/', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 2)
        by_id = {item["id"]: item for item in data["results"]}
        self.assertEqual(by_id["rec1"]["tribe"], "tayal")
        self.assertEqual(by_id["rec2"]["tribe"], "amis")

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/recordings/?tribe=tayal', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], "rec1")


class RecordingDeleteTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.delete_storage_file_by_download_url")
    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_deletes_storage_and_firestore(self, mock_client_fn, mock_delete_storage):
        recordings_col = FakeCollection()
        rec_ref = recordings_col.set_document("rec1", {"word": "abas", "storageUrl": "https://x/o/path?alt=media"})
        tribe_ref = FakeDocRef()
        tribe_ref._subcollections["recordings"] = recordings_col
        pronunciations = FakeCollection()
        pronunciations._doc_refs["tayal"] = tribe_ref
        mock_client_fn.return_value = _build_client(collections={"pronunciations": pronunciations})
        mock_delete_storage.return_value = True

        with _as_role(OWNER) as headers:
            resp = self.client.delete('/adminapi/moderation/recordings/tayal/rec1/', **headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["deleted"])
        self.assertTrue(data["storage_deleted"])
        rec_ref.delete.assert_called_once()
        mock_delete_storage.assert_called_once_with(
            "https://x/o/path?alt=media", expected_path_prefix="pronunciations/tayal/",
        )
        self.assertEqual(AuditLog.objects.filter(action="delete_recording").count(), 1)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_404_for_missing_recording(self, mock_client_fn):
        pronunciations = FakeCollection()
        mock_client_fn.return_value = _build_client(collections={"pronunciations": pronunciations})
        with _as_role(OWNER) as headers:
            resp = self.client.delete('/adminapi/moderation/recordings/tayal/missing/', **headers)
        self.assertEqual(resp.status_code, 404)

    @patch("adminapi.firebase_ops.delete_storage_file_by_download_url")
    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_storage_deletion_failure_preserves_firestore_doc(self, mock_client_fn, mock_delete_storage):
        """獨立審查找到的問題：原本不管 Storage 刪除成不成功都會接著刪
        Firestore 文件，"deleted": true 會讓管理者誤以為已經清乾淨，實際
        上留下一個永遠定位不到的孤兒音檔。現在 Storage 刪除失敗時要保留
        Firestore 文件（讓管理者能安全重試），並回傳 502 而不是 200。"""
        recordings_col = FakeCollection()
        rec_ref = recordings_col.set_document("rec1", {"word": "abas", "storageUrl": "https://x/o/path?alt=media"})
        tribe_ref = FakeDocRef()
        tribe_ref._subcollections["recordings"] = recordings_col
        pronunciations = FakeCollection()
        pronunciations._doc_refs["tayal"] = tribe_ref
        mock_client_fn.return_value = _build_client(collections={"pronunciations": pronunciations})
        mock_delete_storage.return_value = False

        with _as_role(OWNER) as headers:
            resp = self.client.delete('/adminapi/moderation/recordings/tayal/rec1/', **headers)
        self.assertEqual(resp.status_code, 502)
        rec_ref.delete.assert_not_called()
        self.assertEqual(AuditLog.objects.filter(action="delete_recording").count(), 0)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_missing_storage_url_still_deletes_firestore_doc(self, mock_client_fn):
        """沒有 storageUrl 代表本來就沒有東西要清，不是「清理失敗」——這
        種錄音文件（例如歷史髒資料）刪除應該正常進行，不該被新加的檢查
        意外擋下來。"""
        recordings_col = FakeCollection()
        rec_ref = recordings_col.set_document("rec1", {"word": "abas"})
        tribe_ref = FakeDocRef()
        tribe_ref._subcollections["recordings"] = recordings_col
        pronunciations = FakeCollection()
        pronunciations._doc_refs["tayal"] = tribe_ref
        mock_client_fn.return_value = _build_client(collections={"pronunciations": pronunciations})

        with _as_role(OWNER) as headers:
            resp = self.client.delete('/adminapi/moderation/recordings/tayal/rec1/', **headers)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["storage_deleted"])
        rec_ref.delete.assert_called_once()


class ReportListTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_status_and_target_type_filters_with_summary(self, mock_client_fn):
        notes = FakeCollection()
        notes.set_document("note1", {"preview": "hi", "username": "Alice"})
        reports = FakeCollection(docs=[
            _fake_snapshot("rep1", {
                "targetType": "note", "targetId": "note1", "targetTribe": "",
                "reporterUid": "u1", "reason": "spam", "status": "pending",
            }),
            _fake_snapshot("rep2", {
                "targetType": "recording", "targetId": "rec1", "targetTribe": "tayal",
                "reporterUid": "u2", "reason": "inappropriate", "status": "resolved",
            }),
        ])
        mock_client_fn.return_value = _build_client(collections={"sharedNotes": notes, "reports": reports})

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/reports/', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 2)
        rep1 = next(item for item in data["results"] if item["id"] == "rep1")
        self.assertEqual(rep1["target_summary"]["preview"], "hi")

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/reports/?target_type=recording', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], "rep2")


class ReportResolveDismissTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_404_for_missing_report(self, mock_client_fn):
        mock_client_fn.return_value = _build_client(collections={"reports": FakeCollection()})
        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/reports/missing/resolve/', headers)
        self.assertEqual(resp.status_code, 404)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_resolve_updates_status_and_logs(self, mock_client_fn):
        reports = FakeCollection()
        doc_ref = reports.set_document("rep1", {"status": "pending"})
        mock_client_fn.return_value = _build_client(collections={"reports": reports})

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/reports/rep1/resolve/', headers, {"resolution_note": "已下架"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "resolved")
        update_kwargs = doc_ref.update.call_args[0][0]
        self.assertEqual(update_kwargs["status"], "resolved")
        self.assertEqual(update_kwargs["resolutionNote"], "已下架")
        self.assertEqual(AuditLog.objects.filter(action="report_resolved").count(), 1)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_dismiss_updates_status(self, mock_client_fn):
        reports = FakeCollection()
        reports.set_document("rep1", {"status": "pending"})
        mock_client_fn.return_value = _build_client(collections={"reports": reports})

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/reports/rep1/dismiss/', headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "dismissed")

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_resolve_already_resolved_report_rejected_with_409(self, mock_client_fn):
        """獨立審查找到的問題：原本沒有前置狀態檢查，任何狀態的檢舉都能
        被重複核結。這裡驗證已經是 resolved 的檢舉不能再次核結，且完全
        不會呼叫 update()（不只是回應碼對，寫入本身也不該發生）。"""
        reports = FakeCollection()
        doc_ref = reports.set_document("rep1", {"status": "resolved"})
        mock_client_fn.return_value = _build_client(collections={"reports": reports})

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/reports/rep1/resolve/', headers)
        self.assertEqual(resp.status_code, 409)
        doc_ref.update.assert_not_called()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_dismiss_already_dismissed_report_rejected_with_409(self, mock_client_fn):
        reports = FakeCollection()
        doc_ref = reports.set_document("rep1", {"status": "dismissed"})
        mock_client_fn.return_value = _build_client(collections={"reports": reports})

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/reports/rep1/dismiss/', headers)
        self.assertEqual(resp.status_code, 409)
        doc_ref.update.assert_not_called()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_concurrent_resolve_rejected_with_409_via_precondition_failure(self, mock_client_fn):
        """獨立審查找到的問題：兩位管理員幾乎同時核結同一筆檢舉時，都會
        讀到 pending、都會通過前置狀態檢查——真正的正確性保證要靠
        Firestore 伺服器端的 LastUpdateOption precondition，不是應用層的
        前置檢查（那個只能擋「已經處理過」，擋不住「同時處理中」）。這裡
        直接 mock update() 拋出 FailedPrecondition，模擬「寫入當下才發現
        文件已經被別人動過」的真實情境。"""
        from google.api_core import exceptions as gcloud_exceptions
        reports = FakeCollection()
        doc_ref = reports.set_document("rep1", {"status": "pending"})
        doc_ref.update.side_effect = gcloud_exceptions.FailedPrecondition("document has been modified")
        mock_client_fn.return_value = _build_client(collections={"reports": reports})

        with _as_role(OWNER) as headers:
            resp = _post_json(self.client, '/adminapi/reports/rep1/resolve/', headers)
        self.assertEqual(resp.status_code, 409)
        self.assertIn("其他管理員", resp.json()["detail"])
        self.assertEqual(AuditLog.objects.filter(action="report_resolved").count(), 0)
