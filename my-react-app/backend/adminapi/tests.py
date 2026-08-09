import json
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import requests
from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from datetime import datetime, timedelta

from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

from .models import (
    Announcement, AnnouncementSyncStatus, AuditLog, ExamScheduleCrawlStatus, ExamScheduleOverride,
)


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


def _put_json(client, url, headers, payload):
    return client.put(
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


class PublicAnnouncementListTest(TestCase):
    """首頁用的公開端點——見 views.py 的 public_announcement_list。不需要
    登入，這裡完全不透過 _as_role，直接用沒帶 Authorization header 的
    client 打，確保真的是匿名可讀。"""

    def setUp(self):
        self.client = Client()

    def test_anonymous_can_read_without_auth_header(self):
        Announcement.objects.create(title="公開公告", created_by="u", status=Announcement.STATUS_PUBLISHED)
        response = self.client.get('/adminapi/public/announcements/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_only_published_status_included(self):
        Announcement.objects.create(title="草稿", created_by="u", status=Announcement.STATUS_DRAFT)
        Announcement.objects.create(title="待審", created_by="u", status=Announcement.STATUS_PENDING_REVIEW)
        Announcement.objects.create(title="已下架", created_by="u", status=Announcement.STATUS_UNPUBLISHED)
        Announcement.objects.create(title="已發布", created_by="u", status=Announcement.STATUS_PUBLISHED)
        response = self.client.get('/adminapi/public/announcements/')
        titles = [item["title"] for item in response.json()["results"]]
        self.assertEqual(titles, ["已發布"])

    def test_future_publish_at_excluded(self):
        future = timezone.now() + timedelta(days=3)
        Announcement.objects.create(
            title="排程未到", created_by="u", status=Announcement.STATUS_PUBLISHED, publish_at=future,
        )
        response = self.client.get('/adminapi/public/announcements/')
        self.assertEqual(response.json()["results"], [])

    def test_past_unpublish_at_excluded(self):
        past = timezone.now() - timedelta(days=1)
        Announcement.objects.create(
            title="已過下架時間", created_by="u", status=Announcement.STATUS_PUBLISHED, unpublish_at=past,
        )
        response = self.client.get('/adminapi/public/announcements/')
        self.assertEqual(response.json()["results"], [])

    def test_published_within_window_included(self):
        past = timezone.now() - timedelta(days=1)
        future = timezone.now() + timedelta(days=1)
        Announcement.objects.create(
            title="生效中", created_by="u", status=Announcement.STATUS_PUBLISHED,
            publish_at=past, unpublish_at=future,
        )
        response = self.client.get('/adminapi/public/announcements/')
        self.assertEqual(len(response.json()["results"]), 1)

    def test_internal_fields_not_exposed(self):
        Announcement.objects.create(
            title="公告", created_by="internal-uid", status=Announcement.STATUS_PUBLISHED,
            reviewed_by="reviewer-uid", review_comment="內部審查意見",
        )
        item = self.client.get('/adminapi/public/announcements/').json()["results"][0]
        self.assertNotIn("created_by", item)
        self.assertNotIn("reviewed_by", item)
        self.assertNotIn("review_comment", item)
        self.assertNotIn("status", item)


FAKE_EXAM_SCHEDULE_HTML = """
<html><body>
<ul class="nav nav-tabs">
  <li><button class="nav-link active" id="news-tab">最新消息</button></li>
  <li><button class="nav-link" id="0-tab">115年度第1次原住民族語言能力認證測驗日程表</button></li>
</ul>
<div class="tab-pane" id="news-pane"></div>
<div class="tab-pane" id="0-pane">
  <table><tbody>
    <tr>
      <td><span class="fw-bold">報名日期</span></td>
      <td><a href="https://www.google.com/calendar/event?action=TEMPLATE&text=x&dates=20260121T100000/20260226T235900">x</a></td>
    </tr>
  </tbody></table>
</div>
</body></html>
"""


class ExamScheduleAdminTest(TestCase):
    """後台的考試時程比對／覆寫端點（見 views.py 的 exam_schedule_admin
    與 exam_schedule_override_detail）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    def _mock_scrape_ok(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

    def test_learner_without_staff_role_cannot_view_overview(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/exam-schedule/', **headers)
        self.assertEqual(response.status_code, 403)

    @patch('crawler.views.requests.get')
    def test_analyst_can_view_overview(self, mock_get):
        # 只是查詢比對，STAFF_ROLES 都能看，跟公告列表的角色門檻一致。
        self._mock_scrape_ok(mock_get)
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/exam-schedule/', **headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["crawled"]["available"])
        self.assertEqual(len(data["crawled"]["phases"]), 1)

    @patch('crawler.views.requests.get')
    def test_overview_includes_effective_phases_with_override_applied(self, mock_get):
        self._mock_scrape_ok(mock_get)
        ExamScheduleOverride.objects.create(phase='報名', start_date='2026-02-01')
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/exam-schedule/', **headers)
        effective = {p["phase"]: p for p in response.json()["effective_phases"]}
        self.assertEqual(effective['報名']['start_date'], '2026-02-01')
        # crawled 那組維持爬蟲原始值，不該被覆寫污染——左右兩欄才能真的拿來比對。
        crawled = {p["phase"]: p for p in response.json()["crawled"]["phases"]}
        self.assertEqual(crawled['報名']['start_date'], '2026-01-21')

    @patch('crawler.views.requests.get')
    def test_analyst_cannot_trigger_refresh(self, mock_get):
        self._mock_scrape_ok(mock_get)
        with _as_role(ANALYST) as headers:
            response = _post_json(self.client, '/adminapi/exam-schedule/', headers)
        self.assertEqual(response.status_code, 403)

    @patch('crawler.views.requests.get')
    def test_editor_can_trigger_refresh_and_it_writes_audit_log(self, mock_get):
        self._mock_scrape_ok(mock_get)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/exam-schedule/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["crawled"]["available"])
        log = AuditLog.objects.filter(target_type="exam_schedule", action="refresh").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.actor_role, EDITOR)

    @patch('crawler.views.requests.get')
    def test_refresh_bypasses_cache(self, mock_get):
        self._mock_scrape_ok(mock_get)
        with _as_role(OWNER) as headers:
            _post_json(self.client, '/adminapi/exam-schedule/', headers)
            _post_json(self.client, '/adminapi/exam-schedule/', headers)
        self.assertEqual(mock_get.call_count, 2)  # 兩次都真的重爬，不是吃快取


class ExamScheduleOverrideWriteTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_editor_can_create_override(self):
        with _as_role(EDITOR) as headers:
            response = _put_json(
                self.client, '/adminapi/exam-schedule/overrides/報名/', headers,
                {"start_date": "2026-02-01", "end_date": "2026-03-01"},
            )
        self.assertEqual(response.status_code, 200)
        override = ExamScheduleOverride.objects.get(phase='報名')
        self.assertEqual(str(override.start_date), '2026-02-01')
        self.assertEqual(override.updated_by, 'test-uid')

    def test_reviewer_cannot_create_override(self):
        with _as_role(REVIEWER) as headers:
            response = _put_json(
                self.client, '/adminapi/exam-schedule/overrides/報名/', headers,
                {"start_date": "2026-02-01"},
            )
        self.assertEqual(response.status_code, 403)

    def test_end_date_before_start_date_returns_400(self):
        with _as_role(OWNER) as headers:
            response = _put_json(
                self.client, '/adminapi/exam-schedule/overrides/報名/', headers,
                {"start_date": "2026-03-01", "end_date": "2026-02-01"},
            )
        self.assertEqual(response.status_code, 400)

    def test_put_again_updates_existing_override_not_duplicate(self):
        with _as_role(OWNER) as headers:
            _put_json(self.client, '/adminapi/exam-schedule/overrides/報名/', headers, {"start_date": "2026-02-01"})
            _put_json(self.client, '/adminapi/exam-schedule/overrides/報名/', headers, {"start_date": "2026-02-15"})
        self.assertEqual(ExamScheduleOverride.objects.filter(phase='報名').count(), 1)
        self.assertEqual(str(ExamScheduleOverride.objects.get(phase='報名').start_date), '2026-02-15')

    def test_delete_removes_override(self):
        ExamScheduleOverride.objects.create(phase='報名', start_date='2026-02-01')
        with _as_role(OWNER) as headers:
            response = self.client.delete('/adminapi/exam-schedule/overrides/報名/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ExamScheduleOverride.objects.filter(phase='報名').exists())

    def test_delete_nonexistent_returns_404(self):
        with _as_role(OWNER) as headers:
            response = self.client.delete('/adminapi/exam-schedule/overrides/不存在/', **headers)
        self.assertEqual(response.status_code, 404)

    def test_write_actions_write_audit_log_with_correct_target_type(self):
        with _as_role(OWNER) as headers:
            _put_json(self.client, '/adminapi/exam-schedule/overrides/報名/', headers, {"start_date": "2026-02-01"})
        log = AuditLog.objects.filter(target_type="exam_schedule_override", action="upsert").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.target_id, '報名')


class HomepageConfigAdminTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_default_values_before_any_write(self):
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/homepage-config/', **headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["hero_image_url"], "")
        self.assertTrue(data["show_news_section"])
        self.assertEqual(data["news_display_count"], 6)

    def test_analyst_can_read(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/homepage-config/', **headers)
        self.assertEqual(response.status_code, 200)

    def test_editor_cannot_write(self):
        # 首頁設定視同發布動作，跟公告的核准/發布同一層級，只有 PUBLISHERS。
        with _as_role(EDITOR) as headers:
            response = _patch_json(self.client, '/adminapi/homepage-config/', headers, {"show_news_section": False})
        self.assertEqual(response.status_code, 403)

    def test_owner_can_update_and_it_persists(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"show_news_section": False, "news_display_count": 10},
            )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["show_news_section"])
        self.assertEqual(data["news_display_count"], 10)
        self.assertEqual(data["updated_by"], "test-uid")

        with _as_role(OWNER) as headers:
            response2 = self.client.get('/adminapi/homepage-config/', **headers)
        self.assertEqual(response2.json()["news_display_count"], 10)

    def test_hero_link_rejects_javascript_scheme(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"hero_link_url": "javascript:alert(1)"},
            )
        self.assertEqual(response.status_code, 400)

    def test_hero_link_rejects_protocol_relative_url(self):
        # 跟登入頁 next 參數同樣的開放重導向防護理由：// 開頭會被瀏覽器當成
        # 外部網址，不是這個網站自己的相對路徑。
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"hero_link_url": "//evil.com"},
            )
        self.assertEqual(response.status_code, 400)

    def test_hero_link_rejects_backslash_protocol_relative_bypass(self):
        """獨立審查找到的問題：瀏覽器的 WHATWG URL 解析對 http(s) 這類
        special scheme 會把反斜線視同斜線，"/\\evil.com" 這種字串用純字串
        比對看起來是合法的單一 / 開頭內部路徑，瀏覽器卻可能解讀成
        protocol-relative 的外部網址——跟 "//evil.com" 是同一類漏洞，只是
        換了一種字元繞過純字串檢查。"""
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"hero_link_url": "/\\evil.com"},
            )
        self.assertEqual(response.status_code, 400)

        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"hero_link_url": "\\\\evil.com"},
            )
        self.assertEqual(response.status_code, 400)

    def test_hero_link_accepts_internal_path(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"hero_link_url": "/quiz/select"},
            )
        self.assertEqual(response.status_code, 200)

    def test_hero_link_accepts_external_https_url(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, '/adminapi/homepage-config/', headers,
                {"hero_link_url": "https://example.com"},
            )
        self.assertEqual(response.status_code, 200)

    def test_news_display_count_out_of_range_rejected(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(self.client, '/adminapi/homepage-config/', headers, {"news_display_count": 999})
        self.assertEqual(response.status_code, 400)

    def test_update_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, '/adminapi/homepage-config/', headers, {"show_news_section": False})
        log = AuditLog.objects.filter(target_type="homepage_config", action="update").first()
        self.assertIsNotNone(log)


class PublicHomepageConfigTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_anonymous_can_read_without_auth_header(self):
        response = self.client.get('/adminapi/public/homepage-config/')
        self.assertEqual(response.status_code, 200)

    def test_internal_fields_not_exposed(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, '/adminapi/homepage-config/', headers, {"show_news_section": False})
        data = self.client.get('/adminapi/public/homepage-config/').json()
        self.assertNotIn("updated_by", data)
        self.assertNotIn("updated_at", data)
        self.assertFalse(data["show_news_section"])


class AnnouncementCrawlerSyncTest(TestCase):
    """把爬蟲抓到的活動/考試消息同步成後台公告（見 adminapi/crawler_sync.py
    與 views.py 的 announcement_sync_crawler）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    def _mock_one_tacp_item(self, mock_get, item_id=1, title="測試活動", end_date=None):
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": [{
                    "id": item_id, "category_id": 1, "title": title,
                    "start_date": "2026-08-01T00:00:00+08:00",
                    "end_date": end_date, "images": [],
                    "category": {"title": "最新消息"},
                }]}
            else:
                resp.text = "<html></html>"  # 族語認證來源這裡不需要
            return resp
        mock_get.side_effect = fake_get

    def test_analyst_cannot_trigger_sync(self):
        with _as_role(ANALYST) as headers:
            response = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
        self.assertEqual(response.status_code, 403)

    @patch('crawler.views.requests.get')
    def test_editor_can_trigger_sync(self, mock_get):
        self._mock_one_tacp_item(mock_get)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["imported"], 1)

    @patch('crawler.views.requests.get')
    def test_get_returns_status_without_triggering_a_crawl(self, mock_get):
        with _as_role(OWNER) as headers:
            response = self.client.get('/adminapi/announcements/sync-crawler/', **headers)
        self.assertEqual(response.status_code, 200)
        mock_get.assert_not_called()

    @patch('crawler.views.requests.get')
    def test_imported_row_is_published_and_tagged_as_crawler_source(self, mock_get):
        self._mock_one_tacp_item(mock_get, item_id=42, title="泰雅文化節")
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        announcement = Announcement.objects.get(external_id="tacp:42")
        self.assertEqual(announcement.status, Announcement.STATUS_PUBLISHED)
        self.assertEqual(announcement.source, Announcement.SOURCE_CRAWLER)
        self.assertEqual(announcement.category, Announcement.CATEGORY_ACTIVITY)
        self.assertEqual(announcement.title, "泰雅文化節")

    @patch('crawler.views.requests.get')
    def test_running_twice_does_not_duplicate(self, mock_get):
        self._mock_one_tacp_item(mock_get, item_id=7)
        with _as_role(EDITOR) as headers:
            first = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
            second = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        self.assertEqual(first.json()["imported"], 1)
        self.assertEqual(second.json()["imported"], 0)
        self.assertEqual(second.json()["skipped_existing"], 1)
        self.assertEqual(Announcement.objects.filter(external_id="tacp:7").count(), 1)

    @patch('crawler.views.requests.get')
    def test_overlong_title_is_truncated_not_rejected(self, mock_get):
        long_title = "很長的標題" * 30  # 遠超過 title 的 100 字上限
        self._mock_one_tacp_item(mock_get, item_id=8, title=long_title)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["imported"], 1)
        announcement = Announcement.objects.get(external_id="tacp:8")
        self.assertLessEqual(len(announcement.title), 100)
        self.assertTrue(announcement.title.endswith("…"))

    @patch('crawler.views.requests.get')
    def test_missing_image_does_not_raise(self, mock_get):
        # tacp 沒有圖片的項目 image 是 None，不能讓 NOT NULL 欄位炸掉。
        self._mock_one_tacp_item(mock_get, item_id=9)
        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["imported"], 1)
        self.assertEqual(Announcement.objects.get(external_id="tacp:9").cover_image_url, "")

    @patch('crawler.views.requests.get')
    def test_unpublished_imported_row_is_not_resurrected_by_resync(self, mock_get):
        # 下架一筆爬蟲匯入的項目之後，重新同步不應該讓它復活——因為同步只
        # 做「這個 external_id 存在嗎」的判斷，不會覆蓋既有資料，這正是
        # 「下架＝永久不再顯示這則」這個附帶好處的來源。
        self._mock_one_tacp_item(mock_get, item_id=10)
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        announcement = Announcement.objects.get(external_id="tacp:10")
        with _as_role(OWNER) as headers:
            unpublish_resp = _post_json(
                self.client, f'/adminapi/announcements/{announcement.pk}/unpublish/', headers,
            )
        self.assertEqual(unpublish_resp.status_code, 200)

        with _as_role(EDITOR) as headers:
            second = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
        self.assertEqual(second.json()["imported"], 0)
        self.assertEqual(second.json()["skipped_existing"], 1)
        announcement.refresh_from_db()
        self.assertEqual(announcement.status, Announcement.STATUS_UNPUBLISHED)

    @patch('crawler.views.requests.get')
    def test_sync_writes_audit_log_with_correct_target_type(self, mock_get):
        self._mock_one_tacp_item(mock_get, item_id=11)
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        log = AuditLog.objects.filter(target_type="announcement_crawler_sync", action="sync").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.target_id, str(AnnouncementSyncStatus.load().pk))

    @patch('crawler.views.requests.get')
    def test_public_list_orders_admin_content_before_crawler_content(self, mock_get):
        self._mock_one_tacp_item(mock_get, item_id=12)
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
            create_resp = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "後台自建公告", "body": "x"},
            )
        admin_pk = create_resp.json()["id"]
        with _as_role(OWNER) as headers:
            _post_json(self.client, f'/adminapi/announcements/{admin_pk}/submit/', headers)
            _post_json(self.client, f'/adminapi/announcements/{admin_pk}/approve/', headers)

        response = self.client.get('/adminapi/public/announcements/')
        titles = [item["title"] for item in response.json()["results"]]
        self.assertEqual(titles[0], "後台自建公告")  # 即使爬蟲那筆先建立、created_at 更早

    @patch('crawler.views.requests.get')
    def test_source_filter_in_admin_list(self, mock_get):
        self._mock_one_tacp_item(mock_get, item_id=13)
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
            _post_json(self.client, '/adminapi/announcements/', headers, {"title": "自建", "body": "x"})

            crawler_only = self.client.get('/adminapi/announcements/?source=crawler', **headers)
            admin_only = self.client.get('/adminapi/announcements/?source=admin', **headers)

        self.assertEqual(crawler_only.json()["count"], 1)
        self.assertEqual(admin_only.json()["count"], 1)

    @patch('crawler.views.requests.get')
    def test_admin_list_orders_admin_content_before_crawler_content(self, mock_get):
        """獨立審查找到的問題：後台列表（_list_announcements）原本完全沒有
        套用「自建優先」排序，只用 model 預設的 -is_pinned/-created_at/-pk
        ——近期整批匯入的爬蟲資料會排在較舊的自建公告前面。這裡驗證後台
        列表本身（不是公開列表）的排序也正確。"""
        self._mock_one_tacp_item(mock_get, item_id=30)
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
            _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "後台自建公告", "body": "x"},
            )
            listing = self.client.get('/adminapi/announcements/', **headers)
        titles = [item["title"] for item in listing.json()["results"]]
        self.assertEqual(titles[0], "後台自建公告")

    @patch('crawler.views.requests.get')
    def test_pinned_crawler_item_does_not_outrank_unpinned_admin_item(self, mock_get):
        """獨立審查找到的問題：原本 -is_pinned 是第一排序鍵，一筆被人工
        設成置頂的爬蟲公告會排到未置頂的自建公告前面，違反「自建一律
        優先」的既定規則。"""
        self._mock_one_tacp_item(mock_get, item_id=31)
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
            create_resp = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "後台自建公告", "body": "x"},
            )
        admin_pk = create_resp.json()["id"]
        with _as_role(OWNER) as headers:
            _post_json(self.client, f'/adminapi/announcements/{admin_pk}/submit/', headers)
            _post_json(self.client, f'/adminapi/announcements/{admin_pk}/approve/', headers)

        crawler_announcement = Announcement.objects.get(external_id="tacp:31")
        crawler_announcement.is_pinned = True
        crawler_announcement.pin_until = timezone.localdate() + timedelta(days=7)
        crawler_announcement.save(update_fields=["is_pinned", "pin_until"])

        response = self.client.get('/adminapi/public/announcements/')
        titles = [item["title"] for item in response.json()["results"]]
        self.assertEqual(titles[0], "後台自建公告")

    @patch('crawler.views.requests.get')
    def test_expired_pin_until_no_longer_sorts_as_pinned(self, mock_get):
        """獨立審查找到的問題：原本排序只看 is_pinned 欄位，不檢查
        pin_until 是否已過期，導致 pin_until 這個「避免永久置頂被遺忘」
        的設計形同虛設。這裡驗證過期的置頂公告不會再排到未過期、未置頂
        但比較新的公告前面。"""
        self._mock_one_tacp_item(mock_get, item_id=32, title="過期置頂活動")
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        expired = Announcement.objects.get(external_id="tacp:32")
        expired.is_pinned = True
        expired.pin_until = timezone.localdate() - timedelta(days=1)  # 已過期
        expired.save(update_fields=["is_pinned", "pin_until"])

        with _as_role(EDITOR) as headers:
            create_resp = _post_json(
                self.client, '/adminapi/announcements/', headers,
                {"title": "較新的一般公告", "body": "x"},
            )
        newer_pk = create_resp.json()["id"]
        with _as_role(OWNER) as headers:
            _post_json(self.client, f'/adminapi/announcements/{newer_pk}/submit/', headers)
            _post_json(self.client, f'/adminapi/announcements/{newer_pk}/approve/', headers)

        response = self.client.get('/adminapi/public/announcements/')
        titles = [item["title"] for item in response.json()["results"]]
        # 兩者都不是自建優先的比較對象（一個爬蟲、一個自建），這裡驗證的
        # 是自建的「較新的一般公告」排在過期置頂的爬蟲活動前面——如果
        # pin_until 過期判斷沒生效，過期置頂的爬蟲活動會因為 is_pinned=True
        # 排到自建內容前面，違反「自建一律優先」。
        self.assertEqual(titles[0], "較新的一般公告")

    @patch('crawler.views.requests.get')
    def test_pure_date_end_date_stays_visible_through_that_whole_day(self, mock_get):
        """獨立審查找到的問題：純日期字串（沒有時間部分）的 end_date 原本
        被解析成當天 00:00——如果同步發生在結束日當天的白天，unpublish_at
        會因為已經是過去而被設成 None，永遠不會自動下架。這裡驗證
        end_date 是「今天」時，同步後 unpublish_at 不是 None，而是明天
        00:00（正確涵蓋今天整天），且此時公開列表仍然看得到。"""
        today = timezone.localdate()
        self._mock_one_tacp_item(mock_get, item_id=33, end_date=today.isoformat())
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        announcement = Announcement.objects.get(external_id="tacp:33")
        self.assertIsNotNone(announcement.unpublish_at)
        self.assertGreater(announcement.unpublish_at, timezone.now())
        expected_next_day = timezone.make_aware(
            datetime.combine(today + timedelta(days=1), datetime.min.time()),
        )
        self.assertEqual(announcement.unpublish_at, expected_next_day)

        public_resp = self.client.get('/adminapi/public/announcements/')
        titles = [item["title"] for item in public_resp.json()["results"]]
        self.assertIn("測試活動", titles)

    @patch('crawler.views.requests.get')
    def test_future_pure_date_end_date_unpublishes_at_start_of_following_day(self, mock_get):
        """end_date 是未來日期時，unpublish_at 應該是「隔天 00:00」，讓
        公告顯示到結束日當天結束，不是結束日一早就消失。"""
        future_date = timezone.localdate() + timedelta(days=5)
        self._mock_one_tacp_item(mock_get, item_id=34, end_date=future_date.isoformat())
        with _as_role(EDITOR) as headers:
            _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)

        announcement = Announcement.objects.get(external_id="tacp:34")
        expected_next_day = timezone.make_aware(
            datetime.combine(future_date + timedelta(days=1), datetime.min.time()),
        )
        self.assertEqual(announcement.unpublish_at, expected_next_day)

    @patch('crawler.views.requests.get')
    def test_tacp_non_200_response_not_treated_as_success(self, mock_get):
        """獨立審查找到的問題：原本 tacp_ok = True 寫在 if status_code==200
        區塊外面，TACP 回傳 500/403 等非 200 時不會進到解析區塊、完全沒有
        新增資料，但 tacp_ok 仍然被誤判成 True。這裡驗證 TACP 回傳 500
        時，如果族語認證來源也失敗，整個同步要回報「無法取得資料」，不能
        誤報成功。"""
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            if "tacp.gov.tw" in url:
                resp.status_code = 500
                resp.raise_for_status.side_effect = requests.HTTPError("500 error")
            else:
                resp.status_code = 500
                resp.raise_for_status.side_effect = requests.HTTPError("500 error")
                resp.text = ""
            return resp
        mock_get.side_effect = fake_get

        with _as_role(EDITOR) as headers:
            response = _post_json(self.client, '/adminapi/announcements/sync-crawler/', headers)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["available"])
        self.assertEqual(response.json()["imported"], 0)
