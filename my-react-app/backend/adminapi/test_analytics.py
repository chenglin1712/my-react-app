"""P5 數據分析：P5.0 使用事件記錄端點 + P5.1 儀表板聚合端點 + P5.2 搜尋分析端點
+ P5.3 題目品質分析端點。

跟其他 adminapi 測試不同的地方：POST /adminapi/public/events/ 是唯一刻意
允許匿名（未登入）呼叫的寫入端點——測試要涵蓋「完全沒帶 token」「帶了
有效 token 但沒有後台角色（一般學習者）」兩種情境，不是只測 STAFF_ROLES。
"""
import json
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils import timezone

from config.roles import ANALYST, EDITOR

from .analytics_views import _join_date_to_local_date

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

    def test_dictionary_search_rejected_on_public_endpoint(self):
        """獨立審查找到的問題：dictionary_search 已經有 FastAPI 端的可信
        寫入路徑（見 backend/fastAPI/usage_events.py），公開端點不該再開放
        建立這個類型，否則任何人都能偽造查詢字串/命中數污染搜尋分析報表。"""
        with override_settings(AUTH_DEV_BYPASS=False):
            resp = _post_json(self.client, '/adminapi/public/events/', {
                "event_type": "dictionary_search",
                "payload": {"query": "偽造熱門詞", "exact_hit_count": 999, "fuzzy_hit_count": 0},
            })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(UsageEvent.objects.count(), 0)

    def _post_quiz_answer(self, payload):
        with override_settings(AUTH_DEV_BYPASS=False):
            return _post_json(self.client, '/adminapi/public/events/', {
                "event_type": "quiz_answer", "payload": payload,
            })

    def test_valid_quiz_answer_payload_accepted(self):
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": 1, "correct": True})
        self.assertEqual(resp.status_code, 201)

    def test_valid_cloze_composite_item_id_accepted(self):
        resp = self._post_quiz_answer({"item_kind": "cloze", "item_id": "42:blank1", "correct": False})
        self.assertEqual(resp.status_code, 201)

    def test_quiz_answer_unknown_item_kind_rejected(self):
        resp = self._post_quiz_answer({"item_kind": "not-a-real-kind", "item_id": 1, "correct": True})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(UsageEvent.objects.count(), 0)

    def test_quiz_answer_list_item_kind_rejected(self):
        """畸形 item_kind（list）修正前會讓 quiz_quality_analytics() 因為
        拿 list 當雜湊 key 直接 500——寫入端就該擋下來。"""
        resp = self._post_quiz_answer({"item_kind": ["true_false"], "item_id": 1, "correct": True})
        self.assertEqual(resp.status_code, 400)

    def test_quiz_answer_dict_item_id_rejected(self):
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": {"id": 1}, "correct": True})
        self.assertEqual(resp.status_code, 400)

    def test_quiz_answer_non_cloze_item_id_must_be_positive_int(self):
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": "1", "correct": True})
        self.assertEqual(resp.status_code, 400)
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": 0, "correct": True})
        self.assertEqual(resp.status_code, 400)
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": -1, "correct": True})
        self.assertEqual(resp.status_code, 400)

    def test_quiz_answer_cloze_item_id_must_match_composite_format(self):
        resp = self._post_quiz_answer({"item_kind": "cloze", "item_id": 42, "correct": True})
        self.assertEqual(resp.status_code, 400)
        resp = self._post_quiz_answer({"item_kind": "cloze", "item_id": "not-composite", "correct": True})
        self.assertEqual(resp.status_code, 400)

    def test_quiz_answer_string_correct_rejected(self):
        """核心案例：Python 的 bool("false") 會是 True，如果不嚴格檢查
        型別，這筆會被誤判成「答對」，靜默扭曲答對率統計。"""
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": 1, "correct": "false"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(UsageEvent.objects.count(), 0)

    def test_quiz_answer_int_correct_rejected(self):
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": 1, "correct": 1})
        self.assertEqual(resp.status_code, 400)

    def test_quiz_answer_level_optional_but_must_be_string_if_present(self):
        # situation 情境題不帶 level（見 ScenarioQuiz.jsx），這裡確認完全
        # 省略時仍然合法。
        resp = self._post_quiz_answer({"item_kind": "situation", "item_id": 1, "correct": True})
        self.assertEqual(resp.status_code, 201)
        resp = self._post_quiz_answer({"item_kind": "true_false", "item_id": 1, "correct": True, "level": 1})
        self.assertEqual(resp.status_code, 400)


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

    def test_custom_range_over_90_days_rejected(self):
        """獨立審查找到的問題：custom 日期沒有跨度上限時，具 staff 角色的
        client 可以要求例如 0001-01-01 到 9999-12-31，即使資料庫沒資料，
        _fill_date_series() 仍會建立數百萬個補零項目，dashboard 還會對
        Firebase 執行全量掃描，可能讓 worker 長時間占用 CPU/記憶體。"""
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=custom&date_from=2026-01-01&date_to=2026-12-31', headers)
        self.assertEqual(resp.status_code, 400)

    @patch("adminapi.firebase_ops.get_firestore_client")
    @patch("adminapi.firebase_ops.list_all_firebase_users")
    def test_custom_range_exactly_90_days_accepted(self, mock_users, mock_client_fn):
        mock_users.return_value = []
        mock_client_fn.return_value = MagicMock(get_all=MagicMock(return_value=[]))
        with _as_role(EDITOR) as headers:
            resp = self._get('?date_range=custom&date_from=2026-01-01&date_to=2026-03-31', headers)
        self.assertEqual(resp.status_code, 200)

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

    def test_unhashable_item_kind_or_id_skipped_without_500(self):
        """讀取端的防禦性檢查——寫入端已經擋掉這類畸形資料，但這裡直接用
        ORM 繞過寫入端驗證模擬「這次修正之前寫入的歷史資料」，確認即使
        item_kind/item_id 是 list/dict 這種不可雜湊型別，聚合端點也不會
        500（獨立審查找到的問題：原本直接拿去當 dict key 會直接
        TypeError: unhashable type）。"""
        _make_event("quiz_answer", days_ago=0, uid="u1", payload={"item_kind": ["true_false"], "item_id": 1, "correct": True})
        _make_event("quiz_answer", days_ago=0, uid="u1", payload={"item_kind": "true_false", "item_id": {"id": 1}, "correct": True})
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["items"], [])

    def test_string_correct_value_does_not_get_coerced_to_true(self):
        """核心案例：修正前用 bool(correct) 強制轉換，字串 "false" 會變成
        True，靜默把答錯算成答對。這裡確認這種歷史髒資料的事件被整筆跳過
        （不計入答對率），而不是被誤判成答對。"""
        _make_quiz_answer_event("u1", "true_false", 1, correct=True)
        _make_event("quiz_answer", days_ago=0, uid="u2", payload={"item_kind": "true_false", "item_id": 1, "correct": "false"})
        with _as_role(EDITOR) as headers:
            resp = self._get('', headers)
        item = resp.json()["items"][0]
        # 只有 u1 的合法事件被計入；u2 的字串 correct 整筆被跳過，不會被
        # bool("false")==True 誤判成答對而讓 attempt_count 變成 2。
        self.assertEqual(item["attempt_count"], 1)
        self.assertEqual(item["accuracy_rate"], 1.0)

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
        one_week_ago_monday = this_monday - timedelta(days=7)
        two_weeks_ago_monday = this_monday - timedelta(days=14)

        mock_users.return_value = [
            _fake_user_record("uidA", created=1700000000000),
            _fake_user_record("uidB", created=1700000000000),
            _fake_user_record("uidC", created=1700000000000),
        ]
        mock_client = MagicMock()
        mock_client.get_all.return_value = [
            _fake_snapshot("uidA", {"joinDate": self._iso(two_weeks_ago_monday)}),
            _fake_snapshot("uidB", {"joinDate": self._iso(two_weeks_ago_monday + timedelta(days=2))}),  # 跟 uidA 同一週世代
            _fake_snapshot("uidC", {"joinDate": self._iso(this_monday)}),  # 本週才加入的獨立世代
        ]
        mock_client_fn.return_value = mock_client

        def _days_ago(day):
            return (today - day).days

        # uidA：世代週（two_weeks_ago_monday 那週，已完整結束）跟下一週
        # （one_week_ago_monday 那週，也已完整結束）都有活動。
        _make_event("page_view", days_ago=_days_ago(two_weeks_ago_monday), uid="uidA")
        _make_event("quiz_answer", days_ago=_days_ago(one_week_ago_monday), uid="uidA")  # 事件類型不限，任何類型都算活躍
        # uidB：只有世代週（同一週但不同天）有活動。
        _make_event("dictionary_search", days_ago=_days_ago(two_weeks_ago_monday + timedelta(days=2)), uid="uidB")
        # uidC：世代週（this_monday 那週，也就是本週）有活動。
        _make_event("page_view", days_ago=_days_ago(today), uid="uidC")
        # uidA 在本週（this_monday，還在進行中）也有活動——這是這次修正的
        # 核心案例：對 two_weeks_ago_monday 這個世代來說，本週是
        # week_offset=2，還沒完整結束，不該出現在回應裡，即使真的有活動
        # 資料存在也一樣（那是「還沒發生」不是「量測到偏低留存」）。
        _make_event("page_view", days_ago=_days_ago(today), uid="uidA")

        with _as_role(EDITOR) as headers:
            resp = self._get(headers=headers)
        cohorts = {c["cohort_start"]: c for c in resp.json()["cohorts"]}

        old_cohort = cohorts[two_weeks_ago_monday.isoformat()]
        self.assertEqual(old_cohort["cohort_size"], 2)
        retention_by_offset = {r["week_offset"]: r for r in old_cohort["retention"]}
        # 只有已經完整結束的週次會出現：0（世代週本身）跟 1（已完整結束），
        # 2（本週，還在進行中）不該出現——這正是這次修正的核心斷言。
        self.assertEqual(sorted(retention_by_offset.keys()), [0, 1])
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


