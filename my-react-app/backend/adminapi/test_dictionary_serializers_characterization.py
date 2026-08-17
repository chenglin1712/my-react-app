"""characterization tests：在重構 validate_word_tree_payload／
validate_word_bundle_entry 之前（P4 review BE-30），先把目前的行為（含每一條
巢狀錯誤訊息的確切 key／文字）鎖起來。

這兩個函式目前是兩份幾乎一模一樣的手寫遞迴驗證（explanation → sentence →
anaphora → anaphora item，四層），差異只在三處：(1) 頂層必填的是 tribe_id
（一般詞條樹）還是選填的 id（批次匯入）；(2) 分類參照用 category_ids 等
int id 陣列（嚴格檢查每個元素是不是整數）還是 category_names 等純陣列
（目前完全不檢查元素型別，刻意保留這個較寬鬆的行為——人工編輯匯入檔案時
ategory_names 允許不精確，交給後續 resolve_import_bundle() 用名稱比對）；
(3) 標註項目參照用 word_id（str 或 null）還是 word_name（str，允許空白，
選填）。BE-30 要把這兩份幾乎一樣的遞迴邏輯合併成一份、用這三個差異點當
參數，不是重新設計驗證規則本身——這份測試就是拿來證明合併前後行為完全
一致的基準線，兩邊的重構應該讓這份測試全部維持通過、一行都不用改。
"""
from django.test import SimpleTestCase

from .dictionary_serializers import validate_word_bundle_entry, validate_word_tree_payload


