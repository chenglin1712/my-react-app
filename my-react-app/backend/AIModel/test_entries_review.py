"""路線圖 #17（回覆旁的辭典詞條卡片）與 #11（句子補充說明分欄）。"""
import json
from unittest.mock import MagicMock

from django.test import TestCase

from AIModel.entries import RecordingLookup, cards_for_reply, mentions
from AIModel.schemas import REVIEW_SCHEMA
from AIModel.services import (
    REVIEW_FAILED_MESSAGE, parse_review, run_review_tayal_chat, run_tayal_chat, stream_tayal_chat,
)
from AIModel.test_dictionary_tools import _FakeLookup, _tool_use_response
from AIModel.test_stream import FakeStream, _client
from AIModel.tests import _mock_response


class _AudioLookup(_FakeLookup):
    """在假辭典上補上音檔編號（正式環境的 SqlDictionaryLookup 會給 audio_file_id）。"""

    def search(self, forms):
        return [{**entry, "audio_file_id": f"audio-{entry['word_id']}"} for entry in super().search(forms)]


class MentionsTest(TestCase):
    def test_a_word_must_appear_as_a_whole_word_not_inside_another(self):
        self.assertTrue(mentions("辭典收錄 Lokah，意思是你好", "lokah"))
        self.assertTrue(mentions("lokah", "lokah"))
        self.assertFalse(mentions("lokahsu 是另一個詞", "lokah"))
        self.assertFalse(mentions("su'lokah", "lokah"))

    def test_apostrophes_count_as_part_of_the_word(self):
        self.assertFalse(mentions("yaya' 是另一個詞", "yaya"))
        self.assertTrue(mentions("yaya，媽媽", "yaya"))

    def test_a_later_whole_word_match_is_found_after_an_earlier_partial_one(self):
        self.assertTrue(mentions("lokahsu 和 lokah", "lokah"))

    def test_precomposed_and_combining_spellings_match_each_other(self):
        self.assertTrue(mentions("這個詞是 café。", "café"))
        self.assertTrue(mentions("這個詞是 café。", "café"))

    def test_case_folding_that_changes_length_still_matches_correctly(self):
        self.assertTrue(mentions("STRASSE 是街", "straße"))
        self.assertFalse(mentions("STRASSEN", "straße"))

    def test_empty_word_never_matches(self):
        self.assertFalse(mentions("anything", ""))


class RecordingLookupTest(TestCase):
    def test_it_forwards_results_unchanged_and_remembers_what_was_found(self):
        inner = _AudioLookup({"lokah": ["你好"], "su": ["你"]})
        recorder = RecordingLookup(inner)

        found = recorder.search(["lokah"])
        recorder.get("id-su")

        self.assertEqual(found, inner.search(["lokah"]))
        cards = recorder.cards("lokah 是你好，su 是你")
        self.assertEqual([c["word"] for c in cards], ["lokah", "su"])
        self.assertEqual(cards[0], {"word_id": "id-lokah", "word": "lokah", "chinese": "你好", "audio": "audio-id-lokah"})

    def test_only_words_the_reply_actually_mentions_become_cards(self):
        recorder = RecordingLookup(_AudioLookup({"lokah": ["你好"], "su": ["你"]}))
        recorder.search(["lokah", "su"])
        self.assertEqual([c["word"] for c in recorder.cards("只提到 lokah")], ["lokah"])
        self.assertEqual(recorder.cards("完全沒提到辭典裡的詞"), [])

    def test_a_word_not_found_in_the_dictionary_never_becomes_a_card(self):
        recorder = RecordingLookup(_AudioLookup({"lokah": ["你好"]}))
        recorder.search(["nothere"])
        self.assertEqual(recorder.cards("nothere 辭典沒有收錄"), [])

    def test_trailing_space_in_the_dictionary_name_is_trimmed_and_duplicates_collapse(self):
        recorder = RecordingLookup(_AudioLookup({"lokah ": ["你好"]}))
        recorder.search(["lokah "])
        recorder.search(["lokah "])
        cards = recorder.cards("lokah")
        self.assertEqual([c["word"] for c in cards], ["lokah"])

    def test_cards_are_capped_and_very_short_words_are_skipped(self):
        entries = [{"word_id": str(i), "name": f"word{i}", "chinese": "x", "audio": ""} for i in range(9)]
        entries.append({"word_id": "short", "name": "a", "chinese": "x", "audio": ""})
        text = " ".join(f"word{i}" for i in range(9)) + " a"
        cards = cards_for_reply(entries, text)
        self.assertEqual(len(cards), 5)
        self.assertNotIn("a", [c["word"] for c in cards])

    def test_only_what_the_model_could_see_is_remembered(self):
        """run_tool 去重後只給模型前 3 筆；第 4 筆以後（模型沒讀過）不能變成卡片。"""
        class _Many:
            def search(self, forms):
                dup = {"word_id": "id-0", "name": "lokah", "explanations": ["甲"]}
                return [dup, dup] + [
                    {"word_id": f"id-{i}", "name": f"lokah{i}", "explanations": [f"義{i}"]} for i in range(1, 6)]

            def get(self, word_id):
                return None

        recorder = RecordingLookup(_Many())
        recorder.search(["lokah"])
        text = "lokah lokah1 lokah2 lokah3 lokah4 lokah5"
        self.assertEqual([c["word_id"] for c in recorder.cards(text)], ["id-0", "id-1", "id-2"])

    def test_get_fills_in_what_search_did_not_have(self):
        recorder = RecordingLookup(_FakeLookup({"lokah": ["你好"]}))
        recorder.search(["lokah"])      # 沒有 audio_file_id
        recorder.get("id-lokah")
        self.assertEqual(recorder.cards("lokah")[0]["chinese"], "你好")


