"""HomepageConfig 單例在 PostgreSQL 下的並行寫入實測（Apple 化步驟 2-6 補驗證）。

開發與 CI 預設用 SQLite，select_for_update() 在 SQLite 不提供列鎖，所以這份測試只在 PostgreSQL 執行，其他資料庫自動跳過。
執行方式（Django 會自己建立並刪除 test_ 開頭的暫時資料庫，不碰正式資料）：

    set DATABASE_URL=postgresql://使用者:密碼@localhost:5432/任一已存在的資料庫
    python manage.py test adminapi.test_homepage_concurrency_pg -v 2

驗證三件事：
1. 兩個連線同時 PATCH 不同欄位，不會互相蓋掉（後到的等鎖，拿到鎖後讀到前一個已提交的值）。
2. 後到的 PATCH 的跨欄位驗證（結束晚於開始）是對「鎖後的最新值」檢查的。
3. 同時首次建立單例列，只會有一列。
"""
import json
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import Client, TransactionTestCase, skipUnlessDBFeature
from django.test.utils import override_settings
from django.utils import timezone

from adminapi import homepage_config_views
from adminapi.auth_fixtures import fresh_auth
from config.roles import OWNER

from .models import HomepageConfig

ADMIN_URL = "/adminapi/homepage-config/"


@contextmanager
def _as_owner():
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth({"uid": "pg-test", "role": OWNER})):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _patch(headers, payload):
    client = Client()
    try:
        response = client.patch(ADMIN_URL, data=json.dumps(payload), content_type="application/json", **headers)
        return response.status_code, response.json()
    finally:
        close_old_connections()
        connection.close()


@skipUnlessDBFeature("has_select_for_update")
class HomepageConfigPostgresConcurrencyTest(TransactionTestCase):
    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("需要 PostgreSQL（select_for_update 在 SQLite 不是真的列鎖）")
        HomepageConfig.load()

    def _slow_first_writer(self, hold_seconds):
        """讓第一個 PATCH 在持有列鎖的 transaction 內多停一下（稽核紀錄寫入時），逼出鎖等待。"""
        real = homepage_config_views._write_audit_log
        first = threading.Event()

        def slow(*args, **kwargs):
            if not first.is_set():
                first.set()
                time.sleep(hold_seconds)
            return real(*args, **kwargs)

        return patch.object(homepage_config_views, "_write_audit_log", slow), first

    def test_two_concurrent_patches_of_different_fields_both_survive_and_serialize(self):
        slow, first_started = self._slow_first_writer(1.0)
        results = {}
        finished = {}

        with _as_owner() as headers, slow:
            def run(name, payload):
                results[name] = _patch(headers, payload)
                finished[name] = time.monotonic()

            a = threading.Thread(target=run, args=("a", {"notice_text": "甲", "notice_enabled": True}))
            b = threading.Thread(target=run, args=("b", {"tagline": "乙標語"}))
            a.start()
            self.assertTrue(first_started.wait(5), "第一個 PATCH 沒有進到持鎖區")
            started_b = time.monotonic()
            b.start()
            a.join(15)
            b.join(15)

        self.assertEqual(results["a"][0], 200, results["a"])
        self.assertEqual(results["b"][0], 200, results["b"])
        # B 必須等 A 提交才完成：B 的耗時至少接近 A 持鎖的時間（有真的在等鎖）
        self.assertGreaterEqual(finished["b"] - started_b, 0.5, "B 沒有等鎖，列鎖可能沒有生效")
        self.assertGreaterEqual(finished["b"], finished["a"] - 0.05)
        config = HomepageConfig.objects.get(pk=1)
        self.assertEqual((config.notice_text, config.notice_enabled, config.tagline), ("甲", True, "乙標語"))

    def test_late_patch_validates_against_the_committed_value_after_the_lock(self):
        now = timezone.now()
        slow, first_started = self._slow_first_writer(1.0)
        results = {}

        with _as_owner() as headers, slow:
            def run(name, payload):
                results[name] = _patch(headers, payload)

            # A：把開始時間設在 2 天後（持鎖 1 秒）。B 同時把結束時間設在 1 天後：
            # B 拿到鎖後讀到 A 已提交的開始時間，結束早於開始，必須被拒絕。
            a = threading.Thread(target=run, args=("a", {
                "notice_enabled": True, "notice_text": "公告", "notice_starts_at": (now + timedelta(days=2)).isoformat(),
            }))
            b = threading.Thread(target=run, args=("b", {"notice_ends_at": (now + timedelta(days=1)).isoformat()}))
            a.start()
            self.assertTrue(first_started.wait(5))
            b.start()
            a.join(15)
            b.join(15)

        self.assertEqual(results["a"][0], 200, results["a"])
        self.assertEqual(results["b"][0], 400, results["b"])
        self.assertIn("notice_ends_at", results["b"][1]["errors"])
        config = HomepageConfig.objects.get(pk=1)
        self.assertIsNone(config.notice_ends_at)
        self.assertIsNotNone(config.notice_starts_at)

    def test_concurrent_first_creation_yields_a_single_row(self):
        HomepageConfig.objects.all().delete()
        errors = []
        barrier = threading.Barrier(6)

        def load():
            try:
                barrier.wait(5)
                HomepageConfig.load()
            except Exception as exc:  # noqa: BLE001
                errors.append(repr(exc))
            finally:
                close_old_connections()
                connection.close()

        threads = [threading.Thread(target=load) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(15)
        self.assertEqual(errors, [])
        self.assertEqual(HomepageConfig.objects.count(), 1)
        self.assertEqual(HomepageConfig.objects.get().pk, 1)
