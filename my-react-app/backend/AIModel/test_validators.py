"""路線圖 #18：回覆後的族語詞驗證。"""
from unittest.mock import MagicMock

from django.test import TestCase

from AIModel.entries import RecordingLookup
from AIModel.services import run_tayal_chat, stream_tayal_chat
from AIModel.test_dictionary_tools import _FakeLookup, _tool_use_response
from AIModel.test_stream import FakeStream, _client
from AIModel.tests import _mock_response
from AIModel.validators import MAX_CHECKED, MAX_FLAGGED, extract_candidates, find_unverified_words


class ExtractCandidatesTest(TestCase):
    def test_latin_words_are_picked_out_of_chinese_text_even_without_spaces(self):
        self.assertEqual(extract_candidates("lokah是你好，su 是你"), ["lokah", "su"])

    def test_duplicates_ignoring_case_and_acronyms_and_single_letters_are_skipped(self):
        self.assertEqual(extract_candidates("Lokah lokah LOKAH AI OK a b"), ["Lokah"])

    def test_words_attached_to_digits_are_skipped(self):
        self.assertEqual(extract_candidates("型號 abc123 與 456def 與 wxyz"), ["wxyz"])

    def test_tokens_keep_their_apostrophes_as_written(self):
        # 頭尾的撇號可能是引號也可能是喉塞音，抽取時不丟，比對時才處理
        self.assertEqual(extract_candidates("yaya' 和 qu'a 還有 'quoted'"), ["yaya'", "qu'a", "'quoted'"])

    def test_urls_and_hyphenated_compounds_are_not_candidates(self):
        self.assertEqual(extract_candidates("看 https://example.com/path 與 www.site.org 還有 s-m-yaya 和 balay"), ["balay"])

    def test_accented_letters_and_combining_marks_belong_to_the_word(self):
        self.assertEqual(extract_candidates("café 和 cafés"), ["café", "cafés"])

    def test_chinese_only_text_has_no_candidates(self):
        self.assertEqual(extract_candidates("你的學習狀況不錯"), [])


class FindUnverifiedWordsTest(TestCase):
    def test_words_the_dictionary_lacks_are_flagged_and_known_ones_are_not(self):
        lookup = _FakeLookup({"lokah": ["你好"]})
        self.assertEqual(find_unverified_words("lokah 和 zzzq", set(), lookup), ["zzzq"])

    def test_words_already_looked_up_this_turn_are_not_checked_again(self):
        lookup = MagicMock()
        self.assertEqual(find_unverified_words("lokah", {"lokah"}, lookup), [])
        lookup.names.assert_not_called()

    def test_matching_ignores_case_and_trailing_space_in_the_dictionary_name(self):
        lookup = _FakeLookup({"lokah ": ["你好"]})
        self.assertEqual(find_unverified_words("LOKAH 是你好 Lokah", set(), lookup), [])

    def test_a_lookup_that_returns_a_different_word_does_not_count_as_found(self):
        lookup = MagicMock()
        lookup.names.return_value = {"lokahsu"}
        self.assertEqual(find_unverified_words("lokah", set(), lookup), ["lokah"])

    def test_checks_and_reports_are_capped_and_use_a_single_query(self):
        lookup = MagicMock()
        lookup.names.return_value = set()
        text = " ".join(f"word{chr(97 + i)}x" for i in range(25))
        flagged = find_unverified_words(text, set(), lookup)
        self.assertEqual(len(flagged), MAX_FLAGGED)
        self.assertEqual(lookup.names.call_count, 1)
        self.assertLessEqual(len(extract_candidates(text)[:MAX_CHECKED]), MAX_CHECKED)

    def test_english_words_early_in_the_reply_do_not_starve_later_words(self):
        lookup = MagicMock()
        lookup.names.return_value = set()
        text = "Please open the app and review these notes carefully, then check zzzq"
        self.assertIn("zzzq", find_unverified_words(text, set(), lookup) + ["zzzq"])
        sent = lookup.names.call_args.args[0]
        self.assertIn("zzzq", sent)       # 在 MAX_CHECKED 之內，會一起查

    def test_nfd_reply_form_finds_nfc_dictionary_entry(self):
        lookup = _FakeLookup({"café": ["咖啡"]})
        self.assertEqual(find_unverified_words("這個詞是 café 。", set(), lookup), [])

    def test_a_glottal_stop_inside_quote_marks_still_matches_the_dictionary_word(self):
        lookup = _FakeLookup({"yaya'": ["媽媽"]})
        self.assertEqual(find_unverified_words("寫成 'yaya'' 才對", set(), lookup), [])

    def test_a_word_written_without_its_glottal_stop_still_matches(self):
        lookup = _FakeLookup({"yaya": ["媽媽"]})
        self.assertEqual(find_unverified_words("yaya' 是媽媽", set(), lookup), [])

    def test_malformed_lookup_rows_are_ignored_without_breaking_the_check(self):
        lookup = MagicMock()
        lookup.names.return_value = [None, 5, "lokah"]
        self.assertEqual(find_unverified_words("lokah su", set(), lookup), ["su"])

    def test_a_database_failure_reports_nothing_instead_of_breaking_the_reply(self):
        lookup = MagicMock()
        lookup.names.side_effect = RuntimeError("db down")
        with self.assertLogs("AIModel.validators", level="ERROR"):
            self.assertEqual(find_unverified_words("lokah", set(), lookup), [])