class JoinDateToLocalDateTest(TestCase):
    """獨立審查找到的問題：_daily_new_registrations()／retention_analytics()
    原本直接對 joinDate 的 UTC datetime 呼叫 .date()，沒有先轉成專案目前
    時區——如果 TIME_ZONE 設定不是 UTC，當地時間已經跨日、UTC 還沒跨日的
    時間點會被歸到錯的一天/一週，跟 UsageEvent（用 timezone.localtime()
    分日/分週）的依據不一致。這裡直接測 _join_date_to_local_date()
    本身，不透過 HTTP——這個專案目前的 TIME_ZONE 就是 UTC，轉換在正式
    環境暫時是 no-op，沒辦法透過現有 API 回應觀察到差異，只能直接測
    函式在不同 TIME_ZONE 設定下的行為。"""

    def test_utc_time_that_has_already_rolled_over_locally_uses_local_date(self):
        # UTC 16:30（8/9）在 UTC+8（Asia/Taipei）已經是隔天 00:30（8/10）。
        with override_settings(TIME_ZONE="Asia/Taipei"):
            local_date = _join_date_to_local_date("2026-08-09T16:30:00Z")
        self.assertEqual(local_date, date(2026, 8, 10))

    def test_under_utc_setting_conversion_is_a_no_op(self):
        # 這個專案目前的 TIME_ZONE 就是 UTC，驗證這個情況下轉換前後日期
        # 相同，不會意外改變既有行為。
        with override_settings(TIME_ZONE="UTC"):
            local_date = _join_date_to_local_date("2026-08-09T16:30:00Z")
        self.assertEqual(local_date, date(2026, 8, 9))

    def test_invalid_string_returns_none(self):
        self.assertIsNone(_join_date_to_local_date("not-a-date"))

    def test_none_input_returns_none(self):
        self.assertIsNone(_join_date_to_local_date(None))

    def test_naive_datetime_string_does_not_crash(self):
        """正式環境的真實資料裡有些 joinDate 字串沒有時區資訊（沒有 "Z"
        也沒有 offset）——timezone.localtime() 要求輸入必須是 aware
        datetime，這種值原本會直接讓整個報表端點 500（透過真實 Firebase
        資料跑 test_custom_range_exactly_90_days_accepted 時意外發現的
        真實 bug，不是憑空想像的邊角案例）。"""
        local_date = _join_date_to_local_date("2026-08-09T16:30:00")
        self.assertEqual(local_date, date(2026, 8, 9))
