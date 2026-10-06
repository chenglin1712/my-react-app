"""config.morphology 的純函式測試——資料清洗、規則歸納與還原、模糊比對、
分析器排序、評估指標。這個模組不碰 DB，所有測試都不需要 fixture。

測試檔放在這裡而不是 backend/config/，理由同 test_translation_lexicon.py：
模組本身在 Django／FastAPI 共用層，但它要服務的是翻譯功能的佐證檢核，這裡的
pytest 設定已經能直接跑。

這裡的詞例大多取自真實辭典資料（泰雅語 qmahun←qumah、阿美語 mafilo←filo、
葛瑪蘭語 sasabunan←sabun 等），不是憑空編的，方便對照。
"""
import pytest

from config import morphology as M
from config.morphology import (
    Analysis,
    EditIndex,
    MorphAnalyzer,
    MorphRule,
    RootPair,
)


class TestCleanRootField:
    def test_plain_root_is_kept(self):
        assert M.clean_root_field("paqut", "pinqutan") == (("paqut",), None)

    def test_edge_whitespace_is_stripped(self):
        # 實測 716 筆詞根欄位頭尾有空白（"qbaq "）。
        assert M.clean_root_field("qbaq ", "baqi") == (("qbaq",), None)

    def test_comma_separated_roots_are_split_and_deduplicated(self):
        assert M.clean_root_field("baziy,baziy", "berani") == (("baziy",), None)
        assert M.clean_root_field("ngungu',ngungu'", "sngungu'") == (("ngungu'",), None)

    def test_multiple_distinct_roots_are_all_kept_in_order(self):
        assert M.clean_root_field("aaa,bbb", "xaaabbb") == (("aaa", "bbb"), None)

    def test_trailing_homograph_digit_is_removed(self):
        # "bka'2" 的 2 是同音異義詞的編號，不是詞根的一部分。
        assert M.clean_root_field("bka'2", "bkan") == (("bka'",), None)

    def test_edge_hyphens_are_removed(self):
        assert M.clean_root_field("tepiq-", "mapatepiq") == (("tepiq",), None)

    def test_syllable_hyphens_that_equal_the_word_are_self_pairs(self):
        # 阿美語 "cya-taw" 是 "cyataw" 的音節切分標記，不是衍生關係。
        assert M.clean_root_field("cya-taw", "cyataw") == ((), "self_pair")

    def test_root_equal_to_derived_is_self_pair(self):
        assert M.clean_root_field("ptayak", "ptayak") == ((), "self_pair")

    def test_apostrophe_variants_are_unified_like_production_normalization(self):
        assert M.clean_root_field("filoʼ", "mafilo'") == (("filo'",), None)

    def test_chinese_description_is_dropped(self):
        assert M.clean_root_field("ma前綴詞，而fotiliʼ是詞根。", "mafotiliʼ") == ((), "bad_root_field")

    def test_parenthesised_note_is_dropped(self):
        assert M.clean_root_field("subidang (sabidang)", "masubidang") == ((), "bad_root_field")

    def test_multiword_phrase_is_dropped(self):
        assert M.clean_root_field("babaw nya", "babaw nya'") == ((), "bad_root_field")

    def test_only_digits_or_hyphens_leave_nothing(self):
        assert M.clean_root_field("--", "abc") == ((), "empty_gold")
        assert M.clean_root_field("2", "abc") == ((), "empty_gold")

    def test_non_word_characters_are_rejected(self):
        # 只允許族語詞形該有的字元；"???" 之類混進詞根欄位的雜訊不能拿來歸納規則。
        for raw in ("???", "root)", "ro/ot", "a2b", "ro*t"):
            assert M.clean_root_field(raw, "derived") == ((), "bad_root_field"), raw

    def test_digit_inside_a_root_is_rejected_even_when_it_is_the_first_character(self):
        assert M.clean_root_field("2abc", "derived") == ((), "bad_root_field")

    def test_digits_only_leave_nothing(self):
        assert M.clean_root_field("123", "derived") == ((), "empty_gold")

    def test_u2019_apostrophe_is_rejected_because_production_does_not_unify_it(self):
        # normalize_token 只統一 U+02BC／U+02BE；U+2019 留在字串裡，跟正式環境的詞庫
        # 索引對不上，所以寧可丟掉也不要靜默比對失敗。
        assert M.clean_root_field("fotili’", "mafotili") == ((), "bad_root_field")

    def test_space_after_comma_is_allowed_but_space_inside_a_root_is_not(self):
        assert M.clean_root_field("baziy, baziy", "mabaziy") == (("baziy",), None)
        assert M.clean_root_field("baziy, ba ziy", "mabaziy") == ((), "bad_root_field")

    def test_self_root_among_several_only_drops_that_one(self):
        assert M.clean_root_field("mabala,bala", "mabala") == (("bala",), None)

    def test_underscore_is_kept_as_part_of_the_orthography(self):
        # 泰雅語用底線標記央中元音（b_yaring）。
        assert M.clean_root_field("b_yaring", "mb_yaring") == (("b_yaring",), None)

    def test_none_and_blank_are_empty_gold(self):
        assert M.clean_root_field(None, "abc") == ((), "empty_gold")
        assert M.clean_root_field("   ", "abc") == ((), "empty_gold")


