from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from config.roles import OWNER

from .models import Announcement, PendingRevision, QuizVocabItem


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


def _fake_report_doc(doc_id, data):
    snap = MagicMock()
    snap.id = doc_id
    snap.to_dict.return_value = data
    return snap


class ReviewQueueTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_requires_staff_role(self):
        with _as_role(None) as headers:
            resp = self.client.get('/adminapi/review-queue/', **headers)
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_aggregates_all_three_sources(self, mock_client_fn):
        now = timezone.now()

        announcement = Announcement.objects.create(
            title="待審公告", created_by="u1", status=Announcement.STATUS_PENDING_REVIEW,
            submitted_by="u1", submitted_at=now - timezone.timedelta(minutes=1),
        )
        vocab = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="abas", chinese_gloss="芭樂",
            created_by="u1", status=QuizVocabItem.STATUS_PENDING_REVIEW,
            submitted_by="u1", submitted_at=now - timezone.timedelta(minutes=2),
        )
        # 已核准的內容不該出現在佇列裡
        QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="published-item", chinese_gloss="x",
            created_by="u1", status=QuizVocabItem.STATUS_PUBLISHED,
        )

        published_target = Announcement.objects.create(
            title="已發布內容", created_by="u1", status=Announcement.STATUS_PUBLISHED,
        )
        revision = PendingRevision.objects.create(
            target_type="announcement", target_id=published_target.pk,
            payload={"title": "修改中的標題"}, submitted_by="u2",
        )

        mock_client = MagicMock()
        mock_client.collection.return_value.where.return_value.stream.return_value = [
            _fake_report_doc("rep1", {
                "targetType": "note", "reason": "spam", "reporterUid": "u3",
                "createdAt": now - timezone.timedelta(minutes=3),
            }),
        ]
        mock_client_fn.return_value = mock_client

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/review-queue/', **headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # 2 個送審中的內容（公告 + 配合題詞彙，已核准/已發布的那兩筆不算）
        # + 1 筆待審修改 + 1 筆待處理檢舉 = 4
        self.assertEqual(data["count"], 4)

        by_content_type = {item["content_type"]: item for item in data["results"]}
        announcement_submission = by_content_type["announcement"]
        self.assertEqual(announcement_submission["type"], "submission")
        self.assertEqual(announcement_submission["id"], announcement.pk)
        self.assertEqual(announcement_submission["title"], "待審公告")

        vocab_submission = by_content_type["quiz_vocab_item"]
        self.assertEqual(vocab_submission["type"], "submission")
        self.assertEqual(vocab_submission["id"], vocab.pk)

        revision_item = next(item for item in data["results"] if item["type"] == "revision")
        self.assertEqual(revision_item["id"], published_target.pk)
        self.assertEqual(revision_item["title"], "已發布內容")

        report_item = next(item for item in data["results"] if item["type"] == "report")
        self.assertEqual(report_item["id"], "rep1")

        # 依 submitted_at 由新到舊排序：announcement(-1m) 排在 vocab(-2m) 前面，
        # report(-3m) 排最後。
        order = [item["id"] for item in data["results"] if item["type"] in ("submission", "report")]
        self.assertEqual(order, [announcement.pk, vocab.pk, "rep1"])

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_type_filter(self, mock_client_fn):
        Announcement.objects.create(
            title="待審公告", created_by="u1", status=Announcement.STATUS_PENDING_REVIEW,
            submitted_by="u1", submitted_at=timezone.now(),
        )
        mock_client = MagicMock()
        mock_client.collection.return_value.where.return_value.stream.return_value = []
        mock_client_fn.return_value = mock_client

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/review-queue/?type=report', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 0)

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/review-queue/?type=submission', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_revision_for_deleted_target_falls_back_to_placeholder_title(self, mock_client_fn):
        PendingRevision.objects.create(
            target_type="announcement", target_id=999999, payload={}, submitted_by="u2",
        )
        mock_client = MagicMock()
        mock_client.collection.return_value.where.return_value.stream.return_value = []
        mock_client_fn.return_value = mock_client

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/review-queue/', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertIn("原始內容已刪除", data["results"][0]["title"])
