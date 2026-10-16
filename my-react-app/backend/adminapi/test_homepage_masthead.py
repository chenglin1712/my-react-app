"""S3-2 首頁報頭與跑馬燈欄位：標語、引言、跑馬燈項目與各自的顯示開關。

契約見 HOMEPAGE_CONTRACT.md（第 3.1、4.1 節）。
"""
import json
from contextlib import contextmanager
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import ADMIN, ANALYST, EDITOR, OWNER

from .models import AuditLog, HomepageConfig
from .validators import MAX_MARQUEE_ITEM_LENGTH, MAX_MARQUEE_ITEMS

PUBLIC_URL = "/adminapi/public/homepage-config/"
ADMIN_URL = "/adminapi/homepage-config/"

LEGACY_PUBLIC_KEYS = {
    "hero_image_url", "hero_link_url", "hero_title_override",
    "show_news_section", "show_calendar_section", "news_display_count",
    "button1_enabled", "button2_enabled", "button3_enabled",
}
MASTHEAD_KEYS = {"marquee_items", "show_marquee", "tagline", "show_tagline", "quote_text", "show_quote"}


@contextmanager
def _as_role(role):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": "test-uid"}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _patch_json(client, url, headers, payload):
    return client.patch(url, data=json.dumps(payload), content_type="application/json", **headers)