class TestBuildPairs:
    def test_counts_every_drop_reason_and_merges_duplicates(self):
        rows = [
            ("泰雅語", "pinqutan", "paqut"),
            ("泰雅語", "pinqutan", "pqut"),            # 同一衍生詞第二列：詞根合併
            ("泰雅語", "babaw nya'", "babaw nya"),       # 衍生詞含空白
            ("阿美語", "cyataw", "cya-taw"),             # self_pair
            ("阿美語", "mafotili", "ma前綴詞，而fotili是詞根。"),
            ("葛瑪蘭語", "qakawili", "kawili"),
        ]
        pairs, dropped = M.build_pairs(rows)
        assert dropped == {"bad_derived": 1, "self_pair": 1, "bad_root_field": 1}
        by_key = {(p.tribe, p.derived): p for p in pairs}
        assert set(by_key) == {("泰雅語", "pinqutan"), ("葛瑪蘭語", "qakawili")}
        # 清洗後的配對維持輸入的先後順序（不依族語或字母排序）。
        assert [(p.tribe, p.derived) for p in pairs] == [("泰雅語", "pinqutan"), ("葛瑪蘭語", "qakawili")]
        assert by_key[("泰雅語", "pinqutan")].roots == ("paqut", "pqut")

    def test_non_word_derived_forms_are_dropped(self):
        pairs, dropped = M.build_pairs([("泰雅語", "!!!", "root"), ("泰雅語", "123", "root"), ("泰雅語", "", "root")])
        assert pairs == [] and dropped == {"bad_derived": 3}

    def test_derived_hyphen_is_allowed(self):
        pairs, _ = M.build_pairs([("阿美語", "a-bc", "bc")])
        assert pairs[0].derived == "a-bc"

    def test_derived_is_normalized(self):
        pairs, _ = M.build_pairs([("阿美語", "Hakama^", "hakam")])
        assert pairs[0].derived == "hakama"


class TestIsTestPair:
    def test_is_deterministic(self):
        assert M.is_test_pair("泰雅語", "pinqutan") == M.is_test_pair("泰雅語", "pinqutan")

    def test_holds_out_about_one_fifth(self):
        hits = sum(M.is_test_pair("泰雅語", f"word{i}") for i in range(5000))
        assert 0.17 <= hits / 5000 <= 0.23

    def test_split_is_keyed_on_tribe_and_word_together(self):
        # 同一個字串在不同族語是不同配對，切分不該連動：找一個字串，使它在某兩族
        # 一邊是 test、一邊不是，證明族語確實參與了雜湊。
        tribes = ("泰雅語", "阿美語", "葛瑪蘭語", "布農語", "排灣語")
        assert any(len({M.is_test_pair(t, f"w{i}") for t in tribes}) == 2 for i in range(200))

    def test_rejects_non_positive_modulus(self):
        with pytest.raises(ValueError):
            M.is_test_pair("泰雅語", "abc", holdout_mod=0)
        with pytest.raises(ValueError):
            M.is_test_pair("泰雅語", "abc", holdout_mod=-5)


class TestMorphRuleApply:
    def test_prefix(self):
        assert MorphRule("P", a="ma").apply("mafilo") == "filo"
        assert MorphRule("P", a="ma").apply("filo") is None

    def test_suffix(self):
        assert MorphRule("S", a="an").apply("sabunan") == "sabun"
        assert MorphRule("S", a="an").apply("sabun") is None

    def test_infix_inserted_after_k_characters(self):
        # 泰雅語 qmahun ← qahun（-m- 插在第 1 個字元之後）
        assert MorphRule("I", a="m", k=1).apply("qmahun") == "qahun"
        assert MorphRule("I", a="m", k=1).apply("qahun") is None

    def test_circumfix(self):
        assert MorphRule("C", a="ma", b="ay").apply("masuqasay") == "suqas"
        assert MorphRule("C", a="ma", b="ay").apply("suqas") is None

    def test_reduplication(self):
        assert MorphRule("R", k=2).apply("sisiwa") == "siwa"
        assert MorphRule("R", k=2).apply("siwa") is None

    def test_residue_shorter_than_minimum_is_rejected(self):
        # 殘餘只剩 1 個字元幾乎必然是巧合命中，不當作詞根。
        assert MorphRule("P", a="ma").apply("mab") is None
        assert MorphRule("S", a="an").apply("ban") is None

    def test_affix_longer_than_token_does_not_raise(self):
        assert MorphRule("P", a="abcdef").apply("ab") is None
        assert MorphRule("S", a="abcdef").apply("ab") is None
        assert MorphRule("I", a="m", k=3).apply("ab") is None
        assert MorphRule("C", a="abc", b="def").apply("abc") is None
        assert MorphRule("R", k=3).apply("ab") is None

    def test_circumfix_halves_may_not_overlap(self):
        # token 長度不夠同時容納前半與後半時不得回傳負長度切片造成的怪結果。
        assert MorphRule("C", a="mab", b="bay").apply("mabay") is None

    def test_empty_token(self):
        for rule in (MorphRule("P", a="m"), MorphRule("S", a="n"), MorphRule("I", a="m", k=1),
                     MorphRule("C", a="m", b="n"), MorphRule("R", k=1)):
            assert rule.apply("") is None


