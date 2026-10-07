"""adminapi/sentence_coverage.py（純函式）與 measure_sentence_coverage 指令。"""
import io
import json
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from adminapi import sentence_coverage as SC
from adminapi.management.commands import measure_sentence_coverage as cmd
from adminapi.test_morphology_inputs import _session
from config.tribes import TRIBES
from dictionary_db.model import (
    Tribe, Word, WordExplanation, WordExplanationAnaphora, WordExplanationAnaphoraItem, WordExplanationSentence,
)

LEX = {"alaw", "filo", "sapi", "babaw nya'"}


def _legacy(sentences):
    return {i: s.split() for i, s in sentences.items()}


class ProductionParityTests(SimpleTestCase):
    def test_head_window_matches_the_translation_pipeline(self):
        from fastAPI.routes.translation import retrieve
        self.assertEqual(SC.MAX_HEADWORD_WINDOW, retrieve.MAX_HEADWORD_WINDOW)

    def test_units_follow_the_pipeline_segmentation_rules(self):
        known = {"alaw", "babaw nya'", "filo"}
        units = SC._production_units("alaw, babaw nya' 12 filo / sapi", known)
        # 標點與 "/" 不是單位；多詞詞條吃兩個詞次；數字是外文片段，算未對到
        self.assertEqual(units, [("alaw", 1, True), ("babaw nya'", 2, True), ("12", 1, False),
                                 ("filo", 1, True), ("sapi", 1, False)])

    def test_multiword_span_cannot_cross_punctuation(self):
        known = {"babaw nya'"}
        self.assertEqual([u[2] for u in SC._production_units("babaw nya'", known)], [True])
        self.assertEqual([u[2] for u in SC._production_units("babaw, nya'", known)], [False, False])

    def test_longest_match_wins_over_a_shorter_prefix(self):
        known = {"a", "a b", "a b c"}
        self.assertEqual(SC._production_units("a b c", known), [("a b c", 3, True)])