class ValidateWordTreePayloadTest(SimpleTestCase):
    def test_minimal_valid_payload_passes(self):
        payload = {"tribe_id": "tayal", "name": "balay"}
        cleaned, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors, {})
        self.assertIs(cleaned, payload)

    def test_non_dict_payload_returns_generic_detail_error(self):
        cleaned, errors = validate_word_tree_payload(["not", "a", "dict"])
        self.assertIsNone(cleaned)
        self.assertEqual(errors, {"detail": "請求格式錯誤"})

    def test_missing_required_top_level_fields(self):
        _, errors = validate_word_tree_payload({})
        self.assertEqual(errors["tribe_id"], "為必填")
        self.assertEqual(errors["name"], "為必填")

    def test_wrong_type_string_fields(self):
        payload = {
            "tribe_id": "tayal", "name": "balay",
            "dialect": 123, "pinyin": 123, "variant": 123,
            "formation_word": 123, "derivative_root": 123,
            "dictionary_note": 123, "word_img": 123,
        }
        _, errors = validate_word_tree_payload(payload)
        for field in ("dialect", "pinyin", "variant", "formation_word",
                      "derivative_root", "dictionary_note", "word_img"):
            self.assertEqual(errors[field], "必須是字串")

    def test_wrong_type_frequency(self):
        _, errors = validate_word_tree_payload({"tribe_id": "t", "name": "n", "frequency": "oops"})
        self.assertEqual(errors["frequency"], "必須是整數")

    def test_frequency_none_is_allowed(self):
        _, errors = validate_word_tree_payload({"tribe_id": "t", "name": "n", "frequency": None})
        self.assertNotIn("frequency", errors)

    def test_wrong_type_boolean_fields(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "is_derivative_root": "yes", "is_image": 1,
            "is_zuzucidian": "no", "is_other_dialect": 0,
        }
        _, errors = validate_word_tree_payload(payload)
        for field in ("is_derivative_root", "is_image", "is_zuzucidian", "is_other_dialect"):
            self.assertEqual(errors[field], "必須是布林值")

    def test_source_ids_must_be_list(self):
        _, errors = validate_word_tree_payload({"tribe_id": "t", "name": "n", "source_ids": "oops"})
        self.assertEqual(errors["source_ids"], "必須是陣列")

    def test_source_ids_rejects_non_int_and_bool_elements(self):
        _, errors = validate_word_tree_payload(
            {"tribe_id": "t", "name": "n", "source_ids": [1, "two", True, 4]}
        )
        self.assertEqual(errors["source_ids[1]"], "必須是整數")
        self.assertEqual(errors["source_ids[2]"], "必須是整數")
        self.assertNotIn("source_ids[0]", errors)
        self.assertNotIn("source_ids[3]", errors)

    def test_audios_must_be_list_of_dicts(self):
        _, errors = validate_word_tree_payload({"tribe_id": "t", "name": "n", "audios": "oops"})
        self.assertEqual(errors["audios"], "必須是陣列")

        _, errors = validate_word_tree_payload({"tribe_id": "t", "name": "n", "audios": [{"a": 1}, "oops"]})
        self.assertEqual(errors["audios[1]"], "格式錯誤")
        self.assertNotIn("audios[0]", errors)

    def test_explanations_not_dict_item(self):
        _, errors = validate_word_tree_payload(
            {"tribe_id": "t", "name": "n", "explanations": ["oops"]}
        )
        self.assertEqual(errors["explanations[0]"], "格式錯誤")

    def test_explanation_chinese_explanation_wrong_type(self):
        _, errors = validate_word_tree_payload(
            {"tribe_id": "t", "name": "n", "explanations": [{"chinese_explanation": 123}]}
        )
        self.assertEqual(errors["explanations[0].chinese_explanation"], "必須是字串")

    def test_explanation_category_ids_rejects_non_int(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"category_ids": [1, "two"], "pos_ids": [True], "focus_ids": "oops"}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].category_ids[1]"], "必須是整數")
        self.assertEqual(errors["explanations[0].pos_ids[0]"], "必須是整數")
        self.assertEqual(errors["explanations[0].focus_ids"], "必須是陣列")

    def test_explanation_images_must_be_list_of_dicts(self):
        payload = {"tribe_id": "t", "name": "n", "explanations": [{"images": [{"x": 1}, "oops"]}]}
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].images[1]"], "格式錯誤")

    def test_explanation_sentences_not_dict(self):
        payload = {"tribe_id": "t", "name": "n", "explanations": [{"sentences": ["oops"]}]}
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0]"], "格式錯誤")

    def test_sentence_original_sentence_wrong_type(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"original_sentence": 123}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0].original_sentence"], "必須是字串")

    def test_sentence_audios_not_dict(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"audios": ["oops"]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0].audios[0]"], "格式錯誤")

    def test_sentence_anaphoras_not_dict(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"anaphoras": ["oops"]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0].anaphoras[0]"], "格式錯誤")

    def test_anaphora_items_must_be_list(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [{"items": "oops"}]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0].anaphoras[0].items"], "必須是陣列")

    def test_anaphora_item_not_dict(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [{"items": ["oops"]}]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0].anaphoras[0].items[0]"], "格式錯誤")

    def test_anaphora_item_word_id_wrong_type(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [{"items": [{"word_id": 123}]}]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(
            errors["explanations[0].sentences[0].anaphoras[0].items[0].word_id"], "必須是字串或 null"
        )

    def test_anaphora_item_word_id_none_is_allowed(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [{"items": [{"word_id": None}]}]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors, {})

    def test_anaphora_item_name_wrong_type(self):
        payload = {
            "tribe_id": "t", "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [{"items": [{"name": 123}]}]}]}],
        }
        _, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors["explanations[0].sentences[0].anaphoras[0].items[0].name"], "必須是字串")

    def test_fully_populated_nested_payload_passes(self):
        payload = {
            "tribe_id": "tayal", "name": "balay", "dialect": "d", "frequency": 10,
            "is_derivative_root": True, "source_ids": [1, 2, 3],
            "audios": [{"url": "a.mp3"}],
            "explanations": [{
                "chinese_explanation": "真的",
                "category_ids": [1, 2], "pos_ids": [3], "focus_ids": [],
                "images": [{"url": "i.png"}],
                "sentences": [{
                    "original_sentence": "s1",
                    "audios": [{"url": "s.mp3"}],
                    "anaphoras": [{"items": [{"word_id": "w1", "name": "他"}, {"word_id": None, "name": ""}]}],
                }],
            }],
        }
        cleaned, errors = validate_word_tree_payload(payload)
        self.assertEqual(errors, {})
        self.assertIs(cleaned, payload)


