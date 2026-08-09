"""「編輯已發布內容」機制（revisions.py）的測試——覆蓋題庫類內容
（用 QuizVocabItem 當代表，5 種題庫內容型別共用同一套 make_revision_views
工廠，行為完全一致，不需要每個型別各測一次）與 Announcement（核准角色
用 PUBLISHERS，不是題庫類的 CONTENT_APPROVERS，這個差異要用測試釘住）。

核心要驗證的是使用者提出的需求本身：已發布內容編輯後，對外（一般查詢/
GET）仍然顯示舊內容，直到核准才切換成新內容；退件則舊內容完全不受影響。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

from .models import Announcement, AuditLog, PendingRevision, QuizVocabItem


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


class QuizVocabRevisionTest(TestCase):
    """題庫類內容的編輯已發布內容——用 QuizVocabItem 代表 5 種題庫內容型別
    共用的 make_revision_views 工廠。"""

    def setUp(self):
        self.client = Client()
        self.item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗原始",
            status=QuizVocabItem.STATUS_PUBLISHED, created_by="editor-uid",
        )

    def test_cannot_propose_revision_on_non_published_item(self):
        draft_item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="bzyok", chinese_gloss="豬",
            status=QuizVocabItem.STATUS_DRAFT, created_by="editor-uid",
        )
        with _as_role(EDITOR) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{draft_item.pk}/pending-revision/', headers,
                {"chinese_gloss": "小豬"},
            )
        self.assertEqual(response.status_code, 409)

    def test_editor_can_propose_revision_and_live_item_stays_unchanged(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        self.assertEqual(response.status_code, 201)

        self.item.refresh_from_db()
        self.assertEqual(self.item.chinese_gloss, "狗原始")
        self.assertEqual(self.item.status, QuizVocabItem.STATUS_PUBLISHED)

    def test_list_and_detail_annotate_has_pending_revision(self):
        with _as_role(OWNER) as headers:
            before = self.client.get('/adminapi/quiz-bank/vocab/?tribe=tayal', **headers)
        self.assertFalse(before.json()["results"][0]["has_pending_revision"])

        PendingRevision.objects.create(
            target_type="quiz_vocab_item", target_id=self.item.pk,
            payload={"chinese_gloss": "狗修改版"}, submitted_by="editor-uid",
        )

        with _as_role(OWNER) as headers:
            after_list = self.client.get('/adminapi/quiz-bank/vocab/?tribe=tayal', **headers)
            after_detail = self.client.get(f'/adminapi/quiz-bank/vocab/{self.item.pk}/', **headers)
        self.assertTrue(after_list.json()["results"][0]["has_pending_revision"])
        self.assertTrue(after_detail.json()["has_pending_revision"])

    def test_editing_again_updates_existing_revision_not_a_second_one(self):
        with _as_role(EDITOR) as headers:
            first = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "版本一"},
            )
            second = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "版本二"},
            )
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(second.json()["payload"]["chinese_gloss"], "版本二")
        self.assertEqual(
            PendingRevision.objects.filter(target_type="quiz_vocab_item", target_id=self.item.pk).count(), 1,
        )

    def test_reviewer_can_approve_revision_applies_payload_keeps_published(self):
        # reviewer 能核准題庫類內容的修改——跟核准新內容一樣用 CONTENT_APPROVERS
        # （不是 Announcement 用的 PUBLISHERS，見下方 AnnouncementRevisionTest）。
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/approve/', headers,
                {"review_comment": "審過了"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["chinese_gloss"], "狗修改版")
        self.assertEqual(response.json()["status"], "published")

        revision = PendingRevision.objects.get(target_type="quiz_vocab_item", target_id=self.item.pk)
        self.assertEqual(revision.status, PendingRevision.STATUS_APPROVED)
        self.assertEqual(revision.reviewed_by, "test-uid")

    def test_reject_leaves_live_item_completely_untouched(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/reject/', headers,
                {"review_comment": "用字不對"},
            )
        self.assertEqual(response.status_code, 200)

        self.item.refresh_from_db()
        self.assertEqual(self.item.chinese_gloss, "狗原始")
        self.assertEqual(self.item.status, QuizVocabItem.STATUS_PUBLISHED)

        with _as_role(OWNER) as headers:
            detail = self.client.get(f'/adminapi/quiz-bank/vocab/{self.item.pk}/', **headers)
        self.assertFalse(detail.json()["has_pending_revision"])

    def test_approve_without_pending_revision_returns_409(self):
        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/approve/', headers,
            )
        self.assertEqual(response.status_code, 409)

    def test_reject_requires_review_comment(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/reject/', headers, {},
            )
        self.assertEqual(response.status_code, 400)

    def test_analyst_cannot_propose_revision(self):
        with _as_role(ANALYST) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        self.assertEqual(response.status_code, 403)

    def test_editor_cannot_approve_revision(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/approve/', headers,
            )
        self.assertEqual(response.status_code, 403)

    def test_approve_revision_writes_audit_log(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        with _as_role(REVIEWER) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/approve/', headers,
                {"review_comment": ""},
            )
        log = AuditLog.objects.filter(target_type="quiz_vocab_item", action="approve_revision").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.after["chinese_gloss"], "狗修改版")

    def test_get_pending_revision_returns_404_when_none_exists(self):
        with _as_role(OWNER) as headers:
            response = self.client.get(f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', **headers)
        self.assertEqual(response.status_code, 404)

    def test_get_pending_revision_returns_proposed_payload(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        with _as_role(OWNER) as headers:
            response = self.client.get(f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["payload"]["chinese_gloss"], "狗修改版")

    def test_unpublish_auto_cancels_pending_revision(self):
        """codex 獨立審查找到的問題：下架後殘留的待審修改應該自動失效，
        不能留著等被誤核准套用到已下架內容。"""
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        with _as_role(REVIEWER) as headers:
            unpublish_resp = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/unpublish/', headers,
            )
        self.assertEqual(unpublish_resp.status_code, 200)

        revision = PendingRevision.objects.get(target_type="quiz_vocab_item", target_id=self.item.pk)
        self.assertEqual(revision.status, PendingRevision.STATUS_REJECTED)

    def test_approve_rejects_with_409_if_target_no_longer_published(self):
        """就算 unpublish 那條路徑漏了（或有別的路徑把狀態改離 published），
        approve 本身也要重新確認狀態，不能盲目套用陳舊的提案內容。"""
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/', headers,
                {"chinese_gloss": "狗修改版"},
            )
        # 繞過 unpublish 端點本身（那條路徑已經會主動取消），直接改狀態
        # 模擬「revision 提出之後、核准之前，狀態被別的路徑改變」的時序。
        self.item.status = QuizVocabItem.STATUS_DRAFT
        self.item.save(update_fields=["status"])

        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/quiz-bank/vocab/{self.item.pk}/pending-revision/approve/', headers,
            )
        self.assertEqual(response.status_code, 409)

        self.item.refresh_from_db()
        self.assertEqual(self.item.chinese_gloss, "狗原始")
        revision = PendingRevision.objects.get(target_type="quiz_vocab_item", target_id=self.item.pk)
        self.assertEqual(revision.status, PendingRevision.STATUS_REJECTED)


class AnnouncementRevisionTest(TestCase):
    """Announcement 的編輯已發布內容——核准角色刻意用 PUBLISHERS，不是題庫
    類內容用的 CONTENT_APPROVERS，這是這次功能唯一需要參數化的差異，用
    reviewer（在 CONTENT_APPROVERS 但不在 PUBLISHERS）的測試把這個差異釘住。
    """

    def setUp(self):
        self.client = Client()
        self.announcement = Announcement.objects.create(
            title="原始標題", body="原始內容", category=Announcement.CATEGORY_ANNOUNCEMENT,
            status=Announcement.STATUS_PUBLISHED, created_by="editor-uid",
        )

    def test_editor_can_propose_revision_and_live_announcement_stays_unchanged(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        self.assertEqual(response.status_code, 201)

        self.announcement.refresh_from_db()
        self.assertEqual(self.announcement.title, "原始標題")
        self.assertEqual(self.announcement.status, Announcement.STATUS_PUBLISHED)

    def test_public_endpoint_still_shows_old_content_while_revision_pending(self):
        # 這是使用者需求最核心的一句話：「已發布 -- 對外仍顯示舊內容」。
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        public_response = self.client.get('/adminapi/public/announcements/')
        titles = [item["title"] for item in public_response.json()["results"]]
        self.assertIn("原始標題", titles)
        self.assertNotIn("修改後標題", titles)

    def test_reviewer_cannot_approve_announcement_revision(self):
        # 關鍵差異測試：reviewer 屬於 CONTENT_APPROVERS（能核准題庫類內容的
        # 修改），但公告的核准角色是 PUBLISHERS，reviewer 不在裡面。
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/approve/', headers,
                {"review_comment": ""},
            )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_approve_announcement_revision(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        with _as_role(ADMIN) as headers:
            response = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/approve/', headers,
                {"review_comment": ""},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "修改後標題")
        self.assertEqual(response.json()["status"], "published")

    def test_date_field_in_payload_round_trips_correctly(self):
        # pin_until 是 DateField，serializer.validated_data 驗證後會是
        # Python date 物件——確保 PendingRevision.payload（帶
        # encoder=DjangoJSONEncoder）與後續套用回 Announcement 都正確處理，
        # 不會在寫入 AuditLog 或套用回 model 時因為型別不對而炸掉。
        with _as_role(EDITOR) as headers:
            propose_resp = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"is_pinned": True, "pin_until": "2026-12-31"},
            )
        self.assertEqual(propose_resp.status_code, 201)

        with _as_role(ADMIN) as headers:
            approve_resp = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/approve/', headers,
                {"review_comment": ""},
            )
        self.assertEqual(approve_resp.status_code, 200)
        self.assertEqual(approve_resp.json()["pin_until"], "2026-12-31")

    def test_reject_leaves_public_content_untouched(self):
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        with _as_role(ADMIN) as headers:
            response = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/reject/', headers,
                {"review_comment": "不同意這個修改"},
            )
        self.assertEqual(response.status_code, 200)

        self.announcement.refresh_from_db()
        self.assertEqual(self.announcement.title, "原始標題")

    def test_unpublish_auto_cancels_pending_revision(self):
        """codex 獨立審查找到的問題：公告下架後，殘留的待審修改應該自動
        失效，不能留著等被誤核准套用到已下架公告。"""
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        with _as_role(ADMIN) as headers:
            unpublish_resp = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/unpublish/', headers,
            )
        self.assertEqual(unpublish_resp.status_code, 200)

        revision = PendingRevision.objects.get(target_type="announcement", target_id=self.announcement.pk)
        self.assertEqual(revision.status, PendingRevision.STATUS_REJECTED)

    def test_approve_rejects_with_409_if_announcement_no_longer_published(self):
        """就算 unpublish 那條路徑漏了，approve 本身也要重新確認狀態，
        不能盲目套用陳舊的提案內容到已經不是 published 的公告。"""
        with _as_role(EDITOR) as headers:
            _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/', headers,
                {"title": "修改後標題"},
            )
        # 繞過 unpublish 端點本身（那條路徑已經會主動取消），直接改狀態
        # 模擬「revision 提出之後、核准之前，狀態被別的路徑改變」的時序。
        self.announcement.status = Announcement.STATUS_UNPUBLISHED
        self.announcement.save(update_fields=["status"])

        with _as_role(ADMIN) as headers:
            response = _post_json(
                self.client, f'/adminapi/announcements/{self.announcement.pk}/pending-revision/approve/', headers,
                {"review_comment": ""},
            )
        self.assertEqual(response.status_code, 409)

        self.announcement.refresh_from_db()
        self.assertEqual(self.announcement.title, "原始標題")
        revision = PendingRevision.objects.get(target_type="announcement", target_id=self.announcement.pk)
        self.assertEqual(revision.status, PendingRevision.STATUS_REJECTED)