class MeasureTribeTests(SimpleTestCase):
    def test_slash_symbol_is_a_legacy_only_gap_and_production_ignores_it(self):
        sentences = {1: "alaw filo", 2: "alaw / filo"}
        legacy = {1: ["alaw", "filo"], 2: ["alaw", "/", "filo"]}
        out = SC.measure_tribe(LEX, sentences, legacy)
        self.assertEqual(out["legacy_on_segmented"]["whole_sentence_rate"], 0.5)
        self.assertEqual(out["production_on_segmented"]["whole_sentence_rate"], 1.0)
        self.assertEqual(out["legacy_unmatched"]["non_letter_tokens"], 1)
        self.assertEqual(out["production_unmatched"]["non_letter_tokens"], 0)
        self.assertEqual(out["legacy_on_segmented"]["token_coverage"], round(4 / 5, 6))
        self.assertEqual(out["paired_legacy_vs_production"],
                         {"both_pass": 1, "first_only_pass": 0, "second_only_pass": 1, "neither_pass": 0})

    def test_unknown_forms_are_ranked_by_count_then_form_and_report_sentence_counts(self):
        sentences = {1: "alaw na", 2: "na filo ta", 3: "ta na sapi", 4: "alaw na na"}
        out = SC.measure_tribe(LEX, sentences, _legacy(sentences), top_n=5)
        top = out["production_unmatched"]["top"]
        self.assertEqual([(t["form"], t["count"], t["sentences"]) for t in top], [("na", 5, 4), ("ta", 2, 2)])
        self.assertEqual(top[0]["share"], round(5 / 7, 6))
        self.assertEqual(out["production_unmatched"]["unmatched_types"], 2)
        self.assertEqual(out["production_on_segmented"]["whole_sentence_known"], 0)

    def test_counterfactual_picks_the_most_frequent_forms_first_and_starts_at_the_actual_rate(self):
        sentences, i = {}, 0
        for form in ("aa", "bb", "cc", "dd", "ee"):
            for _ in range(2):
                i += 1
                sentences[i] = f"alaw {form}"
        for form in ("ff", "gg", "hh", "ii", "jj"):
            i += 1
            sentences[i] = f"alaw {form}"
        sentences[i + 1] = "alaw"
        w = SC.measure_tribe(LEX, sentences, _legacy(sentences))["counterfactual_top_k_known"]
        total = len(sentences)
        self.assertEqual(w["0"], round(1 / total, 6))
        self.assertEqual(w["5"], round(11 / total, 6))
        self.assertEqual(w["10"], 1.0)
        values = [w[str(k)] for k in SC.K_VALUES]
        self.assertEqual(values, sorted(values))

    def test_counterfactual_is_not_claimed_to_be_an_upper_bound_in_the_docs(self):
        self.assertIn("不是上限", SC.__doc__)
        self.assertNotIn("what_if_known_top_k", SC.__doc__)

    def test_multiword_headwords_match_only_in_the_multiword_view(self):
        out = SC.measure_tribe(LEX, {1: "babaw nya'"}, {1: ["babaw", "nya'"]})
        self.assertEqual(out["lexicon_forms"], 4)
        self.assertEqual(out["lexicon_multiword_forms"], 1)
        self.assertEqual(out["production_on_segmented"]["whole_sentence_rate"], 0.0)
        self.assertEqual(out["production_multiword_on_segmented"]["whole_sentence_rate"], 1.0)

    def test_headwords_with_padding_do_not_match_as_stored_but_do_in_the_edge_trimmed_counterfactual(self):
        lex = {"alaw", "baqi ", " na"}
        sentences = {1: "alaw baqi", 2: "alaw na"}
        out = SC.measure_tribe(lex, sentences, _legacy(sentences))
        self.assertEqual(out["production_multiword_on_segmented"]["whole_sentence_rate"], 0.0)
        edge = out["counterfactuals"]["edge_whitespace_trimmed"]
        self.assertEqual(edge["production_multiword_on_segmented"]["whole_sentence_rate"], 1.0)
        self.assertEqual(edge["legacy_on_segmented"]["whole_sentence_rate"], 1.0)
        self.assertEqual(out["whitespace_padded_headwords"], {"distinct_forms": 2, "examples": [" na", "baqi "]})
        self.assertEqual(edge["additional_tokens_matched"], 2)
        self.assertEqual(edge["paired_stored_vs_this_production_multiword"],
                         {"both_pass": 0, "first_only_pass": 0, "second_only_pass": 2, "neither_pass": 0})
        self.assertEqual(out["lexicon_forms"], 3)
        self.assertEqual(edge["lexicon_forms"], 3)

    def test_inner_whitespace_is_only_fixed_by_the_canonicalized_counterfactual_not_by_edge_trimming(self):
        out = SC.measure_tribe({"babaw\u00a0nya'"}, {1: "babaw nya'"}, {1: ["babaw", "nya'"]})
        cf = out["counterfactuals"]
        self.assertEqual(out["production_multiword_on_segmented"]["whole_sentence_rate"], 0.0)          # 照實際存放：NBSP 不等於空格
        self.assertEqual(cf["edge_whitespace_trimmed"]["production_multiword_on_segmented"]["whole_sentence_rate"], 0.0)
        self.assertEqual(cf["whitespace_canonicalized"]["production_multiword_on_segmented"]["whole_sentence_rate"], 1.0)
        self.assertEqual(cf["edge_whitespace_trimmed"]["additional_tokens_matched"], 0)
        self.assertEqual(cf["whitespace_canonicalized"]["additional_tokens_matched"], 2)

    def test_unpadded_lexicon_has_no_counterfactual_difference(self):
        sentences = {1: "alaw filo", 2: "alaw zzz"}
        out = SC.measure_tribe(LEX, sentences, _legacy(sentences))
        self.assertEqual(out["whitespace_padded_headwords"]["distinct_forms"], 0)
        for name in ("edge_whitespace_trimmed", "whitespace_canonicalized"):
            cf = out["counterfactuals"][name]
            self.assertEqual(cf["additional_tokens_matched"], 0)
            self.assertEqual(cf["production_multiword_on_segmented"]["whole_sentence_rate"],
                             out["production_multiword_on_segmented"]["whole_sentence_rate"])

    def test_normalization_applies_to_both_sides_and_does_not_require_a_pre_normalized_lexicon(self):
        out = SC.measure_tribe({"ALAW"}, {1: "alaw"}, {1: ["alaw"]})
        self.assertEqual(out["production_on_segmented"]["whole_sentence_rate"], 1.0)
        out = SC.measure_tribe({"nyaʼ"}, {1: "nya'"}, {1: ["nya'"]})
        self.assertEqual(out["production_on_segmented"]["whole_sentence_rate"], 1.0)

    def test_foreign_pieces_count_as_unmatched_units_like_the_pipeline(self):
        out = SC.measure_tribe(LEX, {1: "alaw 12"}, {1: ["alaw", "12"]})
        self.assertEqual(out["production_multiword_on_segmented"]["whole_sentence_rate"], 0.0)
        self.assertEqual(out["production_multiword_unmatched"]["top"][0]["form"], "12")

    def test_sentences_without_segmentation_only_appear_in_the_all_sentences_view(self):
        sentences = {1: "alaw filo", 2: "alaw zzz"}
        out = SC.measure_tribe(LEX, sentences, {1: ["alaw", "filo"]})
        self.assertEqual((out["unique_sentences"], out["sentences_with_segmentation"]), (2, 1))
        self.assertEqual(out["production_multiword_on_segmented"]["sentences"], 1)
        self.assertEqual(out["production_multiword_on_all"]["sentences"], 2)
        self.assertEqual(out["production_multiword_on_all"]["whole_sentence_rate"], 0.5)

    def test_sentences_without_any_token_are_excluded_from_the_denominator_but_counted(self):
        out = SC.measure_tribe(LEX, {1: "alaw", 2: "。！"}, {1: ["alaw"], 2: ["。"]})
        self.assertEqual(out["production_multiword_on_all"]["sentences"], 1)
        self.assertEqual(out["production_multiword_on_all"]["sentences_without_tokens"], 1)

    def test_empty_input_gives_null_rates_not_zero(self):
        out = SC.measure_tribe(LEX, {}, {})
        self.assertIsNone(out["production_multiword_on_all"]["whole_sentence_rate"])
        self.assertIsNone(out["production_multiword_on_all"]["token_coverage"])
        self.assertIsNone(out["production_multiword_on_all"]["macro_token_coverage"])
        self.assertIsNone(out["counterfactual_top_k_known"]["0"])
        self.assertEqual(out["production_multiword_on_all"]["whole_sentence_ci95"], [0.0, 1.0])

    def test_macro_average_differs_from_the_micro_token_coverage(self):
        sentences = {1: "alaw", 2: "zz zz zz zz alaw"}
        out = SC.measure_tribe(LEX, sentences, _legacy(sentences))["production_on_segmented"]
        self.assertEqual(out["token_coverage"], round(2 / 6, 6))
        self.assertEqual(out["macro_token_coverage"], round((1 + 1 / 5) / 2, 6))

    def test_ci_brackets_the_rate(self):
        sentences = {i: ("alaw" if i % 2 else "alaw zz") for i in range(1, 41)}
        out = SC.measure_tribe(LEX, sentences, _legacy(sentences))["production_on_segmented"]
        lo, hi = out["whole_sentence_ci95"]
        self.assertLess(lo, out["whole_sentence_rate"])
        self.assertGreater(hi, out["whole_sentence_rate"])

    def test_length_buckets_cover_every_sentence_once(self):
        sentences = {1: "alaw", 2: "alaw filo sapi alaw", 3: " ".join(["alaw"] * 8), 4: " ".join(["alaw"] * 12)}
        out = SC.measure_tribe(LEX, sentences, _legacy(sentences))["production_multiword_by_length"]
        self.assertEqual({k: v["sentences"] for k, v in out.items()}, {"1-3": 1, "4-6": 1, "7-10": 1, "11+": 1})

    def test_result_does_not_depend_on_input_order(self):
        s = {3: "alaw na", 1: "filo ta", 2: "sapi"}
        a = SC.measure_tribe(LEX, s, _legacy(s))
        b = SC.measure_tribe(list(reversed(sorted(LEX))), dict(sorted(s.items())), dict(sorted(_legacy(s).items(), reverse=True)))
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))


