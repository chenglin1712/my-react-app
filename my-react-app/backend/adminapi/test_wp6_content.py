"""稽核 WP-6（批次 C／D）：限流計入 PATCH、樂觀鎖、核准版本比對、題庫軟刪除、情境題選項、
稽核日誌分頁、快取清除先寫稽核、封面圖網址。"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, RequestFactory, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import EDITOR, OWNER, REVIEWER

from ._shared import rate_limited_response
from .models import Announcement, AuditLog, QuizSituationItem, QuizVocabItem


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth({"uid": "test-uid", "role": role})):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _send(method, client, url, headers, payload=None):
    return getattr(client, method)(url, data=json.dumps(payload or {}), content_type="application/json", **headers)


class RateLimitCountsEveryMethodTest(TestCase):
    """BE1-02：以前預設 method="POST"，PATCH／DELETE 端點的限流計數器永遠不累加。"""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_patch_requests_are_counted(self):
        request = RequestFactory().patch("/x/")
        results = [rate_limited_response(request, {"uid": "u"}, group="wp6_patch", rate="3/m") for _ in range(5)]
        self.assertEqual([r is None for r in results], [True, True, True, False, False])

    def test_a_patch_endpoint_returns_429_over_the_limit(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="a", chinese_gloss="b", created_by="u",
        )
        with _as_role(EDITOR) as headers, patch("adminapi._shared.get_configured_rate", return_value="2/m"):
            codes = [
                _send("patch", Client(), f"/adminapi/quiz-bank/vocab/{item.pk}/", headers, {"chinese_gloss": f"g{i}"}).status_code
                for i in range(4)
            ]
        self.assertEqual(codes, [200, 200, 429, 429])


class OptimisticLockTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()

    def test_announcement_patch_with_stale_base_is_409(self):
        announcement = Announcement.objects.create(title="原標題", created_by="u")
        old = announcement.updated_at.isoformat()
        with _as_role(EDITOR) as headers:
            first = _send("patch", self.client, f"/adminapi/announcements/{announcement.pk}/", headers,
                          {"title": "甲改的", "base_updated_at": old})
            second = _send("patch", self.client, f"/adminapi/announcements/{announcement.pk}/", headers,
                           {"title": "乙改的", "base_updated_at": old})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["code"], "edit_conflict")
        announcement.refresh_from_db()
        self.assertEqual(announcement.title, "甲改的")

    def test_announcement_patch_without_base_keeps_old_behaviour(self):
        announcement = Announcement.objects.create(title="原標題", created_by="u")
        with _as_role(EDITOR) as headers:
            response = _send("patch", self.client, f"/adminapi/announcements/{announcement.pk}/", headers, {"title": "新"})
        self.assertEqual(response.status_code, 200)

    def test_approve_refuses_content_edited_after_the_reviewer_loaded_it(self):
        announcement = Announcement.objects.create(
            title="待審", created_by="u", status=Announcement.STATUS_PENDING_REVIEW,
        )
        seen = announcement.updated_at.isoformat()
        # 用明確較晚的時間，避免兩次 auto_now 落在同一個時鐘刻度而不穩
        from datetime import timedelta
        Announcement.objects.filter(pk=announcement.pk).update(
            title="送審後被改過", updated_at=announcement.updated_at + timedelta(seconds=5),
        )
        announcement.refresh_from_db()
        with _as_role(OWNER) as headers:
            stale = _send("post", self.client, f"/adminapi/announcements/{announcement.pk}/approve/", headers,
                          {"base_updated_at": seen})
            fresh = _send("post", self.client, f"/adminapi/announcements/{announcement.pk}/approve/", headers,
                          {"base_updated_at": announcement.updated_at.isoformat()})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(fresh.status_code, 200)

    def test_quizbank_approve_refuses_a_stale_version(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="a", chinese_gloss="b",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="u",
        )
        with _as_role(REVIEWER) as headers:
            response = _send("post", self.client, f"/adminapi/quiz-bank/vocab/{item.pk}/approve/", headers,
                             {"base_updated_at": "2020-01-01T00:00:00+00:00"})
        self.assertEqual(response.status_code, 409)
        item.refresh_from_db()
        self.assertEqual(item.status, QuizVocabItem.STATUS_PENDING_REVIEW)


class QuizBankDeleteTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()

    def _delete(self, item):
        with _as_role(OWNER) as headers:
            return self.client.delete(f"/adminapi/quiz-bank/vocab/{item.pk}/", **headers)

    def test_a_rejected_item_can_now_be_deleted(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="a", chinese_gloss="b",
            status=QuizVocabItem.STATUS_REJECTED, created_by="u",
        )
        self.assertEqual(self._delete(item).status_code, 200)

    def test_a_never_submitted_draft_is_hard_deleted(self):
        item = QuizVocabItem.objects.create(tribe="tayal", category="noun", foreign_word="a", chinese_gloss="b", created_by="u")
        self.assertEqual(self._delete(item).status_code, 200)
        self.assertFalse(QuizVocabItem.all_objects.filter(pk=item.pk).exists())

    def test_an_item_that_was_submitted_before_is_soft_deleted(self):
        from django.utils import timezone
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="a", chinese_gloss="b",
            status=QuizVocabItem.STATUS_REJECTED, created_by="u", submitted_at=timezone.now(),
        )
        self.assertEqual(self._delete(item).status_code, 200)
        self.assertFalse(QuizVocabItem.objects.filter(pk=item.pk).exists())  # 一般查詢看不到
        row = QuizVocabItem.all_objects.get(pk=item.pk)
        self.assertIsNotNone(row.deleted_at)
        self.assertTrue(AuditLog.objects.filter(action="soft_delete", target_id=str(item.pk)).exists())

    def test_published_items_still_cannot_be_deleted(self):
        item = QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="a", chinese_gloss="b",
            status=QuizVocabItem.STATUS_PUBLISHED, created_by="u",
        )
        self.assertEqual(self._delete(item).status_code, 409)


class SituationOptionsTest(TestCase):
    def setUp(self):
        cache.clear()

    def _create(self, options):
        with _as_role(EDITOR) as headers:
            return _send("post", Client(), "/adminapi/quiz-bank/situations/", headers, {
                "tribe": "tayal", "scenario_chinese": "情境", "options": options, "answer": 1,
            })

    @staticmethod
    def _good():
        return [{"foreign": f"f{i}", "chinese": f"c{i}"} for i in range(4)]

    def test_valid_options_are_accepted(self):
        self.assertEqual(self._create(self._good()).status_code, 201)

    def test_malformed_options_are_rejected(self):
        bad_cases = {
            "not dicts": ["a", "b", "c", "d"],
            "empty foreign": [{"foreign": "", "chinese": "x"}] + self._good()[1:],
            "missing chinese": [{"foreign": "x"}] + self._good()[1:],
            "non-string": [{"foreign": 1, "chinese": "x"}] + self._good()[1:],
            "too long": [{"foreign": "x" * 201, "chinese": "x"}] + self._good()[1:],
            "duplicate foreign": [{"foreign": "same", "chinese": "a"}, {"foreign": "Same ", "chinese": "b"}] + self._good()[2:],
        }
        for label, options in bad_cases.items():
            with self.subTest(label):
                self.assertEqual(self._create(options).status_code, 400)

    def test_model_clean_rejects_the_same_cases(self):
        from django.core.exceptions import ValidationError
        item = QuizSituationItem(tribe="tayal", scenario_chinese="x", options=["a", "b", "c", "d"], answer=1, created_by="u")
        with self.assertRaises(ValidationError):
            item.clean()

    def test_list_prefetches_ai_drafts_in_one_query(self):
        from .models import AiQuizDraft
        for index in range(5):
            item = QuizSituationItem.objects.create(
                tribe="tayal", scenario_chinese=f"s{index}", options=self._good(), answer=1, created_by="u",
            )
            AiQuizDraft.objects.create(
                content_type="quiz_situation_item", content_id=item.pk, generated_by="u", model="m",
                source_words=[], source_word_ids=[], unverified_words=[],
            )
        with _as_role(OWNER) as headers:
            from django.db import connection
            from django.test.utils import CaptureQueriesContext
            with CaptureQueriesContext(connection) as queries:
                response = Client().get("/adminapi/quiz-bank/situations/", **headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all(row["ai_draft"] for row in response.json()["results"]))
        draft_queries = [q for q in queries.captured_queries if "adminapi_aiquizdraft" in q["sql"]]
        self.assertLessEqual(len(draft_queries), 2)


class AuditLogListTest(TestCase):
    def setUp(self):
        cache.clear()
        # WP-8 追加：清單會批次查操作者姓名（Firestore），測試不連真的 Firebase
        names_patcher = patch("adminapi.user_names._fetch_names", side_effect=lambda uids: {uid: "" for uid in uids})
        self.addCleanup(names_patcher.stop)
        names_patcher.start()
        for index in range(25):
            AuditLog.objects.create(
                actor_uid="alice" if index % 2 else "bob", actor_role="owner",
                action="update" if index % 3 else "delete", target_type="announcement", target_id=str(index),
            )

    def _get(self, query=""):
        with _as_role(OWNER) as headers:
            return Client().get(f"/adminapi/audit-log/{query}", **headers)

    def test_paginates_and_reports_the_total(self):
        data = self._get("?page=2&page_size=10").json()
        self.assertEqual(data["count"], 25)
        self.assertEqual(len(data["results"]), 10)
        self.assertEqual(data["page"], 2)

    def test_filters_by_actor_action_and_target(self):
        self.assertEqual(self._get("?actor_uid=alice").json()["count"], 12)
        self.assertEqual(self._get("?action=delete").json()["count"], 9)
        self.assertEqual(self._get("?target_type=announcement&target_id=7").json()["count"], 1)

    def test_date_range_and_bad_date(self):
        self.assertEqual(self._get("?date_from=2999-01-01").json()["count"], 0)
        self.assertEqual(self._get("?date_to=2999-01-01").json()["count"], 25)
        self.assertEqual(self._get("?date_from=not-a-date").status_code, 400)


class SystemCacheAuditFirstTest(TestCase):
    def setUp(self):
        cache.clear()

    def test_clear_does_nothing_when_the_audit_log_is_down(self):
        with patch("adminapi._shared.write_audit_log", side_effect=Exception("db down")), \
             patch("adminapi.system_cache_views.clear_django_caches") as clear, \
             _as_role(OWNER) as headers:
            response = _send("post", Client(), "/adminapi/system/cache/clear-django/", headers)
        self.assertEqual(response.status_code, 503)
        clear.assert_not_called()

    def test_fastapi_failure_message_does_not_leak_internals(self):
        with patch("adminapi.system_cache_views.clear_fastapi_caches", return_value=(False, "呼叫 FastAPI 失敗")), \
             _as_role(OWNER) as headers:
            response = _send("post", Client(), "/adminapi/system/cache/clear-fastapi/", headers)
        self.assertEqual(response.status_code, 502)
        self.assertTrue(AuditLog.objects.filter(action="clear_fastapi_cache_failed").exists())


class CoverImageUrlTest(TestCase):
    def setUp(self):
        cache.clear()

    def test_admin_created_cover_must_be_cloudinary(self):
        with _as_role(EDITOR) as headers:
            bad = _send("post", Client(), "/adminapi/announcements/", headers,
                        {"title": "t", "body": "b", "cover_image_url": "https://evil.example.com/a.png"})
        self.assertEqual(bad.status_code, 400)

    def test_unchanged_external_cover_from_the_crawler_can_still_be_saved(self):
        announcement = Announcement.objects.create(
            title="爬蟲", created_by="crawler", cover_image_url="https://example.org/cover.png",
        )
        with _as_role(EDITOR) as headers:
            response = _send("patch", Client(), f"/adminapi/announcements/{announcement.pk}/", headers,
                             {"title": "改標題", "cover_image_url": "https://example.org/cover.png"})
        self.assertEqual(response.status_code, 200)