class TestMorphRuleValidation:
    @pytest.mark.parametrize("kwargs", [
        dict(kind="X"),
        dict(kind="P"),                      # 空詞綴
        dict(kind="S", a=""),
        dict(kind="I", a="", k=2),
        dict(kind="I", a="m", k=0),
        dict(kind="I", a="m", k=-2),          # 負索引會在意外位置剝字元
        dict(kind="C", a="ma"),               # 缺後半
        dict(kind="C", b="ay"),               # 缺前半
        dict(kind="R", k=0),
        dict(kind="R", k=-1),
    ])
    def test_invalid_rules_are_rejected(self, kwargs):
        with pytest.raises(ValueError):
            MorphRule(**kwargs)

    def test_valid_rules_are_accepted(self):
        MorphRule("P", a="m"); MorphRule("S", a="n"); MorphRule("I", a="m", k=1)
        MorphRule("C", a="m", b="n"); MorphRule("R", k=1)


class TestRuleMarker:
    def test_markers_follow_grammar_affix_notation(self):
        assert MorphRule("P", a="ma").marker == "ma-"
        assert MorphRule("S", a="en").marker == "-en"
        assert MorphRule("I", a="in", k=1).marker == "-in-"
        assert MorphRule("C", a="ma", b="ay").marker == "ma-…-ay"
        assert MorphRule("R", k=2).marker == "重疊2"


class TestDeriveRules:
    # (衍生詞, 詞根, 預期一定要出現的規則)
    CASES = [
        ("mafilo", "filo", MorphRule("P", a="ma")),
        ("sasabunan", "sabun", MorphRule("C", a="sa", b="an")),
        ("qmahun", "qahun", MorphRule("I", a="m", k=1)),
        ("sabunan", "sabun", MorphRule("S", a="an")),
        ("sisiwa", "siwa", MorphRule("R", k=2)),
    ]

    @pytest.mark.parametrize("derived,root,expected", CASES)
    def test_expected_rule_is_found(self, derived, root, expected):
        assert expected in M.derive_rules(derived, root)

    @pytest.mark.parametrize("derived,root,_", CASES)
    def test_every_derived_rule_round_trips(self, derived, root, _):
        # 最重要的不變量：任何 derive_rules 產生的規則，反向套用必須還原出詞根。
        # 否則歸納出來的規則會在分析時產生錯誤候選。
        for rule in M.derive_rules(derived, root):
            assert rule.apply(derived) == root, rule

    def test_one_letter_roots_yield_no_rules(self):
        # apply() 會拒絕殘餘短於 2 的結果，這種規則在分析時永遠不可能命中同一個案例，
        # 不能讓它灌高規則的出現次數。
        for derived, kinds in (("xa", "P"), ("ax", "S"), ("xay", "C"), ("aa", "R"), ("axb", "I")):
            assert M.derive_rules(derived, "a", kinds) == []

    def test_identical_word_yields_no_rules(self):
        assert M.derive_rules("abc", "abc") == []

    def test_unrelated_words_yield_no_rules(self):
        assert M.derive_rules("lmway", "lamu'") == []

    def test_kinds_restricts_rule_types(self):
        rules = M.derive_rules("sisiwa", "siwa", kinds="PSIC")
        assert all(r.kind != "R" for r in rules)

    def test_no_duplicate_rules(self):
        rules = M.derive_rules("anana", "ana")
        assert len(rules) == len(set(rules))


