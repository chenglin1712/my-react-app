"""辭典詞條 payload 葉節點的型別與長度驗證（稽核 FLW-5）。

葉節點（file_id、image_url、各層子節點 id…）過去只檢查「是不是 dict」，型別不對的值會一路撐到
dictionary_write 綁進 SQL 才爆，變成 500 而不是乾淨的 400。純函式測試，不碰資料庫。
"""
from django.test import SimpleTestCase

from .dictionary_serializers import (
    MAX_ID_LENGTH, MAX_LIST_LENGTH, MAX_URL_LENGTH, validate_word_bundle_entry, validate_word_tree_payload,
)


def _word(**overrides):
    base = {"tribe_id": "tribe-tayal", "name": "huzil", "explanations": [{"chinese_explanation": "狗"}]}
    base.update(overrides)
    return base


def _with_explanation(**fields):
    return _word(explanations=[{"chinese_explanation": "狗", **fields}])


class LeafValidationTest(SimpleTestCase):
    def assertRejected(self, payload, key_fragment):
        cleaned, errors = validate_word_tree_payload(payload)
        self.assertIsNone(cleaned)
        self.assertTrue(any(key_fragment in key for key in errors), (key_fragment, errors))

    def test_well_formed_payload_still_passes(self):
        payload = _word(
            audios=[{"id": 3, "external_id": "e1", "file_id": "f1", "audio_class": "word"}],
            explanations=[{
                "id": 7, "chinese_explanation": "狗",
                "images": [{"id": None, "image_url": "https://example.com/a.png"}],
                "sentences": [{
                    "id": 9, "original_sentence": "x", "chinese_sentence": "y", "english_sentence": "z",
                    "audios": [{"file_id": "f2"}],
                    "anaphoras": [{"id": 1, "items": [{"id": 2, "word_id": None, "name": "n"}]}],
                }],
            }],
        )
        cleaned, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors, {})
        self.assertIsNotNone(cleaned)

    def test_non_string_leaf_values_are_rejected(self):
        self.assertRejected(_word(audios=[{"file_id": {"x": 1}}]), "audios[0].file_id")
        self.assertRejected(_word(audios=[{"audio_class": ["a"]}]), "audios[0].audio_class")
        self.assertRejected(_word(audios=[{"external_id": 5}]), "audios[0].external_id")
        self.assertRejected(_with_explanation(images=[{"image_url": 123}]), "image_url")
        self.assertRejected(_with_explanation(sentences=[{"chinese_sentence": ["x"]}]), "chinese_sentence")
        self.assertRejected(_with_explanation(sentences=[{"english_sentence": 1}]), "english_sentence")
        self.assertRejected(_with_explanation(sentences=[{"audios": [{"file_id": 7}]}]), "file_id")

    def test_child_ids_must_be_integers_or_null(self):
        self.assertRejected(_word(audios=[{"id": [1]}]), "audios[0].id")
        self.assertRejected(_word(audios=[{"id": {"a": 1}}]), "audios[0].id")
        self.assertRejected(_word(audios=[{"id": True}]), "audios[0].id")
        self.assertRejected(_word(audios=[{"id": "7"}]), "audios[0].id")
        self.assertRejected(_with_explanation(id=[1]), "explanations[0].id")
        self.assertRejected(_with_explanation(images=[{"id": "x"}]), "images[0].id")
        self.assertRejected(_with_explanation(sentences=[{"id": [2]}]), "sentences[0].id")
        self.assertRejected(_with_explanation(sentences=[{"anaphoras": [{"id": {}}]}]), "anaphoras[0].id")
        self.assertRejected(_with_explanation(sentences=[{"anaphoras": [{"items": [{"id": []}]}]}]), "items[0].id")

    def test_overlong_values_are_rejected(self):
        self.assertRejected(_word(audios=[{"file_id": "x" * (MAX_ID_LENGTH + 1)}]), "file_id")
        self.assertRejected(_with_explanation(images=[{"image_url": "x" * (MAX_URL_LENGTH + 1)}]), "image_url")
        self.assertRejected(_word(name="x" * 501), "name")
        self.assertRejected(_word(word_img="x" * (MAX_URL_LENGTH + 1)), "word_img")

    def test_too_many_children_are_rejected(self):
        self.assertRejected(_word(audios=[{}] * (MAX_LIST_LENGTH + 1)), "audios")
        self.assertRejected(_word(explanations=[{"chinese_explanation": "x"}] * 101), "explanations")
        self.assertRejected(_with_explanation(images=[{}] * (MAX_LIST_LENGTH + 1)), "images")

    def test_boolean_frequency_is_rejected(self):
        self.assertRejected(_word(frequency=True), "frequency")

    def test_bundle_mode_uses_the_same_leaf_rules(self):
        cleaned, errors = validate_word_bundle_entry({"name": "huzil", "audios": [{"file_id": {"x": 1}}]})
        self.assertIsNone(cleaned)
        self.assertIn("audios[0].file_id", errors)