class ChatEntriesTest(TestCase):
    def _tool_client(self):
        client = MagicMock()
        client.messages.create.side_effect = [
            _tool_use_response(("search_words", {"keywords": ["lokah"]})),
            _mock_response("辭典收錄：lokah 是你好。"),
        ]
        return client

    def test_the_reply_carries_cards_for_looked_up_words_it_mentions(self):
        result = run_tayal_chat(self._tool_client(), "泰雅語", "lokah 是什麼意思", {}, uid="u1",
                                lookup=_AudioLookup({"lokah": ["你好"]}))
        self.assertEqual(result["message"], "辭典收錄：lokah 是你好。")
        self.assertEqual(result["entries"], [
            {"word_id": "id-lokah", "word": "lokah", "chinese": "你好", "audio": "audio-id-lokah"}])

    def test_cards_do_not_change_the_signed_text(self):
        from AIModel.services import sign_reply
        result = run_tayal_chat(self._tool_client(), "泰雅語", "lokah", {}, uid="u1", lookup=_AudioLookup({"lokah": ["你好"]}))
        self.assertEqual(result["sig"], sign_reply("u1", result["message"]))

    def test_no_cards_when_nothing_was_looked_up_or_mentioned(self):
        client = MagicMock()
        client.messages.create.return_value = _mock_response("你好，同學")
        self.assertNotIn("entries", run_tayal_chat(client, "泰雅語", "你好", {}, lookup=_AudioLookup({"lokah": ["你好"]})))
        self.assertNotIn("entries", run_tayal_chat(client, "泰雅語", "你好", {}))

    def test_the_streaming_done_event_carries_the_same_cards(self):
        first = FakeStream(["我來查。"], final=_tool_use_response(("search_words", {"keywords": ["lokah"]})))
        second = FakeStream(["lokah 是你好。"])
        events = list(stream_tayal_chat(_client(first, second), "泰雅語", "lokah", {}, uid="u1", history=[],
                                        lookup=_AudioLookup({"lokah": ["你好"]})))
        done = events[-1]
        self.assertEqual(done["type"], "done")
        # 串流的 done 文字是使用者實際看到的全部（查詢前的過場話＋答案），卡片依這份文字判斷
        self.assertEqual(done["message"], "我來查。lokah 是你好。")
        self.assertEqual([c["word"] for c in done["entries"]], ["lokah"])

    def test_chitchat_done_event_has_no_cards(self):
        events = list(stream_tayal_chat(_client(FakeStream(["嗨"])), "泰雅語", "嗨", {}, uid="u1", history=[],
                                        lookup=_AudioLookup({"lokah": ["你好"]})))
        self.assertNotIn("entries", events[-1])


