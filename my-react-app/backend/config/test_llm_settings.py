"""config/llm_settings.py：各功能的模型、effort、max_tokens 如何從環境變數與預設值決定。"""
import os
from unittest import TestCase
from unittest.mock import patch

from config import llm_settings
from config.llm_settings import get_settings


def _env(**overrides):
    """乾淨的環境變數：先移除所有 LLM_ 開頭的，再套用 overrides（避免開發者本機 .env 影響結果）。"""
    clean = {k: v for k, v in os.environ.items() if not k.startswith("LLM_")}
    clean.update(overrides)
    return patch.dict(os.environ, clean, clear=True)


class DefaultsTests(TestCase):
    def test_defaults_per_feature(self):
        with _env():
            chat, review, translate = get_settings("chat"), get_settings("review"), get_settings("translate")
        self.assertEqual((chat.effort, chat.max_tokens), ("medium", 4096))
        self.assertEqual((review.effort, review.max_tokens), ("low", 1024))
        # 翻譯品質是核心，不擅自降低 effort：維持模型預設（不傳）。
        self.assertEqual((translate.effort, translate.max_tokens), (None, 4096))
        for s in (chat, review, translate):
            self.assertEqual(s.model, llm_settings.DEFAULT_MODEL)

    def test_unknown_feature_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            get_settings("nope")


class ModelResolutionTests(TestCase):
    def test_global_model_applies_to_every_feature(self):
        with _env(LLM_MODEL="claude-sonnet-5-5"):
            self.assertEqual({get_settings(f).model for f in llm_settings.FEATURES}, {"claude-sonnet-5-5"})

    def test_feature_model_beats_global_model(self):
        with _env(LLM_MODEL="claude-sonnet-5-5", LLM_MODEL_REVIEW="claude-haiku-5-5"):
            self.assertEqual(get_settings("review").model, "claude-haiku-5-5")
            self.assertEqual(get_settings("chat").model, "claude-sonnet-5-5")

    def test_blank_values_fall_back(self):
        with _env(LLM_MODEL="   ", LLM_MODEL_CHAT=""):
            self.assertEqual(get_settings("chat").model, llm_settings.DEFAULT_MODEL)


class EffortTests(TestCase):
    def test_valid_effort_overrides_default(self):
        with _env(LLM_EFFORT_TRANSLATE="High"):
            self.assertEqual(get_settings("translate").effort, "high")

    def test_empty_or_default_means_do_not_send(self):
        for raw in ("", "default", "  DEFAULT "):
            with _env(LLM_EFFORT_CHAT=raw):
                self.assertIsNone(get_settings("chat").effort, raw)

    def test_invalid_effort_falls_back_to_the_feature_default_and_warns(self):
        with _env(LLM_EFFORT_CHAT="turbo"):
            with self.assertLogs("config.llm_settings", level="WARNING"):
                self.assertEqual(get_settings("chat").effort, "medium")


class MaxTokensTests(TestCase):
    def test_valid_value_overrides_default(self):
        with _env(LLM_MAX_TOKENS_CHAT="3000"):
            self.assertEqual(get_settings("chat").max_tokens, 3000)

    def test_invalid_values_fall_back_and_warn(self):
        for raw in ("abc", "0", "10", "999999", "-5"):
            with _env(LLM_MAX_TOKENS_CHAT=raw):
                with self.assertLogs("config.llm_settings", level="WARNING"):
                    self.assertEqual(get_settings("chat").max_tokens, 4096, raw)

    def test_blank_value_uses_default_silently(self):
        with _env(LLM_MAX_TOKENS_CHAT=" "):
            self.assertEqual(get_settings("chat").max_tokens, 4096)