class ValidateWordBundleEntryTest(SimpleTestCase):
    def test_minimal_valid_payload_passes(self):
        payload = {"name": "balay"}
        cleaned, errors = validate_word_bundle_entry(payload)
        self.assertEqual(errors, {})
        self.assertIs(cleaned, payload)

    def test_non_dict_payload_returns_generic_detail_error(self):
        # 跟 validate_word_tree_payload 不同：這裡的訊息是「格式錯誤」，
        # 不是「請求格式錯誤」——刻意保留這個既有的用字差異。
        cleaned, errors = validate_word_bundle_entry(["not", "a", "dict"])
        self.assertIsNone(cleaned)
        self.assertEqual(errors, {"detail": "格式錯誤"})

    def test_missing_name_is_required_but_no_tribe_id_field(self):
        _, errors = validate_word_bundle_entry({})
        self.assertEqual(errors["name"], "為必填")
        self.assertNotIn("tribe_id", errors)

    def test_id_field_wrong_type(self):
        _, errors = validate_word_bundle_entry({"name": "n", "id": 123})
        self.assertEqual(errors["id"], "必須是字串或 null")

    def test_id_field_none_and_string_are_allowed(self):
        _, errors = validate_word_bundle_entry({"name": "n", "id": None})
        self.assertNotIn("id", errors)
        _, errors = validate_word_bundle_entry({"name": "n", "id": "abc"})
        self.assertNotIn("id", errors)

    def test_wrong_type_string_fields(self):
        payload = {
            "name": "n",
            "dialect": 123, "pinyin": 123, "variant": 123,
            "formation_word": 123, "derivative_root": 123,
            "dictionary_note": 123, "word_img": 123,
        }
        _, errors = validate_word_bundle_entry(payload)
        for field in ("dialect", "pinyin", "variant", "formation_word",
                      "derivative_root", "dictionary_note", "word_img"):
            self.assertEqual(errors[field], "必須是字串")

    def test_wrong_type_frequency_and_boolean_fields(self):
        payload = {
            "name": "n", "frequency": "oops",
            "is_derivative_root": "yes", "is_image": 1,
            "is_zuzucidian": "no", "is_other_dialect": 0,
        }
        _, errors = validate_word_bundle_entry(payload)
        self.assertEqual(errors["frequency"], "必須是整數")
        for field in ("is_derivative_root", "is_image", "is_zuzucidian", "is_other_dialect"):
            self.assertEqual(errors[field], "必須是布林值")

    def test_source_names_must_be_list_but_element_type_is_not_checked(self):
        # 目前的既有行為（刻意保留，不是這次重構的目標）：只檢查
        # source_names 本身是不是陣列，不檢查陣列裡每個元素的型別——跟
        # validate_word_tree_payload 的 source_ids 用 _require_int_id_list
        # 逐元素檢查是整數不同。
        _, errors = validate_word_bundle_entry({"name": "n", "source_names": "oops"})
        self.assertEqual(errors["source_names"], "必須是陣列")

        _, errors = validate_word_bundle_entry({"name": "n", "source_names": [1, None, {"x": 1}]})
        self.assertNotIn("source_names", errors)
        self.assertEqual(errors, {})

    def test_explanation_category_names_pos_names_focus_names_element_type_not_checked(self):
        payload = {
            "name": "n",
            "explanations": [{
                "category_names": [1, None], "pos_names": "oops", "focus_names": [{"x": 1}],
            }],
        }
        _, errors = validate_word_bundle_entry(payload)
        self.assertEqual(errors["explanations[0].pos_names"], "必須是陣列")
        self.assertNotIn("explanations[0].category_names", errors)
        self.assertNotIn("explanations[0].focus_names", errors)

    def test_explanation_images_and_sentences_same_as_tree(self):
        payload = {
            "name": "n",
            "explanations": [{
                "images": [{"x": 1}, "oops"],
                "sentences": ["oops"],
            }],
        }
        _, errors = validate_word_bundle_entry(payload)
        self.assertEqual(errors["explanations[0].images[1]"], "格式錯誤")
        self.assertEqual(errors["explanations[0].sentences[0]"], "格式錯誤")

    def test_anaphora_item_uses_word_name_not_word_id(self):
        payload = {
            "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [{"items": [{"word_name": 123}]}]}]}],
        }
        _, errors = validate_word_bundle_entry(payload)
        self.assertEqual(
            errors["explanations[0].sentences[0].anaphoras[0].items[0].word_name"], "必須是字串"
        )
        self.assertNotIn("explanations[0].sentences[0].anaphoras[0].items[0].word_id", errors)

    def test_anaphora_item_word_name_none_and_blank_are_allowed(self):
        payload = {
            "name": "n",
            "explanations": [{"sentences": [{"anaphoras": [
                {"items": [{"word_name": None}, {"word_name": ""}]},
            ]}]}],
        }
        _, errors = validate_word_bundle_entry(payload)
        self.assertEqual(errors, {})

    def test_fully_populated_nested_payload_passes(self):
        payload = {
            "id": "existing-id", "name": "balay", "dialect": "d", "frequency": 10,
            "is_derivative_root": True, "source_names": ["來源A"],
            "audios": [{"url": "a.mp3"}],
            "explanations": [{
                "chinese_explanation": "真的",
                "category_names": ["分類A"], "pos_names": ["詞類A"], "focus_names": [],
                "images": [{"url": "i.png"}],
                "sentences": [{
                    "original_sentence": "s1",
                    "audios": [{"url": "s.mp3"}],
                    "anaphoras": [{"items": [{"word_name": "balay", "name": "他"}]}],
                }],
            }],
        }
        cleaned, errors = validate_word_bundle_entry(payload)
        self.assertEqual(errors, {})
        self.assertIs(cleaned, payload)