class ParseReviewTest(TestCase):
    SENTENCE = "lokah su ima"

    def _json(self, **overrides):
        data = {"translation": "你好嗎", "vocab": [{"word": "lokah", "note": "問候語"}],
                "grammar": "主語在後", "culture": "", "pitfalls": ""}
        data.update(overrides)
        return json.dumps(data, ensure_ascii=False)

    def test_empty_fields_are_left_out_of_sections(self):
        parsed = parse_review(self._json(), self.SENTENCE)
        self.assertEqual(parsed["translation"], "你好嗎")
        self.assertEqual(parsed["sections"], {"vocab": [{"word": "lokah", "note": "問候語"}], "grammar": "主語在後"})

    def test_everything_empty_gives_no_sections(self):
        parsed = parse_review(self._json(vocab=[], grammar=""), self.SENTENCE)
        self.assertEqual(parsed["sections"], {})

    def test_vocab_words_that_are_not_in_the_sentence_are_dropped(self):
        vocab = [{"word": "invented", "note": "憑空"}, {"word": "SU", "note": "你"}, {"word": "ima", "note": ""}]
        parsed = parse_review(self._json(vocab=vocab), self.SENTENCE)
        self.assertEqual(parsed["sections"]["vocab"], [{"word": "SU", "note": "你"}])   # 不分大小寫；沒有說明的也丟掉

    def test_vocab_must_be_a_whole_word_of_the_sentence_not_a_fragment(self):
        vocab = [{"word": "a", "note": "片段"}, {"word": "su", "note": "你"}, {"word": "lok", "note": "片段"}]
        parsed = parse_review(self._json(vocab=vocab), "lokah sulung ima")
        self.assertNotIn("vocab", parsed["sections"])
        parsed = parse_review(self._json(vocab=vocab), "lokah su ima")
        self.assertEqual(parsed["sections"]["vocab"], [{"word": "su", "note": "你"}])

    def test_lengths_are_capped_and_vocab_is_limited_to_five(self):
        vocab = [{"word": "lokah", "note": "長" * 500}] * 9
        parsed = parse_review(self._json(vocab=vocab, grammar="文" * 500, translation="譯" * 500), self.SENTENCE)
        self.assertEqual(len(parsed["sections"]["vocab"]), 5)
        self.assertEqual(len(parsed["sections"]["vocab"][0]["note"]), 80)
        self.assertEqual(len(parsed["sections"]["grammar"]), 140)
        self.assertEqual(len(parsed["translation"]), 120)

    def test_markup_and_newlines_are_flattened_and_wrong_types_are_ignored(self):
        parsed = parse_review(self._json(grammar="第一行\n第二行", culture=123, pitfalls=None), self.SENTENCE)
        self.assertEqual(parsed["sections"]["grammar"], "第一行 第二行")
        self.assertNotIn("culture", parsed["sections"])
        self.assertNotIn("pitfalls", parsed["sections"])

    def test_bad_json_or_wrong_shape_returns_none(self):
        for bad in ("", "不是 JSON", "[]", "null", '{"translation": '):
            with self.subTest(bad=bad):
                self.assertIsNone(parse_review(bad, self.SENTENCE))


class RunReviewTest(TestCase):
    WORDS = [{"tayal": "lokah", "chinese": "你好", "audio": "f1"}]

    def _run(self, reply, **response_attrs):
        response = _mock_response(reply)
        for key, value in response_attrs.items():
            setattr(response, key, value)
        client = MagicMock()
        client.messages.create.return_value = response
        return run_review_tayal_chat(client, "泰雅語", "lokah su", self.WORDS), client

    def test_sections_are_returned_next_to_the_translation_and_the_word_table(self):
        reply = json.dumps({"translation": "你好", "vocab": [{"word": "lokah", "note": "問候"}],
                            "grammar": "", "culture": "常用於見面", "pitfalls": ""}, ensure_ascii=False)
        result, client = self._run(reply)
        self.assertEqual(result["translation"], "你好")
        self.assertEqual(result["sections"], {"vocab": [{"word": "lokah", "note": "問候"}], "culture": "常用於見面"})
        self.assertEqual(result["words"], self.WORDS)
        sent = client.messages.create.call_args.kwargs["output_config"]["format"]
        self.assertEqual(sent, {"type": "json_schema", "schema": REVIEW_SCHEMA})

    def test_unparseable_output_gives_a_fixed_message_and_keeps_the_word_table(self):
        with self.assertLogs("AIModel.services", level="WARNING"):
            result, _ = self._run("不是 JSON")
        self.assertEqual(result["translation"], REVIEW_FAILED_MESSAGE)
        self.assertTrue(result["failed"])               # 前端靠它不把固定說明標成「參考翻譯」
        self.assertNotIn("sections", result)
        self.assertEqual(result["words"], self.WORDS)

    def test_a_truncated_output_is_not_parsed(self):
        with self.assertLogs("AIModel.services", level="WARNING"):
            result, _ = self._run('{"translation": "你', stop_reason="max_tokens")
        self.assertEqual(result["translation"], REVIEW_FAILED_MESSAGE)

    def test_all_empty_output_gives_the_fixed_message_instead_of_a_blank_block(self):
        reply = json.dumps({"translation": "", "vocab": [], "grammar": "", "culture": "", "pitfalls": ""})
        result, _ = self._run(reply)
        self.assertEqual(result["translation"], REVIEW_FAILED_MESSAGE)
        self.assertTrue(result["failed"])

    def test_a_normal_result_is_not_flagged_failed(self):
        reply = json.dumps({"translation": "你好", "vocab": [], "grammar": "", "culture": "", "pitfalls": ""})
        result, _ = self._run(reply)
        self.assertNotIn("failed", result)
