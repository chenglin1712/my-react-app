"""O28：ai_quota 一次讀回六個旗標（原本各查一次），行為（含查不到列、預算超標）維持不變。"""
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext

from adminapi.models import FeatureFlag
from AIModel import flags as F
from AIModel.views import QUESTION_REVIEW_FLAG


def _set(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={"label": key, "description": "", "enabled": enabled})


def _flag_queries(ctx):
    return [q for q in ctx.captured_queries if "adminapi_featureflag" in q["sql"].lower()]


class LoadFlagsTest(TestCase):
    def test_returns_only_existing_rows_in_one_query(self):
        _set("a", True)
        _set("b", False)
        with CaptureQueriesContext(connection) as ctx:
            got = F.load_flags(["a", "b", "missing", "a"])
        self.assertEqual(got, {"a": True, "b": False})
        self.assertEqual(len(_flag_queries(ctx)), 1)

    def test_fail_closed_helper_matches_the_old_per_flag_lookup(self):
        _set("on", True)
        _set("off", False)
        flags = F.load_flags(["on", "off", "gone"])
        for key, want in (("on", True), ("off", False), ("gone", False)):
            self.assertEqual(F.enabled_fail_closed(key, flags), want)
            self.assertEqual(F.enabled_fail_closed(key), want)       # 不給 flags 時照舊自己查，結果相同


class QuotaFlagQueriesTest(TestCase):
    def setUp(self):
        cache.clear()

    @patch("AIModel.views.load_profile", return_value=None)
    def test_quota_reads_all_flags_with_a_single_query(self, _profile):
        with CaptureQueriesContext(connection) as ctx:
            body = Client().get("/AIModel/quota/").json()
        self.assertEqual(len(_flag_queries(ctx)), 1)
        self.assertEqual(set(body["features"]), {"questionReview", "imageInput", "feedback", "planReplan", "weeklyDigest"})

    @patch("AIModel.views.load_profile", return_value=None)
    def test_features_follow_each_flag_and_the_master_switch(self, _profile):
        _set(QUESTION_REVIEW_FLAG, True)
        _set("ai_feedback_enabled", True)
        features = Client().get("/AIModel/quota/").json()["features"]
        self.assertTrue(features["questionReview"])
        self.assertTrue(features["feedback"])
        self.assertFalse(features["imageInput"])          # 沒有這一列＝關閉

        _set("ai_assistant_enabled", False)                # 總開關關：全部顯示關閉
        features = Client().get("/AIModel/quota/").json()["features"]
        self.assertFalse(any(features.values()))

    @patch("AIModel.views.load_profile", return_value=None)
    def test_missing_master_switch_row_counts_as_on(self, _profile):
        _set(QUESTION_REVIEW_FLAG, True)
        self.assertTrue(Client().get("/AIModel/quota/").json()["features"]["questionReview"])

    @patch("AIModel.views.load_profile", return_value=None)
    def test_budget_enforcement_runs_before_the_flags_are_read(self, _profile):
        _set("ai_assistant_enabled", True)
        _set(QUESTION_REVIEW_FLAG, True)
        calls = []

        def fake_enforce():
            calls.append("enforce")
            _set("ai_assistant_enabled", False)           # 預算超標：enforce 把總開關關掉

        with patch("adminapi.ai_budget.enforce", side_effect=fake_enforce):
            features = Client().get("/AIModel/quota/").json()["features"]
        self.assertEqual(calls, ["enforce"])               # 只做一次
        self.assertFalse(features["questionReview"])       # 讀旗標發生在 enforce 之後，看到的是關閉後的狀態


from django.test.utils import override_settings   # noqa: E402

from adminapi import ai_budget, flag_cache   # noqa: E402


@override_settings(FEATURE_FLAG_CACHE_SECONDS=30)
class FlagCacheTest(TestCase):
    """30 秒快取：讀取不重複查資料庫；後台切換與預算超標自動關閉都立刻生效。"""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_repeated_reads_hit_the_database_once(self):
        _set("x", True)
        flag_cache.invalidate()
        with CaptureQueriesContext(connection) as ctx:
            for _ in range(5):
                self.assertTrue(F.enabled_fail_closed("x"))
        self.assertEqual(len(_flag_queries(ctx)), 1)

    def test_saving_a_flag_takes_effect_immediately(self):
        _set("x", True)
        self.assertTrue(F.enabled_fail_closed("x"))
        _set("x", False)                    # 後台切換走 Model.save → 立刻清快取
        self.assertFalse(F.enabled_fail_closed("x"))
        FeatureFlag.objects.filter(key="x").delete()
        self.assertFalse(F.enabled_fail_closed("x"))

    def test_budget_auto_disable_takes_effect_immediately(self):
        _set("ai_assistant_enabled", True)
        self.assertTrue(F.load_flags(["ai_assistant_enabled"])["ai_assistant_enabled"])
        ai_budget._disable_flag("ai_assistant_enabled", {"budgetUsd": 1.0, "spentUsd": 2.0})   # queryset.update 路徑
        self.assertFalse(F.load_flags(["ai_assistant_enabled"])["ai_assistant_enabled"])

    def test_a_broken_cache_backend_falls_back_to_the_database(self):
        _set("x", True)
        with patch("adminapi.flag_cache.cache.get", side_effect=RuntimeError("redis down")), \
                patch("adminapi.flag_cache.cache.set", side_effect=RuntimeError("redis down")):
            self.assertTrue(F.enabled_fail_closed("x"))

    def test_the_default_for_tests_is_no_caching(self):
        with override_settings(FEATURE_FLAG_CACHE_SECONDS=0):
            _set("x", True)
            F.enabled_fail_closed("x")
            self.assertIsNone(cache.get(flag_cache.CACHE_KEY))


@override_settings(FEATURE_FLAG_CACHE_SECONDS=30)
class FlagCacheRaceTest(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_a_stale_value_written_back_after_invalidate_is_never_read(self):
        """讀者在變更提交前讀到舊值，變更與清除之後才寫回快取：寫回的是舊版本代號的 key，沒有人會讀到。"""
        _set("x", True)
        flag_cache.invalidate()
        real_query = flag_cache.FeatureFlag.objects.values_list
        stale = dict(real_query("key", "enabled"))                      # {"x": True}：讀者先查到的舊值

        original_set = cache.set
        state = {"done": False}

        def set_after_change(key, value, *a, **k):
            if not state["done"] and isinstance(value, dict) and "x" in value:
                state["done"] = True
                _set("x", False)                                        # 變更提交並換了新版本代號
            return original_set(key, value, *a, **k)

        with patch.object(flag_cache.FeatureFlag.objects, "values_list", return_value=stale.items()), \
                patch("adminapi.flag_cache.cache.set", side_effect=set_after_change):
            self.assertTrue(F.enabled_fail_closed("x"))                 # 這位讀者看到的是舊值（正常）
        self.assertFalse(F.enabled_fail_closed("x"))                    # 之後的讀者一定看到新值，不是被寫回的舊值

    def test_the_change_signals_are_registered_by_app_ready(self):
        from django.db.models.signals import post_save
        from adminapi.models import FeatureFlag
        self.assertTrue(post_save.has_listeners(FeatureFlag))