class TestInduceRules:
    def _pairs(self, n, prefix="ma", base="aloq"):
        return [RootPair("t", f"{prefix}{base}{i}", (f"{base}{i}",)) for i in range(n)]

    def test_min_count_is_enforced(self):
        lex = {f"aloq{i}" for i in range(5)}
        assert MorphRule("P", a="ma") in M.induce_rules(self._pairs(3), lex)
        assert MorphRule("P", a="ma") not in M.induce_rules(self._pairs(2), lex)

    def test_roots_outside_the_lexicon_are_ignored(self):
        # 詞根不在詞庫就無法在分析時驗證，不拿來歸納。
        assert M.induce_rules(self._pairs(5), lexicon_set=set()) == {}

    def test_counts_are_returned(self):
        lex = {f"aloq{i}" for i in range(5)}
        assert M.induce_rules(self._pairs(5), lex)[MorphRule("P", a="ma")] == 5


class TestEstimateRulePrecision:
    def test_smoothing_keeps_small_samples_below_one(self):
        rule = MorphRule("P", a="ma")
        lex = {"aloq0", "aloq1", "aloq2"}
        pairs = [RootPair("t", f"maaloq{i}", (f"aloq{i}",)) for i in range(3)]
        prec = M.estimate_rule_precision(pairs, [rule], lex)
        assert prec[rule] == pytest.approx(4 / 5)   # (3+1)/(3+2)，不是 1.0

    def test_false_positive_lowers_precision(self):
        rule = MorphRule("S", a="i")
        lex = {"abc", "abd"}
        pairs = [RootPair("t", "abci", ("abc",)), RootPair("t", "abdi", ("zzz",))]
        prec = M.estimate_rule_precision(pairs, [rule], lex)
        assert prec[rule] == pytest.approx(2 / 4)   # 套用 2 次、對 1 次


class TestEditIndex:
    LEX = {"lamu'", "saqit", "qalup", "kayal", "blaq"}

    def test_finds_substitution_insertion_and_deletion_within_one(self):
        idx = EditIndex(self.LEX, 1)
        assert idx.neighbors("lamu'") == {"lamu'": 0}
        assert idx.neighbors("lamo'") == {"lamu'": 1}      # 替換
        assert idx.neighbors("lamu") == {"lamu'": 1}       # 刪除了結尾
        assert idx.neighbors("lamuu'") == {"lamu'": 1}     # 多了一個字元

    def test_does_not_return_words_beyond_the_limit(self):
        idx = EditIndex(self.LEX, 1)
        assert idx.neighbors("lmu'") == {"lamu'": 1}
        assert idx.neighbors("lmw") == {}

    def test_distance_two_is_covered_when_requested(self):
        idx = EditIndex(self.LEX, 2)
        assert idx.neighbors("lmu") == {"lamu'": 2}

    def test_transposition_counts_as_two_edits(self):
        assert EditIndex(self.LEX, 1).neighbors("kayla") == {}
        assert EditIndex(self.LEX, 2).neighbors("kyaal") == {"kayal": 2}

    def test_multiword_entries_are_not_indexed(self):
        idx = EditIndex({"babaw nya'", "babaw"}, 1)
        assert "babaw nya'" not in idx.neighbors("babaw nya'")

    @pytest.mark.parametrize("bad", [0, -1, 3, 5])
    def test_unsupported_distances_are_rejected(self, bad):
        with pytest.raises(ValueError):
            EditIndex(self.LEX, bad)

    def test_bounded_levenshtein_matches_plain_distance(self):
        assert M._bounded_levenshtein("kitten", "sitting", 5) == 3
        assert M._bounded_levenshtein("abc", "abc", 2) == 0
        assert M._bounded_levenshtein("abc", "xyz", 1) == 2   # 超過上限回傳 limit+1
        assert M._bounded_levenshtein("", "ab", 5) == 2


