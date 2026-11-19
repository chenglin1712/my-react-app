"""F8：後台並行編輯不能互相覆蓋（首頁設定、限流規則；待審修訂見 test_revisions.RevisionResubmitConflictTest）。

以前的問題：後端有鎖（select_for_update），但沒有比對版本，兩個人同時開著同一個頁面，
後存的人會無聲蓋掉先存的。現在整份表單的儲存要帶載入時的 updated_at（base_updated_at），
期間若有別人先存過就回 409，做法與 site_page_views 相同。
沒帶 base_updated_at 的請求（只改單一欄位的小工具，例如宣傳影片的啟用開關）不檢查，維持原本行為。
"""
import json
from contextlib import contextmanager
from datetime import timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, SimpleTestCase, TestCase
from django.test.utils import override_settings
from django.utils.dateparse import parse_datetime

from adminapi._shared import stale_edit_response
from adminapi.auth_fixtures import fresh_auth
from config.roles import OWNER

from .models import AuditLog, HomepageConfig, RateLimitRule


@contextmanager
def _as_owner(uid="test-uid"):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth({"uid": uid, "role": OWNER})):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _patch(client, url, payload):
    with _as_owner() as headers:
        return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


def _get(client, url):
    with _as_owner() as headers:
        return client.get(url, **headers)


class StaleEditHelperTest(SimpleTestCase):
    NOW = parse_datetime("2026-11-20T10:00:00.123456+00:00")

    def test_no_base_means_no_check(self):
        self.assertIsNone(stale_edit_response({}, self.NOW))
        self.assertIsNone(stale_edit_response({"tagline": "x"}, self.NOW))

    def test_non_dict_body_means_no_check(self):
        for body in (None, [], "x", 5):
            self.assertIsNone(stale_edit_response(body, self.NOW))

    def test_same_instant_passes_even_in_another_utc_offset(self):
        base = self.NOW.astimezone(dt_timezone(timedelta(hours=8))).isoformat()
        self.assertIsNone(stale_edit_response({"base_updated_at": base}, self.NOW))

    def test_microsecond_difference_is_a_conflict(self):
        base = (self.NOW + timedelta(microseconds=1)).isoformat()
        response = stale_edit_response({"base_updated_at": base}, self.NOW)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "edit_conflict")

    def test_malformed_values_are_400(self):
        for bad in ("", "不是時間", "2026-13-45T99:99:99Z", 123, None, ["x"], {"a": 1}, True):
            response = stale_edit_response({"base_updated_at": bad}, self.NOW)
            self.assertEqual(response.status_code, 400, bad)


