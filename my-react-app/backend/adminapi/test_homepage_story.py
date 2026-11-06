"""首頁捲動敘事「一個詞的旅程」欄位（Apple 化步驟 5-5，HOMEPAGE_CONTRACT.md 3.5、4.1）。

欄位：story_enabled（預設開）、story_kicker、story_steps（空清單 = 前台用內建預設文案；有內容時 3 到 6 步）。
公開端點輸出 story {enabled, kicker, steps}；關閉時 {enabled: false, kicker: "", steps: []}，內容不外洩。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import EDITOR, OWNER

from .models import AuditLog, HomepageConfig
from .validators import normalize_story_steps, validate_story_steps

PUBLIC_URL = "/adminapi/public/homepage-config/"
ADMIN_URL = "/adminapi/homepage-config/"


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid", "role": role}
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def step(n=1, **over):
    base = {"glyph": f"字{n}", "title": f"標題{n}", "text": f"說明文字{n}", "pattern": "stripe"}
    base.update(over)
    return base


def steps(count):
    patterns = ("stripe", "vertical", "dots", "grid", "stripe", "vertical")
    return [step(i + 1, pattern=patterns[i % len(patterns)]) for i in range(count)]


class StoryValidatorTest(TestCase):
    def test_empty_list_means_use_defaults(self):
        validate_story_steps([])

    def test_three_to_six_steps_are_valid(self):
        for count in (3, 4, 5, 6):
            validate_story_steps(steps(count))

    def test_step_count_outside_range_is_rejected(self):
        for count in (1, 2, 7):
            with self.assertRaises(ValidationError, msg=count):
                validate_story_steps(steps(count))

    def test_not_a_list_or_item_not_a_dict(self):
        for bad in ({}, "文字", None, 3, ["a", "b", "c"], [step(), step(), 5]):
            with self.assertRaises(ValidationError, msg=repr(bad)):
                validate_story_steps(bad)

    def test_length_limits_are_inclusive(self):
        ok = [step(1, glyph="一二三四", title="標" * 16, text="說" * 80), step(2), step(3)]
        validate_story_steps(ok)
        for field, too_long in (("glyph", "一二三四五"), ("title", "標" * 17), ("text", "說" * 81)):
            bad = [step(1, **{field: too_long}), step(2), step(3)]
            with self.assertRaises(ValidationError, msg=field):
                validate_story_steps(bad)

    def test_blank_or_missing_or_non_string_fields_are_rejected(self):
        for field in ("glyph", "title", "text"):
            for value in ("", "   ", 5, None):
                with self.assertRaises(ValidationError, msg=(field, value)):
                    validate_story_steps([step(1, **{field: value}), step(2), step(3)])
            missing = step(1)
            del missing[field]
            with self.assertRaises(ValidationError, msg=field):
                validate_story_steps([missing, step(2), step(3)])
        missing_pattern = step(1)
        del missing_pattern["pattern"]
        with self.assertRaises(ValidationError):
            validate_story_steps([missing_pattern, step(2), step(3)])

    def test_pattern_must_be_one_of_the_four_codes(self):
        for pattern in ("diagonal", "", "STRIPE", None, 1):
            with self.assertRaises(ValidationError, msg=repr(pattern)):
                validate_story_steps([step(1, pattern=pattern), step(2), step(3)])

    def test_unknown_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            validate_story_steps([step(1, href="javascript:alert(1)"), step(2), step(3)])

    def test_newlines_controls_and_invisible_characters_are_rejected(self):
        for bad in ("兩行\n文字", "含\x1b", "零寬​字", "雙向‮字"):
            with self.assertRaises(ValidationError, msg=repr(bad)):
                validate_story_steps([step(1, text=bad), step(2), step(3)])

    def test_normalize_trims_text_and_keeps_extras_so_validation_can_reject_them(self):
        out = normalize_story_steps([{"glyph": " 遇見 ", "title": " 查 ", "text": " 說 ", "pattern": "dots", "x": 1}])
        self.assertEqual(out[0], {"glyph": "遇見", "title": "查", "text": "說", "pattern": "dots", "x": 1})
        self.assertEqual(normalize_story_steps("不是清單"), "不是清單")
        self.assertEqual(normalize_story_steps(["a"]), ["a"])

    def test_model_field_runs_the_validator(self):
        config = HomepageConfig.load()
        config.story_steps = steps(2)
        with self.assertRaises(ValidationError):
            config.full_clean()
        config.story_steps = steps(4)
        config.story_kicker = "x" * 21
        with self.assertRaises(ValidationError):
            config.full_clean()


class StoryDefaultsTest(TestCase):
    def test_defaults(self):
        config = HomepageConfig.load()
        self.assertTrue(config.story_enabled)
        self.assertEqual(config.story_kicker, "")
        self.assertEqual(config.story_steps, [])


class StoryAdminApiTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _patch(self, payload, role=OWNER):
        with _as_role(role) as headers:
            return self.client.patch(ADMIN_URL, data=json.dumps(payload), content_type="application/json", **headers)

    def test_admin_get_includes_story_fields_with_defaults(self):
        with _as_role(OWNER) as headers:
            data = self.client.get(ADMIN_URL, **headers).json()
        self.assertEqual((data["story_enabled"], data["story_kicker"], data["story_steps"]), (True, "", []))

    def test_owner_saves_steps_and_they_persist_trimmed(self):
        payload = {"story_kicker": " 詞的旅程 ", "story_steps": [step(1, glyph=" 遇見 "), step(2), step(3), step(4)]}
        response = self._patch(payload)
        self.assertEqual(response.status_code, 200, response.content)
        config = HomepageConfig.load()
        self.assertEqual(config.story_kicker, "詞的旅程")
        self.assertEqual(config.story_steps[0]["glyph"], "遇見")
        self.assertEqual(len(config.story_steps), 4)

    def test_invalid_steps_are_400_and_nothing_is_saved(self):
        for payload in (
            {"story_steps": steps(2)},
            {"story_steps": steps(7)},
            {"story_steps": [step(1, pattern="x"), step(2), step(3)]},
            {"story_steps": [step(1, text="")]},
            {"story_steps": "不是清單"},
            {"story_kicker": "x" * 21},
            {"story_kicker": "兩行\n文字"},
        ):
            response = self._patch(payload)
            self.assertEqual(response.status_code, 400, payload)
        config = HomepageConfig.load()
        self.assertEqual(config.story_steps, [])
        self.assertEqual(config.story_kicker, "")

    def test_empty_list_resets_to_defaults(self):
        self._patch({"story_steps": steps(4)})
        self.assertEqual(self._patch({"story_steps": []}).status_code, 200)
        self.assertEqual(HomepageConfig.load().story_steps, [])

    def test_switch_can_be_turned_off_and_on(self):
        self.assertEqual(self._patch({"story_enabled": False}).status_code, 200)
        self.assertFalse(HomepageConfig.load().story_enabled)
        self.assertEqual(self._patch({"story_enabled": True}).status_code, 200)
        self.assertTrue(HomepageConfig.load().story_enabled)

    def test_editor_cannot_write(self):
        self.assertEqual(self._patch({"story_enabled": False}, role=EDITOR).status_code, 403)
        self.assertTrue(HomepageConfig.load().story_enabled)

    def test_other_fields_are_untouched(self):
        config = HomepageConfig.load()
        config.tagline = "標語"
        config.save()
        self._patch({"story_steps": steps(3)})
        self.assertEqual(HomepageConfig.load().tagline, "標語")

    def test_audit_log_records_story_changes(self):
        self._patch({"story_kicker": "旅程"})
        log = AuditLog.objects.filter(target_type="homepage_config").latest("id")
        self.assertEqual(log.before["story_kicker"], "")
        self.assertEqual(log.after["story_kicker"], "旅程")


class StoryPublicApiTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _save(self, **kwargs):
        config = HomepageConfig.load()
        for key, value in kwargs.items():
            setattr(config, key, value)
        config.save()

    def test_default_is_enabled_with_empty_steps_so_the_front_uses_its_own_copy(self):
        story = self.client.get(PUBLIC_URL).json()["story"]
        self.assertEqual(story, {"enabled": True, "kicker": "", "steps": []})

    def test_custom_steps_are_exposed_and_raw_fields_are_not(self):
        self._save(story_kicker="旅程", story_steps=steps(3))
        data = self.client.get(PUBLIC_URL).json()
        self.assertEqual(data["story"]["kicker"], "旅程")
        self.assertEqual(data["story"]["steps"], steps(3))
        for raw in ("story_enabled", "story_kicker", "story_steps"):
            self.assertNotIn(raw, data)

    def test_disabled_hides_the_content_and_does_not_leak_it(self):
        self._save(story_enabled=False, story_kicker="隱藏中的小標", story_steps=[step(1, title="不該外洩"), step(2), step(3)])
        response = self.client.get(PUBLIC_URL)
        self.assertEqual(response.json()["story"], {"enabled": False, "kicker": "", "steps": []})
        self.assertNotIn("不該外洩", response.content.decode())
        self.assertNotIn("隱藏中的小標", response.content.decode())

    def test_admin_save_is_visible_on_the_next_public_read(self):
        with _as_role(OWNER) as headers:
            self.client.patch(ADMIN_URL, data=json.dumps({"story_steps": steps(5)}), content_type="application/json", **headers)
        self.assertEqual(len(self.client.get(PUBLIC_URL).json()["story"]["steps"]), 5)
        self.assertEqual(self.client.get(PUBLIC_URL)["Cache-Control"], "no-cache")
