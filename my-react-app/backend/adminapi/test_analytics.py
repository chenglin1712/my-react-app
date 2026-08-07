"""P5 數據分析：P5.0 使用事件記錄端點 + P5.1 儀表板聚合端點 + P5.2 搜尋分析端點
+ P5.3 題目品質分析端點。

跟其他 adminapi 測試不同的地方：POST /adminapi/public/events/ 是唯一刻意
允許匿名（未登入）呼叫的寫入端點——測試要涵蓋「完全沒帶 token」「帶了
有效 token 但沒有後台角色（一般學習者）」兩種情境，不是只測 STAFF_ROLES。
"""
import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from config.roles import ANALYST, EDITOR

from .models import (
    QuizChoiceItem, QuizClozePassage, QuizSituationItem, QuizTrueFalseItem, QuizVocabItem, UsageEvent,
)


@contextmanager
def _with_uid(uid):
    """模擬一個帶有效 Firebase token、但不一定有後台角色的一般使用者
    （跟其他測試檔的 _as_role 不同：那些一律帶 role，這裡刻意不帶，
    因為 try_verify_firebase_token 不檢查角色，只要 token 有效就回傳 uid）。
    """
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value={"uid": uid}):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("config.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _fake_user_record(uid, created):
    return SimpleNamespace(
        uid=uid,
        user_metadata=SimpleNamespace(creation_timestamp=created, last_sign_in_timestamp=created),
    )


def _fake_snapshot(doc_id, data):
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = data is not None
    snap.to_dict.return_value = data
    return snap


def _post_json(client, url, payload=None, headers=None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json", **(headers or {}))


class UsageEventCreateTest(TestCase):
    def setUp(self):
        cache.clear()  # 避免不同測試方法之間互相撞到限流。
        self.client = Client()

    def test_anonymous_request_succeeds_with_empty_uid(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {
                "event_type": "page_view", "tribe": "tayal", "payload": {"path": "/dictionary"},
            })
        self.assertEqual(resp.status_code, 201)
        event = UsageEvent.objects.get()
        self.assertEqual(event.event_type, "page_view")
        self.assertEqual(event.uid, "")
        self.assertEqual(event.tribe, "tayal")
        self.assertEqual(event.payload, {"path": "/dictionary"})

    def test_logged_in_user_without_staff_role_still_records_uid(self):
        """一般學習者（沒有後台角色）也要能回報事件——分析對象本來就是
        一般使用者，不是後台工作人員。"""
        with _with_uid("learner-uid-1") as headers:
            resp = _post_json(self.client, '/adminapi/public/events/', {"event_type": "quiz_session"}, headers)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(UsageEvent.objects.get().uid, "learner-uid-1")

    def test_missing_payload_and_tribe_default_to_empty(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {"event_type": "page_view"})
        self.assertEqual(resp.status_code, 201)
        event = UsageEvent.objects.get()
        self.assertEqual(event.tribe, "")
        self.assertEqual(event.payload, {})

    def test_unknown_event_type_rejected(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {"event_type": "something_made_up"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(UsageEvent.objects.count(), 0)

    def test_unknown_tribe_rejected(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {
                "event_type": "page_view", "tribe": "not-a-real-tribe",
            })
        self.assertEqual(resp.status_code, 400)

    def test_non_dict_payload_rejected(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {
                "event_type": "page_view", "payload": ["not", "a", "dict"],
            })
        self.assertEqual(resp.status_code, 400)

    def test_oversized_payload_rejected(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {
                "event_type": "page_view", "payload": {"blob": "x" * 5000},
            })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(UsageEvent.objects.count(), 0)

    def test_malformed_json_body_rejected(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = self.client.post(
                '/adminapi/public/events/', data="not json", content_type="application/json",
            )
        self.assertEqual(resp.status_code, 400)

    def test_get_method_not_allowed(self):
        resp = self.client.get('/adminapi/public/events/')
        self.assertEqual(resp.status_code, 405)

    def test_rate_limited_after_threshold(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            for _ in range(120):
                _post_json(self.client, '/adminapi/public/events/', {"event_type": "page_view"})
            resp = _post_json(self.client, '/adminapi/public/events/', {"event_type": "page_view"})
        self.assertEqual(resp.status_code, 429)


def _make_event(event_type, days_ago, uid="", tribe="", payload=None):
    """建一筆 UsageEvent，created_at 覆寫成指定的「幾天前」——auto_now_add
    在一般 save() 時會覆蓋任何指定值，改用 queryset.update()（直接下 SQL
    UPDATE，繞過 model 層的 auto_now_add 邏輯）才能測試日期分組正確性。"""
    event = UsageEvent.objects.create(event_type=event_type, uid=uid, tribe=tribe, payload=payload or {})
    target = timezone.now() - timedelta(days=days_ago)
    UsageEvent.objects.filter(pk=event.pk).update(created_at=target)
    return event


class DashboardAnalyticsTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _get(self, query="", headers=None):
        url = f'/adminapi/analytics/dashboard/{query}'
        return self.client.get(url, **(headers or {}))

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_requires_staff_role(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(None) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_analyst_can_view(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(ANALYST) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 200)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_default_range_is_7_days(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(EDITOR) as headers:
            resp = self._get(headers=headers)
        data = resp.json()
        self.assertEqual(len(data["daily_active_users"]), 7)
        self.assertEqual(len(data["daily_new_registrations"]), 7)

    def test_invalid_date_range_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=999y', headers)
        self.assertEqual(resp.status_code, 400)

    def test_custom_range_requires_valid_dates(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=custom&date_from=not-a-date&date_to=2026-08-01', headers)
        self.assertEqual(resp.status_code, 400)

    def test_custom_range_end_before_start_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=custom&date_from=2026-08-10&date_to=2026-08-01', headers)
        self.assertEqual(resp.status_code, 400)

    def test_unknown_tribe_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?tribe=not-a-real-tribe', headers)
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_daily_active_users_counts_distinct_uid_and_fills_gaps(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        # 今天：uid1／uid2 各一筆 -> DAU=2；同一個 uid 兩筆事件只算一次。
        _make_event("page_view", days_ago=0, uid="uid1")
        _make_event("quiz_session", days_ago=0, uid="uid1")
        _make_event("page_view", days_ago=0, uid="uid2")
        # 匿名事件（uid=""）不計入 DAU。
        _make_event("dictionary_search", days_ago=0, uid="")
        # 3 天前：uid3 一筆。
        _make_event("page_view", days_ago=3, uid="uid3")

        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=7d', headers)
        by_date = {row["date"]: row["count"] for row in resp.json()["daily_active_users"]}
        today = timezone.localdate()
        self.assertEqual(by_date[today.isoformat()], 2)
        self.assertEqual(by_date[(today - timedelta(days=3)).isoformat()], 1)
        # 沒有事件的日期要補 0，不能整個缺席。
        self.assertEqual(by_date[(today - timedelta(days=1)).isoformat()], 0)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_tribe_distribution_excludes_empty_tribe_and_filters_by_tribe_param(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        _make_event("dictionary_search", days_ago=0, tribe="tayal")
        _make_event("dictionary_search", days_ago=0, tribe="tayal")
        _make_event("dictionary_search", days_ago=0, tribe="amis")
        _make_event("page_view", days_ago=0, tribe="")  # 沒有族語脈絡的事件不計入分布

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        distribution = {row["tribe"]: row["count"] for row in resp.json()["tribe_distribution"]}
        self.assertEqual(distribution, {"tayal": 2, "amis": 1})

        with _as_role(EDITOR) as headers:
            resp = self._get('?tribe=amis', headers)
        distribution = {row["tribe"]: row["count"] for row in resp.json()["tribe_distribution"]}
        self.assertEqual(distribution, {"amis": 1})

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_feature_usage_counts_by_event_type_with_labels(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        _make_event("dictionary_search", days_ago=0)
        _make_event("dictionary_search", days_ago=0)
        _make_event("quiz_answer", days_ago=0)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        usage = {row["event_type"]: row for row in resp.json()["feature_usage"]}
        self.assertEqual(usage["dictionary_search"]["count"], 2)
        self.assertEqual(usage["dictionary_search"]["label"], "辭典搜尋")
        self.assertEqual(usage["quiz_answer"]["count"], 1)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_daily_new_registrations_uses_join_date_and_fills_gaps(self, mock_users, mock_client_fn):
        today = timezone.localdate()
        join_date_today = datetime.combine(today, datetime.min.time(), tzinfo=dt_timezone.utc).isoformat()
        two_days_ago = today - timedelta(days=2)
        join_date_past = datetime.combine(two_days_ago, datetime.min.time(), tzinfo=dt_timezone.utc).isoformat()

        mock_users.return_value = [
            _fake_user_record("uid1", created=1700000000000),
            _fake_user_record("uid2", created=1700000000000),
            _fake_user_record("uid3", created=1700000000000),
        ]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [
            _fake_snapshot("uid1", {"joinDate": join_date_today}),
            _fake_snapshot("uid2", {"joinDate": join_date_today}),
            _fake_snapshot("uid3", {"joinDate": join_date_past}),
        ]
        mock_client_fn.return_value = mock_client

        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=7d', headers)
        by_date = {row["date"]: row["count"] for row in resp.json()["daily_new_registrations"]}
        self.assertEqual(by_date[today.isoformat()], 2)
        self.assertEqual(by_date[two_days_ago.isoformat()], 1)
        self.assertEqual(by_date[(today - timedelta(days=1)).isoformat()], 0)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_user_without_join_date_is_skipped_not_errored(self, mock_users, mock_client_fn):
        mock_users.return_value = [_fake_user_record("uid1", created=1700000000000)]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [_fake_snapshot("uid1", {})]  # 沒有 joinDate 欄位
        mock_client_fn.return_value = mock_client

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        self.assertEqual(resp.status_code, 200)
        total = sum(row["count"] for row in resp.json()["daily_new_registrations"])
        self.assertEqual(total, 0)


def _make_search_event(query, exact_hit_count, fuzzy_hit_count, days_ago=0, tribe="tayal"):
    return _make_event(
        "dictionary_search", days_ago=days_ago, tribe=tribe,
        payload={"query": query, "exact_hit_count": exact_hit_count, "fuzzy_hit_count": fuzzy_hit_count},
    )


class SearchAnalyticsTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _get(self, query="", headers=None):
        return self.client.get(f'/adminapi/analytics/search/{query}', **(headers or {}))

    def test_requires_staff_role(self):
        with _as_role(None) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 403)

    def test_analyst_can_view(self):
        with _as_role(ANALYST) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 200)

    def test_invalid_date_range_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=999y', headers)
        self.assertEqual(resp.status_code, 400)

    def test_unknown_tribe_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?tribe=not-a-real-tribe', headers)
        self.assertEqual(resp.status_code, 400)

    def test_popular_queries_grouped_case_insensitively(self):
        _make_search_event("Balay", exact_hit_count=1, fuzzy_hit_count=0)
        _make_search_event("balay", exact_hit_count=1, fuzzy_hit_count=0)
        _make_search_event("BALAY", exact_hit_count=1, fuzzy_hit_count=0)
        _make_search_event("kolong", exact_hit_count=1, fuzzy_hit_count=0)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        popular = {row["query"]: row["count"] for row in resp.json()["popular_queries"]}
        self.assertEqual(popular, {"balay": 3, "kolong": 1})

    def test_zero_result_queries_only_count_zero_hit_occurrences(self):
        # "balay" 有一次命中、一次沒命中——只有沒命中那一次算進查無結果清單，
        # 不能因為同一個查詢字串「曾經」有命中過就整個排除在外。
        _make_search_event("balay", exact_hit_count=1, fuzzy_hit_count=0)
        _make_search_event("balay", exact_hit_count=0, fuzzy_hit_count=0)
        _make_search_event("xyz999", exact_hit_count=0, fuzzy_hit_count=0)
        _make_search_event("xyz999", exact_hit_count=0, fuzzy_hit_count=0)
        # fuzzy 有命中但 exact 沒有——不算查無結果（規劃定義是 exact 跟 fuzzy 都要 0）。
        _make_search_event("partial", exact_hit_count=0, fuzzy_hit_count=2)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        body = resp.json()
        popular = {row["query"]: row["count"] for row in body["popular_queries"]}
        zero_result = {row["query"]: row["count"] for row in body["zero_result_queries"]}

        self.assertEqual(popular["balay"], 2)  # 熱門排行不管有沒有命中，兩次都算
        self.assertEqual(zero_result["balay"], 1)
        self.assertEqual(zero_result["xyz999"], 2)
        self.assertNotIn("partial", zero_result)

    def test_tribe_filter_narrows_results(self):
        _make_search_event("tayalword", exact_hit_count=1, fuzzy_hit_count=0, tribe="tayal")
        _make_search_event("amisword", exact_hit_count=1, fuzzy_hit_count=0, tribe="amis")

        with _as_role(EDITOR) as headers:
            resp = self._get('?tribe=amis', headers)
        popular = {row["query"] for row in resp.json()["popular_queries"]}
        self.assertEqual(popular, {"amisword"})

    def test_date_range_excludes_events_outside_window(self):
        _make_search_event("recent", exact_hit_count=1, fuzzy_hit_count=0, days_ago=0)
        _make_search_event("old", exact_hit_count=1, fuzzy_hit_count=0, days_ago=10)

        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=7d', headers)
        popular = {row["query"] for row in resp.json()["popular_queries"]}
        self.assertEqual(popular, {"recent"})

    def test_only_dictionary_search_events_counted(self):
        _make_search_event("realquery", exact_hit_count=1, fuzzy_hit_count=0)
        _make_event("page_view", days_ago=0, payload={"query": "should not appear"})

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        popular = {row["query"] for row in resp.json()["popular_queries"]}
        self.assertEqual(popular, {"realquery"})

    def test_results_capped_at_100_and_sorted_by_count_desc(self):
        for i in range(105):
            _make_search_event(f"query{i}", exact_hit_count=1, fuzzy_hit_count=0)
        # 讓 query0 明顯是最熱門的一筆。
        for _ in range(5):
            _make_search_event("query0", exact_hit_count=1, fuzzy_hit_count=0)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        popular = resp.json()["popular_queries"]
        self.assertEqual(len(popular), 100)
        self.assertEqual(popular[0]["query"], "query0")
        self.assertEqual(popular[0]["count"], 6)


def _make_quiz_answer_event(uid, item_kind, item_id, correct, tribe="tayal", days_ago=0):
    return _make_event(
        "quiz_answer", days_ago=days_ago, uid=uid, tribe=tribe,
        payload={"item_kind": item_kind, "item_id": item_id, "level": "1", "correct": correct},
    )


class QuizQualityAnalyticsTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _get(self, query="", headers=None):
        return self.client.get(f'/adminapi/analytics/quiz-quality/{query}', **(headers or {}))

    def test_requires_staff_role(self):
        with _as_role(None) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 403)

    def test_analyst_can_view(self):
        with _as_role(ANALYST) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 200)

    def test_invalid_date_range_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=999y', headers)
        self.assertEqual(resp.status_code, 400)

    def test_unknown_tribe_rejected(self):
        with _as_role(EDITOR) as headers:
            resp = self._get('?tribe=not-a-real-tribe', headers)
        self.assertEqual(resp.status_code, 400)

    def test_anonymous_events_excluded_from_ranking_and_stats(self):
        _make_quiz_answer_event("", "true_false", 1, True)
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        self.assertEqual(resp.json()["items"], [])
        self.assertEqual(resp.json()["respondent_count"], 0)

    def test_malformed_payload_entries_are_skipped_not_errored(self):
        _make_event("quiz_answer", days_ago=0, uid="u1", payload={"item_kind": "true_false"})  # 缺 item_id/correct
        _make_event("quiz_answer", days_ago=0, uid="u1", payload={})
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["items"], [])

    def test_accuracy_rate_and_attempt_count(self):
        for i in range(3):
            _make_quiz_answer_event(f"u{i}", "true_false", 1, correct=True)
        _make_quiz_answer_event("u3", "true_false", 1, correct=False)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        item = resp.json()["items"][0]
        self.assertEqual(item["item_kind"], "true_false")
        self.assertEqual(item["item_id"], 1)
        self.assertEqual(item["attempt_count"], 4)
        self.assertEqual(item["accuracy_rate"], 0.75)

    def test_tribe_and_date_filters_narrow_results(self):
        _make_quiz_answer_event("u1", "true_false", 1, True, tribe="tayal")
        _make_quiz_answer_event("u2", "true_false", 2, True, tribe="amis")
        _make_quiz_answer_event("u3", "true_false", 3, True, days_ago=10)

        with _as_role(EDITOR) as headers:
            resp = self._get('?tribe=amis', headers)
        ids = {item["item_id"] for item in resp.json()["items"]}
        self.assertEqual(ids, {2})

        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=7d', headers)
        ids = {item["item_id"] for item in resp.json()["items"]}
        self.assertNotIn(3, ids)

    def test_insufficient_sample_below_thresholds(self):
        # 只有 3 位受試者、target 題只有 3 次作答，兩個門檻都不到，
        # discrimination 必須是 None、sufficient_sample 是 False——
        # 樣本太少時寧可誠實標成「不足」，也不要畫一個可能誤導的鑑別度。
        for i in range(3):
            _make_quiz_answer_event(f"u{i}", "true_false", 1, correct=True)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        item = resp.json()["items"][0]
        self.assertFalse(item["sufficient_sample"])
        self.assertIsNone(item["discrimination"])
        self.assertEqual(item["accuracy_rate"], 1.0)  # 答對率不受樣本門檻影響，一律照實計算

    def test_discrimination_high_low_group_split(self):
        """高低分組法（27% 法）的核心驗證：20 位受試者，6 位「高分組」在
        5 題填充題全對＋target 題也答對，6 位「低分組」填充題全錯＋target
        題也答錯，中間 8 位填充題對一半。group_size = round(20*0.27) = 5，
        高分組前 5 名一定是從那 6 位全對的人裡選、低分組後 5 名一定是從
        那 6 位全錯的人裡選（不管排序時同分的人誰先誰後），所以高分組在
        target 題的答對率必為 1.0、低分組必為 0.0，鑑別度必為 1.0 ——這個
        數字不是巧合湊出來的，是分組設計本身保證的，不受同分排序方式影響。
        """
        FILLER_ITEM_IDS = [101, 102, 103, 104, 105]
        for i in range(20):
            uid = f"user{i}"
            if i < 6:
                # 高分組：填充題全對
                for filler_id in FILLER_ITEM_IDS:
                    _make_quiz_answer_event(uid, "true_false", filler_id, correct=True)
                _make_quiz_answer_event(uid, "true_false", 999, correct=True)
            elif i < 12:
                # 低分組：填充題全錯
                for filler_id in FILLER_ITEM_IDS:
                    _make_quiz_answer_event(uid, "true_false", filler_id, correct=False)
                _make_quiz_answer_event(uid, "true_false", 999, correct=False)
            else:
                # 中間：填充題一半對一半錯，target 題答對與否不影響高低分組判定
                for j, filler_id in enumerate(FILLER_ITEM_IDS):
                    _make_quiz_answer_event(uid, "true_false", filler_id, correct=(j % 2 == 0))
                _make_quiz_answer_event(uid, "true_false", 999, correct=True)

        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        body = resp.json()
        self.assertEqual(body["respondent_count"], 20)

        target = next(item for item in body["items"] if item["item_id"] == 999)
        self.assertTrue(target["sufficient_sample"])
        self.assertEqual(target["discrimination"], 1.0)
        self.assertEqual(target["attempt_count"], 20)

    def test_label_resolved_for_true_false_item(self):
        item = QuizTrueFalseItem.objects.create(
            tribe='tayal', question_ab='qani ga, huzil.', question_ch='這是狗。',
            audio_url='https://res.cloudinary.com/demo/video/upload/a.mp3',
            image_url='https://res.cloudinary.com/demo/image/upload/a.png',
            answer=QuizTrueFalseItem.ANSWER_TRUE,
            status=QuizTrueFalseItem.STATUS_PUBLISHED, created_by='tester',
        )
        _make_quiz_answer_event("u1", "true_false", item.id, True)
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        found = next(i for i in resp.json()["items"] if i["item_id"] == item.id)
        self.assertEqual(found["label"], '這是狗。')
        self.assertEqual(found["list_path"], "/admin/quiz-bank/true-false")

    def test_label_resolved_for_choice_item(self):
        item = QuizChoiceItem.objects.create(
            tribe='tayal', question_ab='nyux qutux huzil maku.', question_ch='我有一隻狗。',
            image_a_url='https://res.cloudinary.com/demo/image/upload/a.png',
            image_b_url='https://res.cloudinary.com/demo/image/upload/b.png',
            image_c_url='https://res.cloudinary.com/demo/image/upload/c.png',
            answer=1, status=QuizChoiceItem.STATUS_PUBLISHED, created_by='tester',
        )
        _make_quiz_answer_event("u1", "choice", item.id, True)
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        found = next(i for i in resp.json()["items"] if i["item_id"] == item.id)
        self.assertEqual(found["label"], '我有一隻狗。')
        self.assertEqual(found["list_path"], "/admin/quiz-bank/choice")

    def test_label_resolved_for_situation_item(self):
        item = QuizSituationItem.objects.create(
            tribe='tayal', scenario_chinese='長輩遞給你食物，你要怎麼用族語回應？',
            options=[
                {'foreign': 'Mhway su balay.', 'chinese': '非常謝謝你。'},
                {'foreign': 'Lokah su?', 'chinese': '你好嗎？'},
                {'foreign': 'Musa su inu?', 'chinese': '你要去哪裡？'},
                {'foreign': 'Baq su balay.', 'chinese': '你很棒。'},
            ],
            answer=1, status=QuizSituationItem.STATUS_PUBLISHED, created_by='tester',
        )
        _make_quiz_answer_event("u1", "situation", item.id, True)
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        found = next(i for i in resp.json()["items"] if i["item_id"] == item.id)
        self.assertEqual(found["label"], '長輩遞給你食物，你要怎麼用族語回應？')
        self.assertEqual(found["list_path"], "/admin/quiz-bank/situations")

    def test_label_resolved_for_matching_item(self):
        item = QuizVocabItem.objects.create(
            tribe='tayal', category='noun', foreign_word='huzil', chinese_gloss='狗',
            status=QuizVocabItem.STATUS_PUBLISHED, created_by='tester',
        )
        _make_quiz_answer_event("u1", "matching", item.id, True)
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        found = next(i for i in resp.json()["items"] if i["item_id"] == item.id)
        self.assertEqual(found["label"], 'huzil／狗')
        self.assertEqual(found["list_path"], "/admin/quiz-bank/vocab")

    def test_label_resolved_for_cloze_item_with_composite_id(self):
        passage = QuizClozePassage.objects.create(
            tribe='tayal', passage_foreign='Lokah! {blank1}', passage_chinese='你好嗎！',
            blanks={'blank1': {'options': ['a', 'b', 'c', 'd'], 'answer': 1}},
            status=QuizClozePassage.STATUS_PUBLISHED, created_by='tester',
        )
        composite_id = f"{passage.id}:blank1"
        _make_quiz_answer_event("u1", "cloze", composite_id, True)
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        found = next(i for i in resp.json()["items"] if i["item_id"] == composite_id)
        self.assertIn('你好嗎！', found["label"])
        self.assertIn('blank1', found["label"])


def _monday_of(day):
    """跟 analytics_views._week_start 同一種算法（獨立寫一次，不 import
    私有函式）：ISO 週一為一週起點，用來在測試裡獨立算出「預期」的世代週，
    不依賴被測程式碼本身的實作。"""
    return day - timedelta(days=day.weekday())


class RetentionAnalyticsTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _get(self, query="", headers=None):
        url = f'/adminapi/analytics/retention/{query}'
        return self.client.get(url, **(headers or {}))

    @staticmethod
    def _iso(day):
        return datetime.combine(day, datetime.min.time(), tzinfo=dt_timezone.utc).isoformat()

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_requires_staff_role(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(None) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 403)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_analyst_can_view(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(ANALYST) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 200)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_no_users_returns_empty_cohorts(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(EDITOR) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.json(), {"cohorts": [], "max_weeks": 12})

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_user_without_join_date_is_skipped_not_errored(self, mock_users, mock_client_fn):
        mock_users.return_value = [_fake_user_record("uid1", created=1700000000000)]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [_fake_snapshot("uid1", {})]  # 沒有 joinDate 欄位
        mock_client_fn.return_value = mock_client

        with _as_role(EDITOR) as headers:
            resp = self._get(headers=headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["cohorts"], [])

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_users_grouped_by_join_week_and_retention_counts_any_event_type(self, mock_users, mock_client_fn):
        today = timezone.localdate()
        this_monday = _monday_of(today)
        last_monday = this_monday - timedelta(days=7)

        mock_users.return_value = [
            _fake_user_record("uidA", created=1700000000000),
            _fake_user_record("uidB", created=1700000000000),
            _fake_user_record("uidC", created=1700000000000),
        ]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [
            _fake_snapshot("uidA", {"joinDate": self._iso(last_monday)}),
            _fake_snapshot("uidB", {"joinDate": self._iso(last_monday + timedelta(days=2))}),  # 跟 uidA 同一週世代
            _fake_snapshot("uidC", {"joinDate": self._iso(this_monday)}),  # 本週才加入的獨立世代
        ]
        mock_client_fn.return_value = mock_client

        def _days_ago(day):
            return (today - day).days

        # uidA：世代週（last_monday 那週）跟下一週（this_monday 那週）都有活動。
        _make_event("page_view", days_ago=_days_ago(last_monday), uid="uidA")
        _make_event("quiz_answer", days_ago=_days_ago(this_monday), uid="uidA")  # 事件類型不限，任何類型都算活躍
        # uidB：只有世代週（同一週但不同天）有活動。
        _make_event("dictionary_search", days_ago=_days_ago(last_monday + timedelta(days=2)), uid="uidB")
        # uidC：世代週（this_monday 那週，也就是本週）有活動。
        _make_event("page_view", days_ago=_days_ago(today), uid="uidC")

        with _as_role(EDITOR) as headers:
            resp = self._get(headers=headers)
        cohorts = {c["cohort_start"]: c for c in resp.json()["cohorts"]}

        last_cohort = cohorts[last_monday.isoformat()]
        self.assertEqual(last_cohort["cohort_size"], 2)
        retention_by_offset = {r["week_offset"]: r for r in last_cohort["retention"]}
        self.assertEqual(retention_by_offset[0]["active_count"], 2)
        self.assertEqual(retention_by_offset[0]["rate"], 1.0)
        self.assertEqual(retention_by_offset[1]["active_count"], 1)
        self.assertEqual(retention_by_offset[1]["rate"], 0.5)

        this_cohort = cohorts[this_monday.isoformat()]
        self.assertEqual(this_cohort["cohort_size"], 1)
        # 本週才開始的世代還沒有機會產生下一週的資料，不該出現「還沒發生」
        # 的未來週次（那是尚未發生，不是量測到 0% 留存）。
        self.assertEqual([r["week_offset"] for r in this_cohort["retention"]], [0])
        self.assertEqual(this_cohort["retention"][0]["rate"], 1.0)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_retention_weeks_capped_at_max_weeks(self, mock_users, mock_client_fn):
        # 世代加入時間很久遠（300 天前，遠超過 12 週上限），週次陣列長度
        # 應該被裁切成 12（0~11），不能無限成長。
        old_monday = _monday_of(timezone.localdate() - timedelta(days=300))
        mock_users.return_value = [_fake_user_record("uid1", created=1700000000000)]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [_fake_snapshot("uid1", {"joinDate": self._iso(old_monday)})]
        mock_client_fn.return_value = mock_client

        with _as_role(EDITOR) as headers:
            resp = self._get(headers=headers)
        cohort = resp.json()["cohorts"][0]
        self.assertEqual(len(cohort["retention"]), 12)
        self.assertEqual([r["week_offset"] for r in cohort["retention"]], list(range(12)))