class HomepageConfigConflictTest(TestCase):
    URL = "/adminapi/homepage-config/"

    def setUp(self):
        self.client = Client()
        cache.clear()
        HomepageConfig.load()

    def tearDown(self):
        cache.clear()

    def _loaded(self):
        return _get(self.client, self.URL).json()

    def _config(self):
        return HomepageConfig.objects.get(pk=1)

    def test_saving_with_the_loaded_updated_at_succeeds_and_returns_a_new_one(self):
        loaded = self._loaded()
        response = _patch(self.client, self.URL, {"tagline": "我的標語", "base_updated_at": loaded["updated_at"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tagline"], "我的標語")
        self.assertNotEqual(response.json()["updated_at"], loaded["updated_at"])

    def test_second_editor_with_a_stale_base_gets_409_and_the_first_change_survives(self):
        loaded_a = self._loaded()
        loaded_b = self._loaded()                              # 兩個人同時載入同一份
        first = _patch(self.client, self.URL, {"tagline": "先存的", "base_updated_at": loaded_a["updated_at"]})
        self.assertEqual(first.status_code, 200)
        before_logs = AuditLog.objects.count()

        second = _patch(self.client, self.URL, {"tagline": "後存的", "base_updated_at": loaded_b["updated_at"]})

        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["code"], "edit_conflict")
        self.assertEqual(self._config().tagline, "先存的")
        self.assertEqual(AuditLog.objects.count(), before_logs)   # 被擋下的儲存不留稽核紀錄

    def test_after_a_conflict_reloading_and_saving_again_works(self):
        stale = self._loaded()["updated_at"]
        _patch(self.client, self.URL, {"tagline": "別人改的", "base_updated_at": stale})
        self.assertEqual(_patch(self.client, self.URL, {"tagline": "我的", "base_updated_at": stale}).status_code, 409)
        fresh = self._loaded()["updated_at"]
        retry = _patch(self.client, self.URL, {"tagline": "我的", "base_updated_at": fresh})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(self._config().tagline, "我的")

    def test_a_save_by_anyone_moves_updated_at_so_an_old_page_is_refused(self):
        stale = self._loaded()["updated_at"]
        _patch(self.client, self.URL, {"show_news_section": False})        # 單一欄位、沒帶 base：別的小工具
        response = _patch(self.client, self.URL, {"tagline": "舊頁面存的", "base_updated_at": stale})
        self.assertEqual(response.status_code, 409)

    def test_requests_without_base_updated_at_still_work_for_single_field_tools(self):
        response = _patch(self.client, self.URL, {"active_promo_video": None})
        self.assertEqual(response.status_code, 200)
        response = _patch(self.client, self.URL, {"show_news_section": False, "news_display_count": 9})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._config().news_display_count, 9)

    def test_malformed_base_updated_at_is_400_and_changes_nothing(self):
        before = self._config().tagline
        for bad in ("", "不是時間", "2026-13-45T99:99:99Z", 123, None):
            response = _patch(self.client, self.URL, {"tagline": "不該寫入", "base_updated_at": bad})
            self.assertEqual(response.status_code, 400, bad)
        self.assertEqual(self._config().tagline, before)

    def test_base_in_another_utc_offset_for_the_same_instant_is_accepted(self):
        updated_at = parse_datetime(self._loaded()["updated_at"])
        shifted = updated_at.astimezone(dt_timezone(timedelta(hours=8))).isoformat()
        response = _patch(self.client, self.URL, {"tagline": "換時區", "base_updated_at": shifted})
        self.assertEqual(response.status_code, 200)

    def test_base_updated_at_is_not_treated_as_a_config_field(self):
        loaded = self._loaded()
        response = _patch(self.client, self.URL, {"tagline": "x", "base_updated_at": loaded["updated_at"]})
        self.assertNotIn("base_updated_at", response.json())


class RateLimitRuleConflictTest(TestCase):
    def setUp(self):
        self.client = Client()
        cache.clear()
        # key 刻意用不會被真實呼叫點用到的名稱，免得 get_configured_rate 的快取影響別的測試檔
        self.rule = RateLimitRule.objects.create(
            key="f8_conflict_probe", backend=RateLimitRule.BACKEND_DJANGO,
            rate="30/m", default_rate="30/m", description="F8 測試用",
        )
        self.url = f"/adminapi/rate-limit-rules/{self.rule.pk}/"

    def tearDown(self):
        cache.clear()

    def _loaded(self):
        return _get(self.client, self.url).json()

    def _rate(self):
        return RateLimitRule.objects.get(pk=self.rule.pk).rate

    def test_saving_with_the_loaded_updated_at_succeeds(self):
        loaded = self._loaded()
        response = _patch(self.client, self.url, {"rate": "20/m", "base_updated_at": loaded["updated_at"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._rate(), "20/m")

    def test_second_editor_with_a_stale_base_gets_409_and_the_first_change_survives(self):
        loaded_a = self._loaded()
        loaded_b = self._loaded()
        self.assertEqual(_patch(self.client, self.url, {"rate": "10/m", "base_updated_at": loaded_a["updated_at"]}).status_code, 200)
        before_logs = AuditLog.objects.count()

        second = _patch(self.client, self.url, {"rate": "99/m", "base_updated_at": loaded_b["updated_at"]})

        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["code"], "edit_conflict")
        self.assertEqual(self._rate(), "10/m")
        self.assertEqual(AuditLog.objects.count(), before_logs)

    def test_reload_then_save_works_after_a_conflict(self):
        stale = self._loaded()["updated_at"]
        _patch(self.client, self.url, {"rate": "10/m", "base_updated_at": stale})
        self.assertEqual(_patch(self.client, self.url, {"rate": "99/m", "base_updated_at": stale}).status_code, 409)
        retry = _patch(self.client, self.url, {"rate": "99/m", "base_updated_at": self._loaded()["updated_at"]})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(self._rate(), "99/m")

    def test_requests_without_base_updated_at_keep_working(self):
        self.assertEqual(_patch(self.client, self.url, {"rate": "15/m"}).status_code, 200)
        self.assertEqual(self._rate(), "15/m")

    def test_malformed_base_updated_at_is_400_and_changes_nothing(self):
        for bad in ("", "不是時間", 123, None):
            response = _patch(self.client, self.url, {"rate": "1/m", "base_updated_at": bad})
            self.assertEqual(response.status_code, 400, bad)
        self.assertEqual(self._rate(), "30/m")

    def test_a_conflict_on_one_rule_does_not_depend_on_other_rules(self):
        other = RateLimitRule.objects.create(
            key="f8_conflict_other", backend=RateLimitRule.BACKEND_DJANGO,
            rate="5/m", default_rate="5/m", description="F8 測試用",
        )
        loaded = self._loaded()
        _patch(self.client, f"/adminapi/rate-limit-rules/{other.pk}/", {"rate": "6/m"})   # 別條規則被改，不影響這一條
        response = _patch(self.client, self.url, {"rate": "25/m", "base_updated_at": loaded["updated_at"]})
        self.assertEqual(response.status_code, 200)
