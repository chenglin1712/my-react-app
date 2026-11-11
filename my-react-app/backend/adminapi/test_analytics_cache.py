"""O19：joinDate 全量掃描結果快取 5 分鐘（儀表板新註冊與留存分析共用）；
留存分析的事件改在資料庫端依（使用者, 日期）去重，並且不再把全部 uid 塞進 IN 清單。"""
from datetime import date, datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone

from . import analytics_service as svc
from .models import UsageEvent


def _doc(uid, join):
    d = MagicMock()
    d.id = uid
    d.exists = join is not None
    d.to_dict.return_value = {"joinDate": join} if join else {}
    return d


def _firebase(users_to_join):
    """回傳 (list_users 的 patch, client 的 patch, 計數器)：users_to_join = {uid: joinDate 字串或 None}。"""
    calls = {"list": 0, "get_all": 0}
    users = [SimpleNamespace(uid=u) for u in users_to_join]

    def list_users():
        calls["list"] += 1
        return users

    client = MagicMock()

    def get_all(refs):
        calls["get_all"] += 1
        return [_doc(uid, join) for uid, join in users_to_join.items()]

    client.get_all.side_effect = get_all
    return (patch("adminapi.firebase_ops.list_all_firebase_users", side_effect=list_users),
            patch("adminapi.firebase_ops.get_firestore_client", return_value=client), calls)


def _iso(day):
    return datetime.combine(day, datetime.min.time(), tzinfo=dt_timezone.utc).isoformat()


class JoinDateCacheTest(TestCase):
    def setUp(self):
        svc.clear_join_date_cache()
        self.addCleanup(svc.clear_join_date_cache)
        self.today = timezone.localdate()

    def test_registrations_and_retention_share_one_scan_within_the_ttl(self):
        p1, p2, calls = _firebase({"a": _iso(self.today), "b": _iso(self.today - timedelta(days=9)), "c": None})
        with p1, p2:
            series = svc.daily_new_registrations(self.today - timedelta(days=10), self.today)
            svc.build_retention_analytics()
            svc.daily_new_registrations(self.today - timedelta(days=10), self.today)
        self.assertEqual(calls, {"list": 1, "get_all": 1})
        self.assertEqual(sum(row["count"] for row in series), 2)      # 沒有 joinDate 的 c 不算

    def test_scan_is_repeated_after_the_ttl_expires(self):
        p1, p2, calls = _firebase({"a": _iso(self.today)})
        with p1, p2, patch("adminapi.analytics_service.time.monotonic") as clock:
            clock.return_value = 1000.0
            svc.daily_new_registrations(self.today, self.today)
            clock.return_value = 1000.0 + svc.JOIN_DATES_TTL_SECONDS - 1
            svc.daily_new_registrations(self.today, self.today)
            self.assertEqual(calls["list"], 1)
            clock.return_value = 1000.0 + svc.JOIN_DATES_TTL_SECONDS + 1
            svc.daily_new_registrations(self.today, self.today)
        self.assertEqual(calls["list"], 2)

    def test_a_failed_scan_is_not_cached(self):
        with patch("adminapi.firebase_ops.list_all_firebase_users", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                svc.daily_new_registrations(self.today, self.today)
        p1, p2, calls = _firebase({"a": _iso(self.today)})
        with p1, p2:
            series = svc.daily_new_registrations(self.today, self.today)
        self.assertEqual(series[-1]["count"], 1)       # 失敗之後下一次會重新掃描，不是沿用失敗結果

    def test_clear_forces_a_fresh_scan(self):
        p1, p2, calls = _firebase({"a": _iso(self.today)})
        with p1, p2:
            svc.daily_new_registrations(self.today, self.today)
            svc.clear_join_date_cache()
            svc.daily_new_registrations(self.today, self.today)
        self.assertEqual(calls["list"], 2)


class RetentionEventsTest(TestCase):
    def setUp(self):
        svc.clear_join_date_cache()
        self.addCleanup(svc.clear_join_date_cache)

    def test_many_events_per_day_count_one_activity_and_outsiders_are_ignored(self):
        today = timezone.localdate()
        cohort_day = today - timedelta(days=15)
        p1, p2, _ = _firebase({"u1": _iso(cohort_day), "u2": _iso(cohort_day)})
        week1 = timezone.make_aware(datetime.combine(cohort_day + timedelta(days=7), datetime.min.time()))
        def add(uid):
            event = UsageEvent.objects.create(uid=uid, event_type="dictionary_search")
            UsageEvent.objects.filter(pk=event.pk).update(created_at=week1)   # created_at 是 auto_now_add

        for _ in range(5):                                          # 同一天 5 筆事件，只算一個活躍使用者
            add("u1")
        add("not-in-cohort")
        add("")                                                     # 訪客
        with p1, p2:
            out = svc.build_retention_analytics()
        cohort = out["cohorts"][0]
        self.assertEqual(cohort["cohort_size"], 2)
        by_offset = {r["week_offset"]: r["active_count"] for r in cohort["retention"]}
        self.assertEqual(by_offset.get(1), 1)

    def test_no_in_clause_is_built_from_the_cohort(self):
        today = timezone.localdate()
        uids = {f"u{i}": _iso(today - timedelta(days=20)) for i in range(1200)}      # 超過 SQLite 的 999 參數上限
        p1, p2, _ = _firebase(uids)
        with p1, p2:
            out = svc.build_retention_analytics()
        self.assertEqual(out["cohorts"][0]["cohort_size"], 1200)


class JoinDateScanLockTest(TestCase):
    def setUp(self):
        svc.clear_join_date_cache()
        self.addCleanup(svc.clear_join_date_cache)

    def test_the_network_scan_does_not_hold_the_lock(self):
        held = []

        def list_users():
            held.append(svc._join_dates_lock.locked())
            return []

        with patch("adminapi.firebase_ops.list_all_firebase_users", side_effect=list_users), \
                patch("adminapi.firebase_ops.get_firestore_client", return_value=MagicMock()):
            svc.daily_new_registrations(date(2026, 1, 1), date(2026, 1, 2))
        self.assertEqual(held, [False])

    def test_a_clear_during_the_scan_prevents_the_stale_result_from_being_stored(self):
        def list_users():
            svc.clear_join_date_cache()       # 掃描進行中被清除
            return []

        with patch("adminapi.firebase_ops.list_all_firebase_users", side_effect=list_users), \
                patch("adminapi.firebase_ops.get_firestore_client", return_value=MagicMock()):
            svc.daily_new_registrations(date(2026, 1, 1), date(2026, 1, 2))
        self.assertIsNone(svc._join_dates_cache["data"])


class RetentionLowerBoundTest(TestCase):
    def setUp(self):
        svc.clear_join_date_cache()
        self.addCleanup(svc.clear_join_date_cache)

    def test_events_before_the_earliest_cohort_are_not_read(self):
        today = timezone.localdate()
        join = today - timedelta(days=15)
        p1, p2, _ = _firebase({"u1": _iso(join)})
        old = timezone.make_aware(datetime.combine(join - timedelta(days=60), datetime.min.time()))
        event = UsageEvent.objects.create(uid="u1", event_type="dictionary_search")
        UsageEvent.objects.filter(pk=event.pk).update(created_at=old)
        with p1, p2:
            out = svc.build_retention_analytics()
        self.assertTrue(all(r["active_count"] == 0 for r in out["cohorts"][0]["retention"]))