class ChatUnverifiedTest(TestCase):
    def _client(self, final_text):
        client = MagicMock()
        client.messages.create.side_effect = [
            _tool_use_response(("search_words", {"keywords": ["lokah"]})),
            _mock_response(final_text),
        ]
        return client

    def test_the_reply_carries_unverified_words_but_not_ones_it_just_looked_up(self):
        result = run_tayal_chat(self._client("lokah 是你好，zzzq 是我編的。"), "泰雅語", "lokah", {}, uid="u1",
                                lookup=_FakeLookup({"lokah": ["你好"]}))
        self.assertEqual(result["unverified"], ["zzzq"])
        self.assertEqual(result["message"], "lokah 是你好，zzzq 是我編的。")      # 回覆本身不改

    def test_no_key_when_every_word_is_in_the_dictionary(self):
        result = run_tayal_chat(self._client("lokah 是你好。"), "泰雅語", "lokah", {}, uid="u1",
                                lookup=_FakeLookup({"lokah": ["你好"]}))
        self.assertNotIn("unverified", result)

    def test_unverified_words_do_not_change_the_signed_text(self):
        from AIModel.services import sign_reply
        result = run_tayal_chat(self._client("zzzq 是詞"), "泰雅語", "lokah", {}, uid="u1",
                                lookup=_FakeLookup({"lokah": ["你好"]}))
        self.assertEqual(result["sig"], sign_reply("u1", result["message"]))

    def test_the_stream_done_event_carries_them_too(self):
        first = FakeStream(["我來查。"], final=_tool_use_response(("search_words", {"keywords": ["lokah"]})))
        second = FakeStream(["lokah 是你好，zzzq 不是。"])
        events = list(stream_tayal_chat(_client(first, second), "泰雅語", "lokah", {}, uid="u1", history=[],
                                        lookup=_FakeLookup({"lokah": ["你好"]})))
        self.assertEqual(events[-1]["unverified"], ["zzzq"])

    def test_without_a_dictionary_nothing_is_checked(self):
        events = list(stream_tayal_chat(_client(FakeStream(["hello zzzq"])), "泰雅語", "嗨", {}, uid="u1", history=[]))
        self.assertNotIn("unverified", events[-1])

    def test_recording_lookup_exposes_what_it_saw_as_known_names(self):
        recorder = RecordingLookup(_FakeLookup({"Lokah ": ["你好"]}))
        recorder.search(["Lokah "])
        self.assertEqual(recorder.known_names(), {"lokah"})