class HeadwordWhitespaceStatsTests(SimpleTestCase):
    def test_counts_rows_kinds_and_collisions_from_raw_rows(self):
        names = ["alaw", "alaw ", "alaw", "baqi ", "ka", "ka", " lead", "a\u00a0b", "x  y", "", None]
        w = SC.headword_whitespace_stats(names)
        self.assertEqual(w["rows"], 9)
        self.assertEqual(w["padded_rows"], 3)                       # "alaw "、"baqi "、" lead"
        self.assertEqual((w["leading_rows"], w["trailing_rows"]), (1, 2))
        self.assertEqual(w["non_ascii_space_rows"], 1)
        self.assertEqual(w["inner_multi_space_rows"], 1)
        self.assertEqual(w["padded_distinct_forms"], 3)
        # 去頭尾空白後同名：alaw×3（含帶空白的一列）、ka×2
        self.assertEqual((w["rows_colliding_after_edge_trim"], w["collision_groups_after_edge_trim"]), (5, 2))
        self.assertEqual(w["padded_rows_in_a_collision"], 1)

    def test_clean_names_report_zero_padding(self):
        w = SC.headword_whitespace_stats(["a", "b", "c d"])
        self.assertEqual((w["padded_rows"], w["rows_colliding_after_edge_trim"], w["padded_rows_in_a_collision"]), (0, 0, 0))

    def test_distinct_forms_can_be_fewer_than_rows(self):
        w = SC.headword_whitespace_stats(["x ", "x "])
        self.assertEqual((w["padded_rows"], w["padded_distinct_forms"]), (2, 1))