class TestMorphAnalyzer:
    def _analyzer(self, **kwargs):
        rules = {MorphRule("P", a="ma"): 10, MorphRule("S", a="an"): 6, MorphRule("P", a="m"): 8}
        lex = {"filo", "sabun", "afilo"}
        prec = {MorphRule("P", a="ma"): 0.9, MorphRule("S", a="an"): 0.8, MorphRule("P", a="m"): 0.4}
        return MorphAnalyzer(rules, lex, precision=prec, **kwargs)

    def test_returns_dictionary_root_with_rule(self):
        out = self._analyzer().analyze("mafilo")
        assert out[0].root == "filo" and out[0].rule == MorphRule("P", a="ma") and out[0].stage == "exact"

    def test_ranks_by_rule_precision_by_default(self):
        # "mafilo" 可被 ma-（精確度 0.9）還原成 filo，也可被 m-（0.4）還原成 afilo。
        out = self._analyzer().analyze("mafilo")
        assert [a.root for a in out] == ["filo", "afilo"]

    def test_rank_by_count_follows_training_frequency(self):
        out = self._analyzer(rank_by="count").analyze("mafilo")
        assert out[0].root == "filo"   # ma- 頻次 10 > m- 頻次 8

    def test_every_valid_rule_strictly_shortens_the_token(self):
        # 分析器不再另外擋「殘餘等於 token 自己」：合法規則（詞綴非空、k 為正）剝完一定
        # 比原 token 短，所以這條路徑不可達。這裡把這個不變量直接釘住，萬一以後有人放寬
        # MorphRule 的驗證，這個測試會先失敗。
        tokens = ["mafilo", "sabunan", "qmahun", "sisiwa", "makolacay", "aabcd", "abab"]
        rules = [MorphRule("P", a="m"), MorphRule("S", a="n"), MorphRule("I", a="m", k=1),
                 MorphRule("C", a="ma", b="ay"), MorphRule("R", k=2), MorphRule("R", k=1)]
        for token in tokens:
            for rule in rules:
                residue = rule.apply(token)
                assert residue is None or len(residue) < len(token), (rule, token)

    def test_unknown_form_without_matching_rule_returns_nothing(self):
        assert self._analyzer().analyze("zzzzzz") == []

    def test_top_n_limits_results(self):
        assert len(self._analyzer().analyze("mafilo", top_n=1)) == 1

    def test_same_root_from_multiple_rules_is_listed_once_keeping_the_best_rule(self):
        # "aabcd" 同時能被 P("a")（得 abcd）與 I("a", k=1)（在位置 1 移除 a，也得 abcd）
        # 還原成同一個詞根：兩條規則都真的命中，才算測到去重。
        r_p, r_i = MorphRule("P", a="a"), MorphRule("I", a="a", k=1)
        assert r_p.apply("aabcd") == r_i.apply("aabcd") == "abcd"
        out = MorphAnalyzer({r_p: 3, r_i: 3}, {"abcd"}, precision={r_p: 0.5, r_i: 0.9}).analyze("aabcd")
        assert [(a.root, a.rule) for a in out] == [("abcd", r_i)]   # 只一筆，且留精確度較高的那條

    def test_rule_tie_is_broken_by_rule_order_not_by_dict_insertion_order(self):
        # 同詞根、同分、同頻次的兩條規則：留下哪一條不能取決於 dict 的建立順序，
        # 否則顯示給使用者的詞綴說明會不穩定。
        r_p, r_i = MorphRule("P", a="a"), MorphRule("I", a="a", k=1)
        prec = {r_p: 0.5, r_i: 0.5}
        left = MorphAnalyzer({r_p: 3, r_i: 3}, {"abcd"}, precision=prec).analyze("aabcd")
        right = MorphAnalyzer({r_i: 3, r_p: 3}, {"abcd"}, precision=prec).analyze("aabcd")
        assert left == right
        assert left[0].rule == min(r_p, r_i)

    def test_support_is_the_training_count_of_the_rule(self):
        r = MorphRule("P", a="ma")
        out = MorphAnalyzer({r: 7}, {"filo"}, precision={r: 0.9}).analyze("mafilo")
        assert out[0].support == 7

    def test_result_order_is_stable_across_repeated_calls(self):
        analyzer = self._analyzer()
        assert analyzer.analyze("mafilo") == analyzer.analyze("mafilo")

    def test_missing_precision_is_rejected_when_ranking_by_precision(self):
        with pytest.raises(ValueError):
            MorphAnalyzer({MorphRule("P", a="ma"): 3}, {"filo"})   # 預設 rank_by="precision"

    def test_missing_precision_is_fine_when_ranking_by_count(self):
        out = MorphAnalyzer({MorphRule("P", a="ma"): 3}, {"filo"}, rank_by="count").analyze("mafilo")
        assert out[0].root == "filo"

    @pytest.mark.parametrize("bad", [-0.1, 1.5, float("nan"), float("inf")])
    def test_precision_values_must_be_finite_probabilities(self, bad):
        r = MorphRule("P", a="ma")
        with pytest.raises(ValueError):
            MorphAnalyzer({r: 3}, {"filo"}, precision={r: bad})

    def test_min_rule_precision_drops_low_precision_rules(self):
        r_hi, r_lo = MorphRule("P", a="ma"), MorphRule("P", a="m")
        analyzer = MorphAnalyzer({r_hi: 10, r_lo: 8}, {"filo", "afilo"},
                                 precision={r_hi: 0.9, r_lo: 0.4}, min_rule_precision=0.5)
        assert [a.root for a in analyzer.analyze("mafilo")] == ["filo"]

    def test_min_rule_precision_is_about_the_rule_not_the_discounted_fuzzy_score(self):
        # 規則精確度 0.8 過了 0.5 的門檻，但模糊候選的最終分數是 0.8 × 0.5 = 0.4。
        # 門檻看的是規則本身；所以呼叫端必須另外用 stage 擋掉模糊候選，不能只靠分數。
        r = MorphRule("S", a="an")
        out = MorphAnalyzer({r: 5}, {"kayal"}, precision={r: 0.8}, max_edit=1,
                            min_rule_precision=0.5).analyze("kayulan")
        assert out[0].stage == "fuzzy" and out[0].score < 0.5

    @pytest.mark.parametrize("bad", [-0.1, 1.1])
    def test_min_rule_precision_out_of_range_is_rejected(self, bad):
        with pytest.raises(ValueError):
            MorphAnalyzer({}, set(), min_rule_precision=bad)

    def test_min_rule_precision_requires_precision_ranking(self):
        with pytest.raises(ValueError):
            MorphAnalyzer({}, set(), rank_by="count", min_rule_precision=0.5)

    def test_invalid_max_edit_is_rejected(self):
        for bad in (-1, 3):
            with pytest.raises(ValueError):
                MorphAnalyzer({}, set(), max_edit=bad)

    def test_invalid_rank_by_is_rejected(self):
        with pytest.raises(ValueError):
            MorphAnalyzer({}, set(), rank_by="whatever")


