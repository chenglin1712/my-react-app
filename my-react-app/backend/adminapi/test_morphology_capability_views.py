import threading
import time
from contextlib import contextmanager
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi import morphology_capability_views as V
from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

URL = "/adminapi/system/morphology-capabilities/"
REPORT = {"report_version": 1, "tribes": []}


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


class MorphologyCapabilityViewTest(TestCase):
    def setUp(self):
        cache.clear()
        V.clear_cache()
        self.addCleanup(V.clear_cache)
        self.client = Client()

    def test_every_staff_role_can_read(self):
        for role in (OWNER, ADMIN, EDITOR, REVIEWER, ANALYST):
            V.clear_cache()
            with _as_role(role) as headers, patch.object(V, "_compute", return_value=REPORT):
                response = self.client.get(URL, **headers)
            self.assertEqual(response.status_code, 200, role)
            self.assertEqual(response.json()["report"], REPORT)

    def test_learner_and_anonymous_are_refused_and_nothing_is_computed(self):
        with _as_role(None) as headers, patch.object(V, "_compute") as compute:
            self.assertEqual(self.client.get(URL, **headers).status_code, 403)
        with override_settings(AUTH_DEV_BYPASS=False), patch.object(V, "_compute") as compute:
            self.assertIn(self.client.get(URL).status_code, (401, 403))
        compute.assert_not_called()

    def test_only_get_is_allowed(self):
        with _as_role(OWNER) as headers, patch.object(V, "_compute") as compute:
            for method in ("post", "put", "patch", "delete"):
                self.assertEqual(getattr(self.client, method)(URL, **headers).status_code, 405, method)
        compute.assert_not_called()

    def test_second_request_within_ttl_is_served_from_cache(self):
        with _as_role(OWNER) as headers, patch.object(V, "_compute", return_value=REPORT) as compute:
            first = self.client.get(URL, **headers).json()
            second = self.client.get(URL, **headers).json()
        self.assertEqual(compute.call_count, 1)
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(first["generated_at"], second["generated_at"])

    def test_cache_expires_after_the_ttl(self):
        with _as_role(OWNER) as headers, patch.object(V, "_compute", return_value=REPORT) as compute:
            self.client.get(URL, **headers)
            V._cached["at"] -= V.CACHE_TTL_SECONDS + 1
            self.assertFalse(self.client.get(URL, **headers).json()["cached"])
        self.assertEqual(compute.call_count, 2)

    def test_failure_is_503_with_a_fixed_message_and_is_not_cached(self):
        with _as_role(OWNER) as headers:
            with patch.object(V, "_compute", side_effect=RuntimeError("secret db password")):
                response = self.client.get(URL, **headers)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("secret", response.content.decode("utf-8"))
            with patch.object(V, "_compute", return_value=REPORT) as compute:
                self.assertEqual(self.client.get(URL, **headers).status_code, 200)
            compute.assert_called_once()

    def test_a_failure_after_a_success_does_not_serve_the_old_report_once_expired(self):
        with _as_role(OWNER) as headers:
            with patch.object(V, "_compute", return_value=REPORT):
                self.client.get(URL, **headers)
            V._cached["at"] -= V.CACHE_TTL_SECONDS + 1
            with patch.object(V, "_compute", side_effect=RuntimeError("x")):
                self.assertEqual(self.client.get(URL, **headers).status_code, 503)

    def test_concurrent_requests_share_one_computation(self):
        started, release = threading.Event(), threading.Event()
        calls = []

        def slow_compute():
            calls.append(1)
            started.set()
            release.wait(5)
            return REPORT

        results = []

        def worker():
            results.append(V._get_report())

        with patch.object(V, "_compute", side_effect=slow_compute):
            threads = [threading.Thread(target=worker) for _ in range(4)]
            threads[0].start()
            self.assertTrue(started.wait(5))
            for t in threads[1:]:
                t.start()
            time.sleep(0.2)
            release.set()
            for t in threads:
                t.join(5)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(results), 4)
        self.assertEqual(sorted(r[2] for r in results), [False, True, True, True])

    def test_waiting_for_the_lock_times_out_with_503_instead_of_piling_up(self):
        with _as_role(OWNER) as headers, patch.object(V, "LOCK_TIMEOUT_SECONDS", 0.05), \
                patch.object(V, "_compute", return_value=REPORT) as compute:
            V._lock.acquire()
            try:
                response = self.client.get(URL, **headers)
            finally:
                V._lock.release()
        self.assertEqual(response.status_code, 503)
        compute.assert_not_called()
        # 逾時之後鎖仍可正常取得（沒有被洩漏）
        self.assertTrue(V._lock.acquire(timeout=1))
        V._lock.release()

    def test_the_lock_is_released_after_a_failed_computation(self):
        with patch.object(V, "_compute", side_effect=RuntimeError("x")):
            with self.assertRaises(RuntimeError):
                V._get_report()
        self.assertTrue(V._lock.acquire(timeout=1))
        V._lock.release()

    def test_the_real_report_for_the_committed_artifact_is_well_formed(self):
        # 不 mock _compute：用 SQLite 空資料庫跑真實流程，驗證端到端不丟例外、結構正確、五族順序固定
        from adminapi.test_morphology_inputs import _seed, _session
        from config.tribes import TRIBES
        db = _session()
        _seed(db)
        with _as_role(OWNER) as headers, patch.object(V, "SessionLocal", return_value=db):
            response = self.client.get(URL, **headers)
        self.assertEqual(response.status_code, 200)
        report = response.json()["report"]
        self.assertEqual([t["tribe"] for t in report["tribes"]], [t.slug for t in TRIBES])
        self.assertEqual(report["report_version"], 1)
        # 測試用的小辭典與已提交的放行檔對不上，所以有資料的族語必須被標成舊資料快照
        kavalan = next(t for t in report["tribes"] if t["tribe"] == "kavalan")
        self.assertTrue(kavalan["snapshot_stale"])