class DuplicateStatsTests(SimpleTestCase):
    def test_counts_duplicates_and_conflicting_segmentations(self):
        rows = [(1, "a b"), (2, "a b"), (3, "c d"), (4, "c d"), (5, "e"), (6, ""), (7, None)]
        legacy = {1: ["a", "b"], 2: ["a", "b"], 3: ["c", "d"], 4: ["c", "x"], 5: ["e"]}
        self.assertEqual(SC.duplicate_stats(rows, legacy), {
            "sentence_rows": 5, "unique_texts": 3, "duplicate_rows": 2, "texts_with_conflicting_segmentation": 1,
        })

    def test_missing_or_empty_segmentation_is_not_a_conflict(self):
        rows = [(1, "a"), (2, "a"), (3, "a")]
        self.assertEqual(SC.duplicate_stats(rows, {1: ["a"], 2: ["A"]})["texts_with_conflicting_segmentation"], 0)   # 正規化後相同
        self.assertEqual(SC.duplicate_stats(rows, {})["texts_with_conflicting_segmentation"], 0)


KAV = next(t for t in TRIBES if t.slug == "kavalan")
TAY = next(t for t in TRIBES if t.slug == "tayal")


def _seed(db):
    for t in (KAV, TAY):
        db.add(Tribe(id=t.id, name=t.full_name, slug=t.slug))
    db.add(Word(id="w1", tribe_id=KAV.id, name="alaw", derivative_root=None))
    db.add(Word(id="w2", tribe_id=KAV.id, name="filo ", derivative_root=None))      # 尾端有空白
    db.add(Word(id="w3", tribe_id=TAY.id, name="other", derivative_root=None))
    db.add(Word(id="w4", tribe_id=KAV.id, name="alaw", derivative_root=None))       # 同名詞條（同形異義）：統計要看列數，不是去重後的詞形數
    db.add(WordExplanation(id=1, word_id="w1"))
    db.add(WordExplanation(id=2, word_id="w2"))
    db.add(WordExplanation(id=3, word_id="w3"))
    sents = [(1, 1, "alaw filo"), (2, 2, "alaw filo"), (3, 2, "alaw na"), (4, 1, "alaw / filo"), (5, 3, "other zzz")]
    for sid, expl, text in sents:
        db.add(WordExplanationSentence(id=sid, explanation_id=expl, original_sentence=text))
    seg = {1: ["alaw", "filo"], 2: ["alaw", "FILO"], 3: ["alaw", "na"], 4: ["alaw", "/", "filo"]}
    aid = 0
    for sid, tokens in seg.items():
        for order, tok in enumerate(tokens):
            aid += 1
            db.add(WordExplanationAnaphora(id=aid, sentence_id=sid, sort_order=order, is_symbol=False))
            db.add(WordExplanationAnaphoraItem(id=aid, anaphora_id=aid, name=tok, sort_order=0))
    aid += 1
    db.add(WordExplanationAnaphora(id=aid, sentence_id=1, sort_order=9, is_symbol=True))      # 符號項目：舊方法排除
    db.add(WordExplanationAnaphoraItem(id=aid, anaphora_id=aid, name="。", sort_order=0))
    aid += 1
    db.add(WordExplanationAnaphora(id=aid, sentence_id=5, sort_order=0, is_symbol=True))      # 只有符號項目的句子
    db.add(WordExplanationAnaphoraItem(id=aid, anaphora_id=aid, name="。", sort_order=0))
    db.commit()