class TestFuzzyStage:
    def _analyzer(self, max_edit=1):
        # 泰雅語 lmway 剝掉後綴 -ay 得 lmw；詞根 lamu' 與 lmw 差 2 個字元。
        rules = {MorphRule("S", a="ay"): 5, MorphRule("S", a="an"): 5}
        return MorphAnalyzer(rules, {"qalup", "kayal", "sabun"}, precision={r: 0.8 for r in rules}, max_edit=max_edit)

    def test_fuzzy_is_off_by_default(self):
        analyzer = MorphAnalyzer({MorphRule("S", a="an"): 5}, {"sabin"}, precision={MorphRule("S", a="an"): 0.8})
        assert analyzer.analyze("sabunan") == []

    def test_fuzzy_candidate_is_flagged_and_discounted(self):
        out = self._analyzer().analyze("kayalay")   # 剝 -ay → kayal，直接命中
        assert out[0].stage == "exact"
        out = self._analyzer().analyze("kayulan")   # 剝 -an → kayul，與 kayal 差 1
        assert out[0].root == "kayal" and out[0].stage == "fuzzy" and out[0].distance == 1
        assert out[0].score == pytest.approx(0.8 * 0.5)

    def test_exact_always_ranks_before_fuzzy_even_with_a_lower_score(self):
        # 刻意讓模糊候選的分數（0.99 × 0.5 = 0.495）高過直接命中的分數（0.1）：
        # 如果排序只看分數，模糊候選會排到前面；對佐證檢核而言，直接命中的證據
        # 一定比編輯距離猜測可信，所以必須維持直接命中在前。
        r_fuzzy, r_exact = MorphRule("S", a="an"), MorphRule("S", a="ulan")
        analyzer = MorphAnalyzer(
            {r_fuzzy: 5, r_exact: 5}, {"kayal", "kay"},
            precision={r_fuzzy: 0.99, r_exact: 0.1}, max_edit=1,
        )
        out = analyzer.analyze("kayulan")
        assert [(a.root, a.stage) for a in out] == [("kay", "exact"), ("kayal", "fuzzy")]
        assert out[0].score < out[1].score   # 確認這個測試真的在測「分數相反」的情況

    def test_short_residue_is_not_fuzzy_matched(self):
        analyzer = MorphAnalyzer({MorphRule("S", a="an"): 5}, {"abc"}, precision={MorphRule("S", a="an"): 0.8}, max_edit=2)
        assert analyzer.analyze("abdan") == []   # 殘餘 abd 長度 3 < 4，不做模糊比對


class TestFunctionTable:
    ROWS = [
        {"affix": "m-", "function": "主事焦點（AF）"},
        {"affix": "-en", "function": "受事焦點"},
        {"affix": "-in-", "function": "完成式"},
        {"affix": "pa-", "function": ""},          # 沒有功能說明的列不收
        {"affix": "", "function": "無詞綴"},
    ]

    def test_builds_table_keyed_by_normalized_marker(self):
        table = M.build_function_table(self.ROWS)
        assert table == {"m-": "主事焦點（AF）", "-en": "受事焦點", "-in-": "完成式"}

    def test_describe_simple_rules(self):
        table = M.build_function_table(self.ROWS)
        assert M.describe_rule(MorphRule("P", a="m"), table) == "主事焦點（AF）"
        assert M.describe_rule(MorphRule("I", a="in", k=1), table) == "完成式"

    def test_describe_unknown_rule_is_none_not_invented(self):
        assert M.describe_rule(MorphRule("P", a="zz"), {}) is None

    def test_describe_circumfix_combines_known_halves_only(self):
        table = {"m-": "前半功能"}
        assert M.describe_rule(MorphRule("C", a="m", b="ay"), table) == "前半功能"
        table = {"m-": "前半功能", "-ay": "後半功能"}
        assert M.describe_rule(MorphRule("C", a="m", b="ay"), table) == "前半功能；後半功能"

    def test_describe_reduplication(self):
        assert M.describe_rule(MorphRule("R", k=2), {}) == "重疊構詞"


