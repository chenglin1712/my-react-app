import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from datetime import timedelta

from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

from .models import Announcement, AuditLog


@contextmanager
def _as_role(role):
    """模擬一個已登入、角色是 role 的請求。role=None 代表「有登入但沒有 staff
    角色」（一般學習者帳號打到這支 API 的情境）。

    跟 config/tests.py 的 RequireRoleTest 用同一套作法：關掉 AUTH_DEV_BYPASS，
    直接 mock verify_id_token 的回傳值——這樣才能在同一支測試檔案裡切換不同
    角色，AUTH_DEV_BYPASS 模式下角色是寫死在環境變數的，沒辦法每個測試各自
    指定。
    """
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _post_json(client, url, headers, payload=None):
    return client.post(
        url, data=json.dumps(payload or {}), content_type="application/json", **headers,
    )


def _patch_json(client, url, headers, payload):
    return client.patch(
        url, data=json.dumps(payload), content_type="application/json", **headers,
    )


class AnnouncementModelValidationTest(TestCase):
    def test_pinned_without_pin_until_rejected(self):
        a = Announcement(title="t", created_by="u", is_pinned=True)
        with self.assertRaises(Exception):
            a.full_clean()

    def test_unpublish_at_before_publish_at_rejected(self):
        now = timezone.now()
        a = Announcement(
            title="t", created_by="u",
            publish_at=now, unpublish_at=now - timedelta(days=1),
        )
        with self.assertRaises(Exception):
            a.full_clean()

    def test_valid_announcement_passes_clean(self):
        a = Announcement(title="t", created_by="u")
        a.full_clean()  # 不應該丟例外


class AnnouncementListTest(TestCase):
    def setUp(self):
        self.client = Client()
        Announcement.objects.create(title="泰雅語公告", created_by="u", tribes=["tayal"], status=Announcement.STATUS_DRAFT)
        Announcement.objects.create(title="全族語公告", created_by="u", tribes=[], status=Announcement.STATUS_PUBLISHED)
        Announcement.objects.create(title="阿美語活動", created_by="u", tribes=["amis"], category=Announcement.CATEGORY_ACTIVITY)

    def test_requires_login(self):
        with _as_role(None) as headers:
            headers.pop("HTTP_AUTHORIZATION")  # 完全沒帶 token
            response = self.client.get('/adminapi/announcements/')
        self.assertEqual(response.status_code, 401)

    def test_learner_without_staff_role_rejected(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/announcements/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_analyst_can_list(self):
        # analyst 不能編輯內容，但 STAFF_ROLES 涵蓋它，應該看得到列表。
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/announcements/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 3)

    def test_filter_by_tribe_includes_all_tribes_announcements(self):
        # 篩選「泰雅語」時，適用全部族語（tribes=[]）的公告也要一併出現，
        # 不能只比對陣列裡是否剛好包含 "tayal"。
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/announcements/?tribe=tayal', **headers)
        titles = {item["title"] for item in response.json()["results"]}
        self.assertEqual(titles, {"泰雅語公告", "全族語公告"})

    def test_filter_by_status(self):
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/announcements/?status=published', **headers)
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["title"], "全族語公告")

    def test_filter_by_keyword(self):
        # "activity" 是 category 的英文代碼值（不是顯示用的中文「活動」），
        # 不會出現在任何一筆的 title 裡——確認 keyword 真的只比對 title，
        # 沒有不小心也比對到 category。
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/announcements/?keyword=activity', **headers)
        self.assertEqual(response.json()["count"], 0)

        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/announcements/?keyword=阿美', **headers)
        self.assertEqual(response.json()["count"], 1)


class AnnouncementCreateTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_editor_can_create_draft(self):
        with _as_role(EDITOR) as headers:
            response = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "新公告", "tribes": []},
            )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["status"], Announcement.STATUS_DRAFT)
        self.assertEqual(data["created_by"], "test-uid")

    def test_reviewer_cannot_create(self):
        # reviewer 在權限矩陣裡「僅可留審查意見」，不算能編輯內容本身。
        with _as_role(REVIEWER) as headers:
            response = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "新公告", "tribes": []},
            )
        self.assertEqual(response.status_code, 403)

    def test_pinned_without_pin_until_returns_400(self):
        with _as_role(OWNER) as headers:
            response = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "置頂公告", "tribes": [], "is_pinned": True},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("pin_until", response.json()["errors"])

    def test_invalid_tribe_slug_returns_400(self):
        with _as_role(OWNER) as headers:
            response = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "公告", "tribes": ["klingon"]},
            )
        self.assertEqual(response.status_code, 400)

    def test_create_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            response = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "會被記錄的公告", "tribes": []},
            )
        announcement_id = response.json()["id"]
        log = AuditLog.objects.get(target_type="announcement", target_id=str(announcement_id))
        self.assertEqual(log.action, "create")
        self.assertEqual(log.actor_role, OWNER)
        self.assertIsNone(log.before)
        self.assertEqual(log.after["title"], "會被記錄的公告")


class AnnouncementUpdateDeleteTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_can_edit_draft(self):
        a = Announcement.objects.create(title="草稿", created_by="u")
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, f'/adminapi/announcements/{a.pk}/', headers, {"title": "改過的標題"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "改過的標題")

    def test_cannot_edit_pending_review(self):
        # 送審中不能改，避免審核者看到的內容跟核准當下不是同一份。
        a = Announcement.objects.create(title="待審", created_by="u", status=Announcement.STATUS_PENDING_REVIEW)
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, f'/adminapi/announcements/{a.pk}/', headers, {"title": "偷改"})
        self.assertEqual(response.status_code, 409)
        a.refresh_from_db()
        self.assertEqual(a.title, "待審")

    def test_cannot_edit_published(self):
        a = Announcement.objects.create(title="已發布", created_by="u", status=Announcement.STATUS_PUBLISHED)
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, f'/adminapi/announcements/{a.pk}/', headers, {"title": "偷改"})
        self.assertEqual(response.status_code, 409)

    def test_can_edit_rejected(self):
        a = Announcement.objects.create(title="被退件", created_by="u", status=Announcement.STATUS_REJECTED)
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, f'/adminapi/announcements/{a.pk}/', headers, {"title": "修正後"})
        self.assertEqual(response.status_code, 200)

    def test_editing_unpublished_reverts_to_draft(self):
        # 已下架的內容允許編輯，但視同重新起草：儲存後要退回 draft，強制
        # 走一次完整的送審／核准，不能悄悄改掉一篇曾經核准過的內容卻沒有
        # 任何人重新審過新版本。
        a = Announcement.objects.create(title="已下架", created_by="u", status=Announcement.STATUS_UNPUBLISHED)
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, f'/adminapi/announcements/{a.pk}/', headers, {"title": "改過的下架公告"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["title"], "改過的下架公告")
        self.assertEqual(data["status"], Announcement.STATUS_DRAFT)
        a.refresh_from_db()
        self.assertEqual(a.status, Announcement.STATUS_DRAFT)

    def test_delete_only_allowed_for_draft(self):
        published = Announcement.objects.create(title="已發布", created_by="u", status=Announcement.STATUS_PUBLISHED)
        with _as_role(OWNER) as headers:
            response = self.client.delete(f'/adminapi/announcements/{published.pk}/', **headers)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(Announcement.objects.filter(pk=published.pk).exists())

        draft = Announcement.objects.create(title="草稿", created_by="u")
        with _as_role(OWNER) as headers:
            response = self.client.delete(f'/adminapi/announcements/{draft.pk}/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Announcement.objects.filter(pk=draft.pk).exists())

    def test_editor_cannot_delete(self):
        # 刪除是 PUBLISHERS 專屬，editor 雖然能編輯內容，但不能刪。
        draft = Announcement.objects.create(title="草稿", created_by="u")
        with _as_role(EDITOR) as headers:
            response = self.client.delete(f'/adminapi/announcements/{draft.pk}/', **headers)
        self.assertEqual(response.status_code, 403)


class AnnouncementStateMachineTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_full_happy_path(self):
        # draft -> pending_review -> published -> unpublished -> published
        a = Announcement.objects.create(title="完整流程", created_by="editor-uid", tribes=[])

        with _as_role(EDITOR) as headers:
            r = _post_json(self.client, f'/adminapi/announcements/{a.pk}/submit/', headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], Announcement.STATUS_PENDING_REVIEW)

        with _as_role(OWNER) as headers:
            r = _post_json(self.client, f'/adminapi/announcements/{a.pk}/approve/', headers)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["status"], Announcement.STATUS_PUBLISHED)
        self.assertIsNotNone(data["publish_at"])  # 沒指定排程時間，核准當下自動補上

        with _as_role(ADMIN) as headers:
            r = _post_json(self.client, f'/adminapi/announcements/{a.pk}/unpublish/', headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], Announcement.STATUS_UNPUBLISHED)

        with _as_role(ADMIN) as headers:
            r = _post_json(self.client, f'/adminapi/announcements/{a.pk}/republish/', headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], Announcement.STATUS_PUBLISHED)

    def test_approve_does_not_overwrite_scheduled_publish_at(self):
        future = timezone.now() + timedelta(days=3)
        a = Announcement.objects.create(
            title="排程發布", created_by="u", status=Announcement.STATUS_PENDING_REVIEW, publish_at=future,
        )
        with _as_role(OWNER) as headers:
            r = _post_json(self.client, f'/adminapi/announcements/{a.pk}/approve/', headers)
        a.refresh_from_db()
        self.assertEqual(a.publish_at, future)

    def test_reject_requires_comment(self):
        a = Announcement.objects.create(title="待審", created_by="u", status=Announcement.STATUS_PENDING_REVIEW)
        with _as_role(OWNER) as headers:
            response = _post_json(self.client, f'/adminapi/announcements/{a.pk}/reject/', headers, {})
        self.assertEqual(response.status_code, 400)

        with _as_role(OWNER) as headers:
            response = _post_json(
                self.client, f'/adminapi/announcements/{a.pk}/reject/', headers,
                {"review_comment": "用字需要再確認"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], Announcement.STATUS_REJECTED)

    def test_rejected_can_be_resubmitted_directly(self):
        a = Announcement.objects.create(title="被退件", created_by="u", status=Announcement.STATUS_REJECTED)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, f'/adminapi/announcements/{a.pk}/submit/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], Announcement.STATUS_PENDING_REVIEW)

    def test_editor_cannot_approve(self):
        a = Announcement.objects.create(title="待審", created_by="u", status=Announcement.STATUS_PENDING_REVIEW)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, f'/adminapi/announcements/{a.pk}/approve/', headers)
        self.assertEqual(response.status_code, 403)

    def test_editor_can_withdraw_own_submission(self):
        a = Announcement.objects.create(title="待審", created_by="u", status=Announcement.STATUS_PENDING_REVIEW)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, f'/adminapi/announcements/{a.pk}/withdraw/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], Announcement.STATUS_DRAFT)

    def test_invalid_transition_returns_409_not_500(self):
        # draft 狀態不能直接 approve（要先 submit）。
        a = Announcement.objects.create(title="草稿", created_by="u")
        with _as_role(OWNER) as headers:
            response = _post_json(self.client, f'/adminapi/announcements/{a.pk}/approve/', headers)
        self.assertEqual(response.status_code, 409)

    def test_each_transition_writes_audit_log_with_correct_action(self):
        a = Announcement.objects.create(title="稽核測試", created_by="u")
        with _as_role(EDITOR) as headers:
            _post_json(self.client, f'/adminapi/announcements/{a.pk}/submit/', headers)
        with _as_role(OWNER) as headers:
            _post_json(self.client, f'/adminapi/announcements/{a.pk}/approve/', headers)

        actions = list(
            AuditLog.objects.filter(target_type="announcement", target_id=str(a.pk))
            .order_by("created_at", "pk")
            .values_list("action", flat=True)
        )
        self.assertEqual(actions, ["submit", "approve"])


class AuditLogListTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_owner_can_read(self):
        AuditLog.objects.create(actor_uid="u", action="create", target_type="announcement", target_id="1")
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/audit-log/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_admin_can_read(self):
        with _as_role(ADMIN) as headers:
            response = self.client.get('/adminapi/audit-log/', **headers)
        self.assertEqual(response.status_code, 200)

    def test_editor_cannot_read(self):
        # 稽核紀錄的 before/after 會夾帶其他人送審/編輯過的完整內容快照，
        # 限縮在 ACCOUNT_MANAGERS（owner／admin），比照規劃文件 §1.2 權限矩陣
        # 「系統設定」欄 editor 是 ❌。
        with _as_role(EDITOR) as headers:
            response = self.client.get('/adminapi/audit-log/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_analyst_cannot_read(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/audit-log/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_ordered_newest_first_and_respects_limit(self):
        a = Announcement.objects.create(title="t", created_by="u")
        for action in ("create", "update", "submit"):
            AuditLog.objects.create(actor_uid="u", action=action, target_type="announcement", target_id=str(a.pk))
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/audit-log/?limit=2', **headers)
        results = response.json()["results"]
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["action"], "submit")
        self.assertEqual(results[1]["action"], "update")
