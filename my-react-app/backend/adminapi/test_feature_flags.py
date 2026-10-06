import json
from contextlib import contextmanager
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import override_settings

from config.roles import ADMIN, ANALYST, EDITOR, OWNER

from .models import AuditLog, FeatureFlag


@contextmanager
def _as_role(role):
    """跟 test_quizbank.py 的 _as_role 完全一樣。"""
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=decoded):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _patch_json(client, url, headers, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


class FeatureFlagAdminTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.flag = FeatureFlag.objects.create(
            key="quiz_enabled_tayal", label="泰雅語測驗", description="關閉後泰雅語測驗回 403", enabled=True,
        )

    def test_staff_can_list(self):
        with _as_role(ANALYST) as headers:
            response = self.client.get('/adminapi/feature-flags/', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_learner_without_staff_role_cannot_list(self):
        with _as_role(None) as headers:
            response = self.client.get('/adminapi/feature-flags/', **headers)
        self.assertEqual(response.status_code, 403)

    def test_only_publishers_can_toggle(self):
        with _as_role(EDITOR) as headers:
            response = _patch_json(
                self.client, f'/adminapi/feature-flags/{self.flag.pk}/', headers, {"enabled": False},
            )
        self.assertEqual(response.status_code, 403)

        with _as_role(ADMIN) as headers:
            response = _patch_json(
                self.client, f'/adminapi/feature-flags/{self.flag.pk}/', headers, {"enabled": False},
            )
        self.assertEqual(response.status_code, 200)
        self.flag.refresh_from_db()
        self.assertFalse(self.flag.enabled)

    def test_key_and_label_are_read_only(self):
        with _as_role(OWNER) as headers:
            response = _patch_json(
                self.client, f'/adminapi/feature-flags/{self.flag.pk}/', headers,
                {"enabled": False, "key": "hacked_key", "label": "改過的名稱"},
            )
        self.assertEqual(response.status_code, 200)
        self.flag.refresh_from_db()
        self.assertEqual(self.flag.key, "quiz_enabled_tayal")
        self.assertEqual(self.flag.label, "泰雅語測驗")

    def test_update_writes_audit_log(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, f'/adminapi/feature-flags/{self.flag.pk}/', headers, {"enabled": False})
        log = AuditLog.objects.filter(target_type="feature_flag", action="update").first()
        self.assertIsNotNone(log)


class SeedFeatureFlagsTest(TestCase):
    """seed_feature_flags：詞形分析器的兩個旗標必須預設【關閉】（跟其他旗標預設啟用相反）——
    這個功能會讓更多詞被判成有佐證，錯放行比漏判嚴重，必須明確打開才生效。"""

    MORPH_KEYS = ("translation_morphology_shadow", "translation_morphology_analyzer", "quiz_morphology_distractors")

    def _seed(self):
        from io import StringIO

        from django.core.management import call_command
        call_command("seed_feature_flags", stdout=StringIO())

    def test_morphology_flags_are_seeded_disabled_and_the_others_stay_enabled(self):
        self._seed()
        for key in self.MORPH_KEYS:
            self.assertFalse(FeatureFlag.objects.get(key=key).enabled, key)
        self.assertTrue(FeatureFlag.objects.get(key="translation_enabled").enabled)
        self.assertTrue(FeatureFlag.objects.get(key="quiz_enabled_tayal").enabled)

    def test_every_seeded_flag_fits_the_model_field_limits(self):
        # description 欄位上限 200 字元：超過在 PostgreSQL 會直接報錯，種子指令就跑不完。
        self._seed()
        for flag in FeatureFlag.objects.all():
            flag.full_clean()

    def test_seeding_is_idempotent_and_never_overwrites_a_manual_toggle(self):
        self._seed()
        FeatureFlag.objects.filter(key=self.MORPH_KEYS[0]).update(enabled=True)
        before = FeatureFlag.objects.count()
        self._seed()
        self.assertEqual(FeatureFlag.objects.count(), before)
        self.assertTrue(FeatureFlag.objects.get(key=self.MORPH_KEYS[0]).enabled)

    def test_keys_match_the_constants_the_translation_service_reads(self):
        from fastAPI.routes.translation import morph
        from fastAPI.routes.quiz import distractors
        self.assertEqual({morph.FLAG_SHADOW, morph.FLAG_APPLY, distractors.FLAG}, set(self.MORPH_KEYS))