class TestEvaluate:
    PAIRS = [
        RootPair("t", "mafilo", ("filo",)),
        RootPair("t", "sabunan", ("sabun",)),
        RootPair("t", "zzz", ("yyy",)),
    ]

    def test_metrics(self):
        table = {"mafilo": ["filo"], "sabunan": ["x", "sabun"], "zzz": []}
        m = M.evaluate(lambda t: table[t], self.PAIRS)
        assert (m.total, m.answered, m.top1, m.top3) == (3, 2, 1, 2)
        assert m.coverage == pytest.approx(2 / 3)
        assert m.top1_acc == pytest.approx(1 / 3)
        assert m.top3_acc == pytest.approx(2 / 3)
        assert m.precision_at_1 == pytest.approx(1 / 2)

    def test_duplicate_candidates_do_not_use_up_top3_slots(self):
        m = M.evaluate(lambda t: ["w", "w", "w", "root"], [RootPair("t", "x", ("root",))])
        assert m.top3 == 1

    def test_any_gold_root_counts(self):
        m = M.evaluate(lambda t: ["b"], [RootPair("t", "x", ("a", "b"))])
        assert m.top1 == 1

    def test_empty_input_does_not_divide_by_zero(self):
        m = M.evaluate(lambda t: [], [])
        assert (m.coverage, m.top1_acc, m.top3_acc, m.precision_at_1) == (0.0, 0.0, 0.0, 0.0)


class TestGenerate:
    RULES = [MorphRule("P", a="ma"), MorphRule("S", a="an"), MorphRule("I", a="m", k=1),
             MorphRule("I", a="in", k=2), MorphRule("C", a="sa", b="an"), MorphRule("R", k=1), MorphRule("R", k=2)]

    @pytest.mark.parametrize("rule", RULES)
    def test_apply_inverts_generate(self, rule):
        for root in ("filo", "sabun", "qahun", "kayal"):
            assert rule.apply(rule.generate(root)) == root, (rule, root)

    def test_generate_matches_the_forms_in_the_dictionary(self):
        assert MorphRule("P", a="ma").generate("filo") == "mafilo"
        assert MorphRule("C", a="sa", b="an").generate("sabun") == "sasabunan"
        assert MorphRule("I", a="m", k=1).generate("qahun") == "qmahun"
        assert MorphRule("R", k=2).generate("siwa") == "sisiwa"

    def test_every_rule_derived_from_a_pair_regenerates_that_pair(self):
        for derived, root in (("mafilo", "filo"), ("sasabunan", "sabun"), ("qmahun", "qahun"), ("sisiwa", "siwa")):
            for rule in M.derive_rules(derived, root):
                assert rule.generate(root) == derived, rule


class TestDeriveRulesLimits:
    def test_reduplication_is_limited_to_three_characters(self):
        # 只認 1~3 個字元的重疊；整個四字元詞根重複不當成重疊規則（它會被當成
        # 前綴／後綴規則處理）。
        kinds = {r.kind for r in M.derive_rules("abcdabcd", "abcd")}
        assert "R" not in kinds and {"P", "S"} <= kinds

    def test_infix_position_is_limited_to_three_characters(self):
        assert not any(r.kind == "I" and r.k == 4 for r in M.derive_rules("abcdmefgh", "abcdefgh"))


class TestFuzzyNeverReturnsTheTokenItself:
    def test_a_fuzzy_neighbour_equal_to_the_token_is_skipped(self):
        # token "kayal" 剝掉後綴 -l 得 "kaya"（不在詞庫），"kaya" 與詞庫裡的 "kayal" 差 1，
        # 而 "kayal" 就是 token 本身——不能回傳「詞自己是自己的詞根」。
        r = MorphRule("S", a="l")
        out = MorphAnalyzer({r: 5}, {"kayal"}, precision={r: 0.9}, max_edit=1).analyze("kayal")
        assert all(a.root != "kayal" for a in out)