class MastheadModelValidationTest(TestCase):
    def _config(self, **kwargs):
        config = HomepageConfig.load()
        for key, value in kwargs.items():
            setattr(config, key, value)
        return config

    def test_defaults_are_empty_and_toggles_are_on(self):
        config = HomepageConfig.load()
        self.assertEqual(config.marquee_items, [])
        self.assertEqual(config.tagline, "")
        self.assertEqual(config.quote_text, "")
        self.assertTrue(config.show_marquee)
        self.assertTrue(config.show_tagline)
        self.assertTrue(config.show_quote)
        config.full_clean()

    def test_marquee_default_list_is_not_shared_between_instances(self):
        first = HomepageConfig()
        second = HomepageConfig()
        first.marquee_items.append("x")
        self.assertEqual(second.marquee_items, [])

    def test_valid_marquee_items_pass(self):
        self._config(marquee_items=["第一項", "b" * MAX_MARQUEE_ITEM_LENGTH]).full_clean()
        self._config(marquee_items=["x"] * MAX_MARQUEE_ITEMS).full_clean()

    def test_invalid_marquee_items_are_rejected(self):
        bad = [
            "不是清單",
            {"a": 1},
            [1, 2],
            [None],
            [["巢狀"]],
            [""],
            ["   "],
            ["　"],
            ["字" * (MAX_MARQUEE_ITEM_LENGTH + 1)],
            ["第一行\n第二行"],
            ["含\x00空位元組"],
            ["x"] * (MAX_MARQUEE_ITEMS + 1),
        ]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    self._config(marquee_items=value).full_clean()

    def test_invisible_bidi_and_unicode_line_characters_are_rejected(self):
        bad_chars = {
            "零寬空格": "\u200b", "字詞連接器": "\u2060", "BOM": "\ufeff",
            "行分隔": "\u2028", "段分隔": "\u2029", "NEL": "\u0085", "C1": "\u009f",
            "LRM": "\u200e", "RLM": "\u200f", "RLO": "\u202e", "LRI": "\u2066", "PDI": "\u2069", "ALM": "\u061c",
        }
        for name, char in bad_chars.items():
            for label, build in (
                ("跑馬燈", lambda c: self._config(marquee_items=["前" + c + "後"])),
                ("跑馬燈整項只有它", lambda c: self._config(marquee_items=[c])),
                ("標語", lambda c: self._config(tagline="前" + c + "後")),
                ("引言", lambda c: self._config(quote_text="前" + c + "後")),
            ):
                with self.subTest(char=name, field=label):
                    with self.assertRaises(ValidationError):
                        build(char).full_clean()

    def test_combining_marks_and_normal_text_are_allowed(self):
        # 族語常見的組合符號（下點、底線、上標等）不能被誤擋；這裡只用通用的組合字元，不寫死任何族語詞。
        text = "a\u0323 e\u0331 o\u0332 n\u0307 \u00e9"
        self._config(marquee_items=[text], tagline=text, quote_text=text).full_clean()

    def test_zwnj_and_zwj_are_not_blocked(self):
        # 刻意放行：沒有查證過所有書寫系統是否用到，寧可放行（見 validators.py 註解）。
        self._config(tagline="a\u200cb\u200dc").full_clean()

    def test_length_counts_code_points_without_normalizing(self):
        decomposed = "e\u0301"  # 2 個碼位，顯示成 1 個字
        self.assertEqual(len(decomposed), 2)
        self._config(marquee_items=[decomposed * (MAX_MARQUEE_ITEM_LENGTH // 2)]).full_clean()
        with self.assertRaises(ValidationError):
            self._config(marquee_items=[decomposed * (MAX_MARQUEE_ITEM_LENGTH // 2 + 1)]).full_clean()

    def test_length_counts_after_trimming(self):
        self._config(marquee_items=["  " + "字" * MAX_MARQUEE_ITEM_LENGTH + "  "]).full_clean()

    def test_tagline_and_quote_limits(self):
        self._config(tagline="字" * 60, quote_text="字" * 120).full_clean()
        for kwargs in (
            {"tagline": "字" * 61},
            {"quote_text": "字" * 121},
            {"tagline": "第一行\n第二行"},
            {"quote_text": "第一行\n第二行"},
            {"tagline": "含\x00"},
            {"quote_text": "含\x1b"},
        ):
            with self.subTest(**{k: v[:6] for k, v in kwargs.items()}):
                with self.assertRaises(ValidationError):
                    self._config(**kwargs).full_clean()


class MastheadAdminApiTest(TestCase):
    def setUp(self):
        self.client = Client()

    def _patch(self, payload, role=OWNER):
        with _as_role(role) as headers:
            return _patch_json(self.client, ADMIN_URL, headers, payload)

    def test_admin_get_includes_new_fields_with_defaults(self):
        with _as_role(ANALYST) as headers:
            data = self.client.get(ADMIN_URL, **headers).json()
        self.assertTrue(MASTHEAD_KEYS.issubset(data.keys()))
        self.assertEqual(data["marquee_items"], [])
        self.assertEqual(data["tagline"], "")

    def test_owner_can_set_all_fields_and_they_persist(self):
        response = self._patch({
            "marquee_items": ["甲", "乙"], "show_marquee": False,
            "tagline": "標語文字", "show_tagline": False,
            "quote_text": "引言文字", "show_quote": False,
        })
        self.assertEqual(response.status_code, 200)
        config = HomepageConfig.load()
        self.assertEqual(config.marquee_items, ["甲", "乙"])
        self.assertFalse(config.show_marquee)
        self.assertEqual(config.tagline, "標語文字")
        self.assertFalse(config.show_tagline)
        self.assertEqual(config.quote_text, "引言文字")
        self.assertFalse(config.show_quote)

    def test_values_are_trimmed_before_saving(self):
        response = self._patch({
            "marquee_items": ["  甲  ", "　乙　"], "tagline": "  標語  ", "quote_text": "　引言　",
        })
        self.assertEqual(response.status_code, 200)
        config = HomepageConfig.load()
        self.assertEqual(config.marquee_items, ["甲", "乙"])
        self.assertEqual(config.tagline, "標語")
        self.assertEqual(config.quote_text, "引言")

    def test_stored_text_is_not_unicode_normalized(self):
        decomposed = "e\u0301"
        self._patch({"tagline": decomposed, "marquee_items": [decomposed]})
        config = HomepageConfig.load()
        self.assertEqual(config.tagline, decomposed)
        self.assertEqual(config.marquee_items, [decomposed])

    def test_unicode_tricks_are_400_over_the_api(self):
        for char in ("\u200b", "\u2028", "\u202e", "\ufeff"):
            for payload in ({"tagline": "前" + char + "後"}, {"marquee_items": [char]}, {"quote_text": "前" + char + "後"}):
                with self.subTest(char=repr(char), payload=list(payload)):
                    self.assertEqual(self._patch(payload).status_code, 400)
        self.assertEqual(HomepageConfig.load().tagline, "")

    def test_whitespace_only_tagline_becomes_empty(self):
        self._patch({"tagline": "標語"})
        self._patch({"tagline": "   "})
        self.assertEqual(HomepageConfig.load().tagline, "")

    def test_can_clear_everything(self):
        self._patch({"marquee_items": ["甲"], "tagline": "標語", "quote_text": "引言"})
        response = self._patch({"marquee_items": [], "tagline": "", "quote_text": ""})
        self.assertEqual(response.status_code, 200)
        config = HomepageConfig.load()
        self.assertEqual((config.marquee_items, config.tagline, config.quote_text), ([], "", ""))

    def test_invalid_values_are_400_with_field_errors_and_nothing_is_saved(self):
        cases = {
            "marquee_items": [
                "不是清單", [1], [""], ["   "], ["字" * (MAX_MARQUEE_ITEM_LENGTH + 1)],
                ["x"] * (MAX_MARQUEE_ITEMS + 1), ["第一行\n第二行"], None,
            ],
            "tagline": ["字" * 61, "兩行\n文字"],
            "quote_text": ["字" * 121, "兩行\n文字"],
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    response = self._patch({field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.json()["errors"])
        config = HomepageConfig.load()
        self.assertEqual((config.marquee_items, config.tagline, config.quote_text), ([], "", ""))

    def test_editor_cannot_write(self):
        response = self._patch({"tagline": "標語"}, role=EDITOR)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(HomepageConfig.load().tagline, "")

    def test_patching_one_field_leaves_the_others_alone(self):
        self._patch({"marquee_items": ["甲"], "tagline": "標語", "quote_text": "引言"})
        self._patch({"show_news_section": False})
        config = HomepageConfig.load()
        self.assertEqual(config.marquee_items, ["甲"])
        self.assertEqual(config.tagline, "標語")
        self.assertEqual(config.quote_text, "引言")

    def test_audit_log_records_before_and_after(self):
        self._patch({"tagline": "舊標語"})
        self._patch({"tagline": "新標語", "marquee_items": ["甲"]}, role=ADMIN)
        log = AuditLog.objects.filter(target_type="homepage_config", action="update").latest("pk")
        self.assertEqual(log.before["tagline"], "舊標語")
        self.assertEqual(log.after["tagline"], "新標語")
        self.assertEqual(log.before["marquee_items"], [])
        self.assertEqual(log.after["marquee_items"], ["甲"])


class MastheadPublicApiTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_defaults_keep_every_legacy_key_and_add_empty_masthead_fields(self):
        data = self.client.get(PUBLIC_URL).json()
        self.assertTrue(LEGACY_PUBLIC_KEYS.issubset(data.keys()))
        self.assertEqual(set(data.keys()), LEGACY_PUBLIC_KEYS | MASTHEAD_KEYS | {"promo_video"})
        self.assertEqual(data["marquee_items"], [])
        self.assertEqual(data["tagline"], "")
        self.assertEqual(data["quote_text"], "")
        self.assertTrue(data["show_marquee"] and data["show_tagline"] and data["show_quote"])

    def test_saved_values_are_exposed_when_toggles_are_on(self):
        config = HomepageConfig.load()
        config.marquee_items = ["甲", "乙"]
        config.tagline = "標語"
        config.quote_text = "引言"
        config.save()
        data = self.client.get(PUBLIC_URL).json()
        self.assertEqual(data["marquee_items"], ["甲", "乙"])
        self.assertEqual(data["tagline"], "標語")
        self.assertEqual(data["quote_text"], "引言")
        self.assertTrue(data["show_marquee"] and data["show_tagline"] and data["show_quote"])

    def test_hidden_content_is_not_leaked_but_stays_in_the_database(self):
        # 先存還沒要公開的文案、再關掉開關：公開端點不能讀到，後台仍看得到，重新開啟即發布。
        config = HomepageConfig.load()
        config.marquee_items = ["甲"]
        config.tagline = "草稿標語"
        config.quote_text = "草稿引言"
        config.show_marquee = config.show_tagline = config.show_quote = False
        config.save()
        data = self.client.get(PUBLIC_URL).json()
        self.assertEqual(data["marquee_items"], [])
        self.assertEqual(data["tagline"], "")
        self.assertEqual(data["quote_text"], "")
        self.assertFalse(data["show_marquee"] or data["show_tagline"] or data["show_quote"])
        self.assertNotIn("草稿", json.dumps(data, ensure_ascii=False))
        with _as_role(OWNER) as headers:
            admin_data = self.client.get(ADMIN_URL, **headers).json()
        self.assertEqual(admin_data["tagline"], "草稿標語")
        self.assertEqual(admin_data["marquee_items"], ["甲"])
        config.show_tagline = True
        config.save()
        self.assertEqual(self.client.get(PUBLIC_URL).json()["tagline"], "草稿標語")

    def test_each_toggle_only_hides_its_own_field(self):
        config = HomepageConfig.load()
        config.marquee_items = ["甲"]
        config.tagline = "標語"
        config.quote_text = "引言"
        config.show_tagline = False
        config.save()
        data = self.client.get(PUBLIC_URL).json()
        self.assertEqual(data["tagline"], "")
        self.assertEqual(data["marquee_items"], ["甲"])
        self.assertEqual(data["quote_text"], "引言")

    def test_admin_save_is_visible_on_the_next_public_read(self):
        with _as_role(OWNER) as headers:
            _patch_json(self.client, ADMIN_URL, headers, {"tagline": "第一版"})
        self.assertEqual(self.client.get(PUBLIC_URL).json()["tagline"], "第一版")
        with _as_role(OWNER) as headers:
            _patch_json(self.client, ADMIN_URL, headers, {"tagline": "第二版"})
        self.assertEqual(self.client.get(PUBLIC_URL).json()["tagline"], "第二版")

    def test_public_response_does_not_leak_admin_metadata(self):
        data = self.client.get(PUBLIC_URL).json()
        self.assertNotIn("updated_by", data)
        self.assertNotIn("updated_at", data)
        self.assertNotIn("active_promo_video", data)