class LoaderAndCommandTests(SimpleTestCase):
    def setUp(self):
        self.db = _session()
        _seed(self.db)
        self.addCleanup(self.db.close)

    def test_dedupe_keeps_the_lowest_id_regardless_of_row_order_and_drops_empty_text(self):
        rows = [(5, "other"), (9, "same"), (2, "same"), (7, ""), (8, None), (3, "same")]   # 先看到的句子 id 反而較大
        expected = {2: "same", 5: "other"}
        self.assertEqual(cmd.dedupe_sentences(rows), expected)
        self.assertEqual(cmd.dedupe_sentences(list(reversed(rows))), expected)
        self.assertEqual(list(cmd.dedupe_sentences(rows)), [2, 5])

    def test_loader_dedups_is_tribe_scoped_filters_symbols_and_reports_funnel(self):
        sentences, legacy, stats = cmd.load_sentences(self.db, KAV.id)
        self.assertEqual(sentences, {1: "alaw filo", 3: "alaw na", 4: "alaw / filo"})      # 2 與 1 同文，留 id 小的
        self.assertEqual(legacy, {1: ["alaw", "filo"], 3: ["alaw", "na"], 4: ["alaw", "/", "filo"]})
        self.assertEqual(stats["sentence_rows"], 4)
        self.assertEqual((stats["unique_texts"], stats["duplicate_rows"]), (3, 1))
        self.assertEqual(stats["texts_with_conflicting_segmentation"], 0)           # "FILO" 正規化後與 "filo" 相同
        self.assertEqual(stats["segmentation_funnel"], {
            "unique_texts": 3, "with_anaphora_rows": 3, "with_anaphora_items": 3, "with_tokens_after_filtering_symbols": 3})
        other, other_legacy, other_stats = cmd.load_sentences(self.db, TAY.id)
        self.assertEqual(other, {5: "other zzz"})
        self.assertEqual(other_legacy, {})                                          # 只有符號項目：過濾後沒有詞
        self.assertEqual(other_stats["segmentation_funnel"]["with_anaphora_items"], 1)
        self.assertEqual(other_stats["segmentation_funnel"]["with_tokens_after_filtering_symbols"], 0)

    def _run(self, *args):
        buf = io.StringIO()
        with mock.patch.object(cmd, "SessionLocal", return_value=self.db), mock.patch.object(self.db, "close"):
            call_command("measure_sentence_coverage", *args, stdout=buf)
        return buf.getvalue()

    def test_json_report_end_to_end_with_stored_and_trimmed_views(self):
        data = json.loads(self._run("--tribe", "kavalan", "--format", "json"))
        t = data["tribes"][0]
        self.assertEqual((t["tribe"], t["unique_sentences"], data["measurement_version"]), ("kavalan", 3, 3))
        self.assertEqual(t["whitespace_padded_headwords"]["distinct_forms"], 1)
        self.assertEqual(t["headword_whitespace"]["rows"], 3)                               # 3 列、2 種詞形
        self.assertEqual(t["lexicon_forms"], 2)
        self.assertEqual((t["headword_whitespace"]["padded_rows"], t["headword_whitespace"]["trailing_rows"]), (1, 1))
        self.assertEqual((t["headword_whitespace"]["rows_colliding_after_edge_trim"],
                          t["headword_whitespace"]["collision_groups_after_edge_trim"]), (2, 1))   # 兩列 alaw 同名
        # 詞條 "filo " 帶空白：照實際存放時 "filo" 對不到，所以沒有任何句子整句都對到
        self.assertEqual(t["legacy_on_segmented"]["whole_sentence_rate"], 0.0)
        self.assertEqual(t["production_on_segmented"]["whole_sentence_rate"], 0.0)
        cf = t["counterfactuals"]["edge_whitespace_trimmed"]
        self.assertEqual(cf["legacy_on_segmented"]["whole_sentence_rate"], round(1 / 3, 6))               # 只有第 1 句
        self.assertEqual(cf["production_on_segmented"]["whole_sentence_rate"], round(2 / 3, 6))           # 第 4 句的 "/" 被忽略
        self.assertEqual(t["sentence_data"]["segmentation_funnel"]["with_tokens_after_filtering_symbols"], 3)

    def test_json_is_deterministic(self):
        self.assertEqual(self._run("--tribe", "kavalan", "--format", "json"), self._run("--tribe", "kavalan", "--format", "json"))

    def test_table_mentions_both_methods_the_counterfactual_and_the_whitespace_finding(self):
        text = self._run("--tribe", "kavalan")
        for needle in ("舊方法", "正式斷詞器", "多詞最長匹配", "只去頭尾空白", "內部空白收斂", "反事實", "非上限", "同名不一定該合併"):
            self.assertIn(needle, text)

    def test_argument_validation(self):
        for bad in (["--tribe", "klingon"], ["--top-n", "-1"], ["--top-n", "201"]):
            with self.assertRaises(CommandError):
                self._run(*bad)

    def test_output_is_atomic_and_never_modifies_the_database(self):
        before = self.db.query(WordExplanationSentence).count()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "c.json"
            self._run("--tribe", "kavalan", "--format", "json", "--output", str(out))
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["measurement_version"], 3)
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["c.json"])
            with self.assertRaises(CommandError):
                self._run("--output", str(Path(tmp) / "nope" / "c.json"))
        self.assertEqual(self.db.query(WordExplanationSentence).count(), before)