def _plain_levenshtein(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


class TestEditIndexAgainstReference:
    def test_matches_brute_force_over_random_vocabulary(self):
        # 用完全不靠刪除鍵的參考實作逐一比對，涵蓋替換、插入、刪除與其混合
        # （距離 1 與 2）——這是驗證索引「沒有漏掉」最直接的辦法。
        import random
        rng = random.Random(11)
        alphabet = "abcdq'"
        vocab = {"".join(rng.choice(alphabet) for _ in range(rng.randint(3, 7))) for _ in range(300)}
        for max_dist in (1, 2):
            idx = EditIndex(vocab, max_dist)
            for _ in range(150):
                q = "".join(rng.choice(alphabet) for _ in range(rng.randint(2, 8)))
                expected = {w: _plain_levenshtein(q, w) for w in vocab if _plain_levenshtein(q, w) <= max_dist}
                assert idx.neighbors(q) == expected, (max_dist, q)

    @pytest.mark.parametrize("query,expected", [
        ("abxy", {"abcd": 2}),        # 兩次替換
        ("abXXcd", {"abcd": 2}),      # 多兩個字元
        ("acd", {"abcd": 1}),         # 少一個字元
        ("axbcX", {"abcd": 2}),       # 刪一個加替換一個
        ("axbcXY", {}),               # 刪、替換、刪共三步，超過 2
    ])
    def test_distance_two_operation_mix(self, query, expected):
        assert EditIndex({"abcd"}, 2).neighbors(query) == expected


class TestSimplestRule:
    def test_prefers_boundary_affixes_over_infix_and_reduplication(self):
        rules = [MorphRule("R", k=1), MorphRule("I", a="a", k=1), MorphRule("C", a="m", b="n"),
                 MorphRule("S", a="n"), MorphRule("P", a="m")]
        assert M.simplest_rule(rules) == MorphRule("P", a="m")
        assert M.simplest_rule(rules[:-1]) == MorphRule("S", a="n")
        assert M.simplest_rule(rules[:-2]) == MorphRule("C", a="m", b="n")
        assert M.simplest_rule(rules[:-3]) == MorphRule("I", a="a", k=1)

    def test_is_deterministic_regardless_of_input_order(self):
        a, b = MorphRule("P", a="m"), MorphRule("P", a="ma")
        assert M.simplest_rule([a, b]) == M.simplest_rule([b, a])

    def test_picks_the_natural_affix_for_a_real_pair(self):
        # "mamipa" ← "mipa"：既能解釋成前綴 ma-，也能解釋成在詞根第 1 個字元後插入 "am"。
        rules = M.derive_rules("mamipa", "mipa")
        assert MorphRule("I", a="am", k=1) in rules
        assert M.simplest_rule(rules) == MorphRule("P", a="ma")


class TestSegment:
    CASES = [
        (MorphRule("P", a="ma"), "mafilo", [("ma", "affix"), ("filo", "root")]),
        (MorphRule("S", a="an"), "sabunan", [("sabun", "root"), ("an", "affix")]),
        (MorphRule("I", a="m", k=1), "qmahun", [("q", "root"), ("m", "affix"), ("ahun", "root")]),
        (MorphRule("C", a="ma", b="ay"), "masuqasay", [("ma", "affix"), ("suqas", "root"), ("ay", "affix")]),
        (MorphRule("R", k=2), "sisiwa", [("si", "redup"), ("siwa", "root")]),
    ]

    @pytest.mark.parametrize("rule,token,expected", CASES)
    def test_splits_into_root_and_affix_pieces(self, rule, token, expected):
        assert rule.segment(token) == expected

    @pytest.mark.parametrize("rule,token,expected", CASES)
    def test_pieces_always_concatenate_back_to_the_token(self, rule, token, expected):
        assert "".join(text for text, _ in rule.segment(token)) == token

    @pytest.mark.parametrize("rule,token,expected", CASES)
    def test_the_root_pieces_concatenate_to_what_apply_returns(self, rule, token, expected):
        assert "".join(t for t, k in rule.segment(token) if k == "root") == rule.apply(token)

    def test_returns_none_when_the_rule_does_not_apply(self):
        assert MorphRule("P", a="ma").segment("filo") is None
        assert MorphRule("C", a="ma", b="ay").segment("mafilo") is None
        assert MorphRule("P", a="ma").segment("mab") is None      # 殘餘太短

    def test_never_returns_empty_pieces(self):
        for rule, token, _ in self.CASES:
            assert all(text for text, _ in rule.segment(token))
        # 中綴插在第 1 個字元後、詞根只剩 1 個字元的邊界：不應出現空字串片段。
        assert all(text for text, _ in MorphRule("I", a="m", k=1).segment("qmah"))

    def test_every_rule_derived_from_a_real_pair_segments_that_pair(self):
        for derived, root in (("mafilo", "filo"), ("sasabunan", "sabun"), ("qmahun", "qahun"), ("sisiwa", "siwa")):
            for rule in M.derive_rules(derived, root):
                segs = rule.segment(derived)
                assert segs and "".join(t for t, _ in segs) == derived
