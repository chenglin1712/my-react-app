"""config.morphology_calibration 的純函式測試——統計、切分、負例、規則放行、
聯集檢查、最終閘門、指紋與放行檔序列化。不碰 DB。

端到端的校準用「合成語言」測：詞根是隨機的 CV 音節串、衍生詞一律是 "ma"+詞根，
所以正確答案已知——乾淨的規則必須被放行、證據不足必須整族停用。這樣不用依賴真實
辭典資料就能驗證流程本身。
"""
import json
import random

import pytest

from config import morphology as M
from config import morphology_calibration as C
from config.morphology import MorphRule, RootPair

P_MA = MorphRule("P", a="ma")


def _synthetic_pairs(n, tribe="合成語", seed=1, prefix="ma"):
    rng = random.Random(seed)
    cons, vows = "ptkbdgmnlrsh", "aiueo"
    roots = set()
    while len(roots) < n:
        roots.add("".join(rng.choice(cons) + rng.choice(vows) for _ in range(rng.choice((2, 3)))) + rng.choice(cons))
    roots = sorted(roots)
    pairs = [RootPair(tribe, prefix + r, (r,)) for r in roots]
    lexicon = set(roots) | {p.derived for p in pairs}
    return pairs, lexicon


class TestWilson:
    def test_no_trials_means_no_evidence(self):
        assert C.wilson_interval(0, 0) == (0.0, 1.0)

    def test_zero_errors_still_leaves_an_upper_bound(self):
        # 300 筆零錯誤，95% 上界約 1.3%（zero 次錯誤不等於零風險）。
        assert C.wilson_upper(0, 300) == pytest.approx(0.0126, abs=0.0005)

    def test_interval_brackets_the_point_estimate(self):
        lo, hi = C.wilson_interval(50, 100)
        assert lo < 0.5 < hi and lo == pytest.approx(1 - hi, abs=1e-9)

    def test_more_data_tightens_the_bound(self):
        assert C.wilson_upper(0, 3000) < C.wilson_upper(0, 300)

    def test_bounds_stay_within_unit_interval(self):
        for k, n in ((0, 1), (1, 1), (5, 5), (0, 10)):
            lo, hi = C.wilson_interval(k, n)
            assert 0.0 <= lo <= hi <= 1.0


class TestSplits:
    def test_final_test_is_deterministic_and_about_a_fifth(self):
        hits = sum(C.is_final_test("泰雅語", f"w{i}") for i in range(5000))
        assert 0.17 <= hits / 5000 <= 0.23
        assert C.is_final_test("泰雅語", "abc") == C.is_final_test("泰雅語", "abc")

    def test_final_test_is_independent_of_the_evaluation_split(self):
        # 兩份切分用不同的雜湊標籤，不能是同一批詞，否則先前看過評估切分的數字會汙染最終測試。
        same = sum(C.is_final_test("泰雅語", f"w{i}") == M.is_test_pair("泰雅語", f"w{i}") for i in range(2000))
        assert same < 2000
        assert any(C.is_final_test("泰雅語", f"w{i}") != M.is_test_pair("泰雅語", f"w{i}") for i in range(200))

    def test_final_test_removal_leaves_every_cv_fold_populated(self):
        # 最終測試與交叉驗證的折必須彼此獨立：若兩者共用同一個雜湊，剩下的配對會落在
        # 少一折的空間裡（有一折永遠是空的），交叉驗證就悄悄變成少一折。
        pairs, _ = _synthetic_pairs(1500)
        pool = [p for p in pairs if not C.is_final_test(p.tribe, p.derived)]
        counts = [sum(C.fold_of(p.tribe, p.derived, 5) == k for p in pool) for k in range(5)]
        assert all(c > 0.15 * len(pool) for c in counts), counts

    def test_folds_are_in_range_and_roughly_even(self):
        folds = [C.fold_of("t", f"w{i}", 5) for i in range(5000)]
        assert set(folds) == {0, 1, 2, 3, 4}
        assert all(800 < folds.count(k) < 1200 for k in range(5))


class TestGenerateNegatives:
    def setup_method(self):
        self.pairs, self.lexicon = _synthetic_pairs(300)

    def test_every_fake_is_absent_from_lexicon_and_attested_and_well_formed(self):
        attested = {"zzzz"}
        neg = C.generate_negatives(self.pairs, self.lexicon, attested, random.Random(1))
        assert set(neg) == set(C.FAMILIES)
        for fam, fakes in neg.items():
            assert fakes, fam
            for w in fakes:
                assert w not in self.lexicon and w not in attested, (fam, w)
                assert M._is_valid_derived(w), (fam, w)

    def test_fakes_are_deduplicated_within_each_family(self):
        neg = C.generate_negatives(self.pairs, self.lexicon, set(), random.Random(1))
        for fam, fakes in neg.items():
            assert len(fakes) == len(set(fakes)), fam

    def test_same_seed_gives_same_negatives_and_different_seed_differs(self):
        a = C.generate_negatives(self.pairs, self.lexicon, set(), random.Random(7))
        b = C.generate_negatives(self.pairs, self.lexicon, set(), random.Random(7))
        c = C.generate_negatives(self.pairs, self.lexicon, set(), random.Random(8))
        assert a == b and a != c

    def test_stem_fakes_keep_the_real_affix_but_not_the_real_stem(self):
        neg = C.generate_negatives(self.pairs, self.lexicon, set(), random.Random(1))
        assert all(w.startswith("ma") for w in neg["stem"])
        assert all(w[2:] not in self.lexicon for w in neg["stem"])

    def test_indel_fakes_are_exactly_one_insertion_or_deletion_from_a_real_word(self):
        neg = C.generate_negatives(self.pairs, self.lexicon, set(), random.Random(1))
        derived = [p.derived for p in self.pairs]
        assert neg["indel1"]
        for w in neg["indel1"]:
            assert any(abs(len(w) - len(d)) == 1 and M._bounded_levenshtein(w, d, 1) == 1 for d in derived), w

    def test_fakes_that_collide_with_the_lexicon_are_filtered_out(self):
        # 造一個「所有可能的改一個字母」都剛好是詞庫詞的情境：此時 sub1 一個都不該留下。
        letters = "abcdefghijklmnopqrstuvwxyz"
        word = "maba"
        collisions = {word[:i] + c + word[i + 1:] for i in (1, 2) for c in letters if c != word[i]}
        pairs = [RootPair("t", word, ("ba",))]
        for rng_seed in range(5):
            neg = C.generate_negatives(pairs, {word, "ba"} | collisions, set(), random.Random(rng_seed))
            assert neg["sub1"] == []

    def test_fakes_that_collide_with_attested_forms_are_filtered_out(self):
        letters = "abcdefghijklmnopqrstuvwxyz"
        word = "maba"
        collisions = {word[:i] + c + word[i + 1:] for i in (1, 2) for c in letters if c != word[i]}
        pairs = [RootPair("t", word, ("ba",))]
        for rng_seed in range(5):
            neg = C.generate_negatives(pairs, {word, "ba"}, collisions, random.Random(rng_seed))
            assert neg["sub1"] == []

    def test_sub2_changes_two_different_positions(self):
        pairs, lex = _synthetic_pairs(200)
        neg = C.generate_negatives(pairs, lex, set(), random.Random(3))
        derived = [p.derived for p in pairs]
        for w in neg["sub2"]:
            assert any(len(w) == len(d) and sum(a != b for a, b in zip(w, d)) == 2 for d in derived), w


class TestAdmitRules:
    CFG = C.AdmissionConfig()

    @staticmethod
    def _ev(hits, wrong=0, fa_hard=0, trials=10000):
        return C.RuleEvidence(hits=hits, wrong=wrong, fa_hard=fa_hard, fa_hard_trials=trials)

    def _admit(self, evidence, support=None, **kw):
        sup = support if support is not None else {r: 100 for r in evidence}
        return C.admit_rules(evidence, sup, self.CFG, **kw)

    def test_a_clean_rule_with_enough_evidence_is_admitted(self):
        assert self._admit({P_MA: self._ev(100)}) == {P_MA}

    def test_too_little_evidence_is_not_enough(self):
        # 沒有證據不能宣稱安全：10 次以下的命中不放行。
        assert self._admit({P_MA: self._ev(9)}) == set()

    def test_high_wrong_root_rate_is_rejected_even_with_many_hits(self):
        assert self._admit({P_MA: self._ev(50, wrong=20)}) == set()

    def test_wrong_root_is_judged_by_the_upper_bound_not_the_point_estimate(self):
        # 0 次錯詞根但只有 10 次證據，Wilson 上界約 0.28 > 0.10，不放行；證據多了才行。
        assert self._admit({P_MA: self._ev(10)}) == set()
        assert self._admit({P_MA: self._ev(100)}) == {P_MA}

    def test_false_accepts_on_hard_negatives_are_rejected(self):
        assert self._admit({P_MA: self._ev(100, fa_hard=30)}) == set()
        assert self._admit({P_MA: self._ev(100, fa_hard=5)}) == {P_MA}

    def test_the_false_accept_rate_uses_the_negatives_this_rule_was_actually_tested_on(self):
        # 一條規則只在部分折被歸納出來，就只看過那幾折的負例。5 次錯放行在 2000 筆負例是
        # 0.25%（不放行），不能因為全部折的負例總共有 5000 筆就被算成 0.1%（放行）。
        assert self._admit({P_MA: self._ev(100, fa_hard=5, trials=2000)}) == set()
        assert self._admit({P_MA: self._ev(100, fa_hard=5, trials=5000)}) == {P_MA}

    def test_a_rule_that_was_never_tested_on_any_negative_is_rejected(self):
        assert self._admit({P_MA: self._ev(100, trials=0)}) == set()

    def test_rule_with_low_training_support_is_rejected(self):
        assert self._admit({P_MA: self._ev(100)}, support={P_MA: 5}) == set()

    def test_stricter_thresholds_admit_a_subset(self):
        ev = {P_MA: self._ev(100, wrong=8, fa_hard=10)}
        loose = self._admit(ev, max_wrong_upper=0.20, max_fa_rate=0.01)
        strict = self._admit(ev, max_wrong_upper=0.02, max_fa_rate=0.0001)
        assert strict <= loose and loose == {P_MA} and strict == set()

    def test_every_criterion_is_independent(self):
        # 三個條件缺一不可：其中一項不過，另外兩項再漂亮也不放行。
        assert self._admit({P_MA: self._ev(200)}) == {P_MA}
        for bad in (self._ev(5), self._ev(200, wrong=60), self._ev(200, fa_hard=500)):
            assert self._admit({P_MA: bad}) == set()


class TestUnionCheck:
    def _setup(self):
        lexicon = {"filo", "alaw", "kayal"}
        held = [RootPair("t", "mafilo", ("filo",)), RootPair("t", "maalaw", ("alaw",)), RootPair("t", "makayal", ("kayal",))]
        return lexicon, held

    def test_counts_accepted_correct_and_wrong_root(self):
        lexicon, held = self._setup()
        # 這個假的 held 配對故意把 "maalaw" 的正確詞根標成別的，製造錯詞根。
        held[1] = RootPair("t", "maalaw", ("zzz",))
        lexicon = lexicon | {"zzz"}
        res = C.union_check({P_MA}, {P_MA: 0.9}, held, lexicon, {f: [] for f in C.FAMILIES}, 3)
        assert (res.real_n, res.accepted, res.correct, res.wrong_root) == (3, 3, 2, 1)
        assert res.wrong_root_rate == pytest.approx(1 / 3)

    def test_any_candidate_on_a_negative_counts_as_false_accept(self):
        lexicon, held = self._setup()
        negatives = {f: [] for f in C.FAMILIES}
        negatives["stem"] = ["mafilo", "maxyzq"]    # 第一個剝完是詞庫裡的詞 → 放行；第二個不是
        res = C.union_check({P_MA}, {P_MA: 0.9}, held, lexicon, negatives, 3)
        assert res.fa["stem"] == (1, 2)

    def test_no_admitted_rules_accepts_nothing(self):
        lexicon, held = self._setup()
        negatives = {f: ["mafilo"] for f in C.FAMILIES}
        res = C.union_check(set(), {}, held, lexicon, negatives, 3)
        assert res.accepted == 0 and all(k == 0 for k, _ in res.fa.values())

    def test_min_root_len_excludes_short_roots(self):
        res = C.union_check({P_MA}, {P_MA: 0.9}, [RootPair("t", "mafi", ("fi",))], {"fi"}, {f: [] for f in C.FAMILIES}, 3)
        assert res.accepted == 0


class TestTargetsAndGate:
    CFG = C.AdmissionConfig()

    def _res(self, accepted=100, wrong=1, fa=None):
        r = C.UnionResult(real_n=500, accepted=accepted, correct=accepted - wrong, wrong_root=wrong)
        r.fa = fa or {f: (0, 1000) for f in C.FAMILIES}
        return r

    def test_meets_targets_when_everything_is_low(self):
        assert C.meets_targets(self._res(), self.CFG)

    def test_fails_on_wrong_root_rate(self):
        assert not C.meets_targets(self._res(accepted=100, wrong=20), self.CFG)

    def test_fails_when_any_family_exceeds_its_limit(self):
        fa = {f: (0, 1000) for f in C.FAMILIES}
        fa["stem"] = (30, 1000)    # 3% > 1%
        assert not C.meets_targets(self._res(fa=fa), self.CFG)

    def test_targets_are_checked_against_the_upper_bound_not_the_point_estimate(self):
        # 4/1000 的點估計只有 0.4%（低於 1% 的目標），但 95% 上界約 1.02%：證據不足以排除超標。
        fa = {f: (0, 1000) for f in C.FAMILIES}
        fa["stem"] = (4, 1000)
        assert 4 / 1000 < self.CFG.union_targets["stem"] < C.wilson_upper(4, 1000)
        assert not C.meets_targets(self._res(fa=fa), self.CFG)

    def test_wrong_root_is_also_checked_against_the_upper_bound(self):
        strict = C.AdmissionConfig(max_wrong_root_rate=0.05)
        res = self._res(accepted=79, wrong=1)     # 點估計 1.3%，95% 上界約 6.8%
        assert 1 / 79 < 0.05 < C.wilson_upper(1, 79)
        assert not C.meets_targets(res, strict)
        assert C.meets_targets(res, self.CFG)    # 預設上限 10% 才過

    def test_gate_passes_with_enough_evidence_and_low_errors(self):
        assert C.final_gate_failures(self._res(), self.CFG) == []

    def test_gate_fails_when_too_few_real_words_were_accepted(self):
        failed = C.final_gate_failures(self._res(accepted=10, wrong=0), self.CFG)
        assert failed and "證據不足" in failed[0]

    def test_gate_fails_when_a_negative_family_is_too_small(self):
        fa = {f: (0, 1000) for f in C.FAMILIES}
        fa["sub1"] = (0, 50)
        failed = C.final_gate_failures(self._res(fa=fa), self.CFG)
        assert any("sub1" in f and "證據不足" in f for f in failed)

    def test_gate_fails_on_false_accepts_and_on_wrong_roots(self):
        fa = {f: (0, 1000) for f in C.FAMILIES}
        fa["stem"] = (30, 1000)
        failed = C.final_gate_failures(self._res(accepted=100, wrong=30, fa=fa), self.CFG)
        assert any("錯詞根率" in f for f in failed) and any("stem" in f for f in failed)

    def test_gate_uses_the_upper_bound_not_the_point_estimate(self):
        # 這正是上一版的漏洞：點估計 1/79=1.3% 看起來很低，但 95% 上界 6.8% 超過 5% 的目標。
        strict = C.AdmissionConfig(max_wrong_root_rate=0.05)
        failed = C.final_gate_failures(self._res(accepted=79, wrong=1), strict)
        assert failed and "95% 上界" in failed[0]
        fa = {f: (0, 1000) for f in C.FAMILIES}
        fa["sub1"] = (4, 1000)
        failed = C.final_gate_failures(self._res(fa=fa), self.CFG)
        assert any("sub1" in f and "95% 上界" in f for f in failed)

    def test_default_targets_are_documented_policy_values(self):
        assert self.CFG.max_wrong_root_rate == 0.10
        assert set(self.CFG.union_targets) == set(C.FAMILIES) and set(self.CFG.union_targets.values()) == {0.01}


class TestFingerprints:
    def test_headword_fingerprint_ignores_order_and_duplicates(self):
        assert C.headword_fingerprint(["b", "a", "a"]) == C.headword_fingerprint(["a", "b"])

    def test_same_size_but_different_content_differs(self):
        # 刪一個詞、加另一個詞，筆數不變——筆數指紋看不出來，內容雜湊必須看得出來。
        assert C.headword_fingerprint(["a", "b", "c"]) != C.headword_fingerprint(["a", "b", "d"])

    def test_headword_fingerprint_bytes_are_unchanged_by_the_refactor(self):
        # 放行檔裡已經記錄的詞庫指紋就是用這個格式算的；重構後格式必須逐位元組相同，否則所有既有放行檔都會變成過期。
        import hashlib
        assert C.headword_fingerprint(["b", "a", "a"]) == hashlib.sha256(b"a\nb\n").hexdigest()
        assert C.headword_fingerprint([]) == hashlib.sha256(b"").hexdigest()
        assert C.headword_fingerprint(["ʼa", "é"]) == hashlib.sha256("\n".join(sorted(["ʼa", "é"])).encode("utf-8") + b"\n").hexdigest()

    def test_attested_fingerprint_uses_the_same_format_and_is_order_independent(self):
        assert C.attested_fingerprint(["x", "y", "x"]) == C.attested_fingerprint(["y", "x"])
        assert C.attested_fingerprint(["x", "y"]) == C.headword_fingerprint(["x", "y"])
        assert C.attested_fingerprint(["x", "y"]) != C.attested_fingerprint(["x", "z"])

    def test_attested_fingerprint_accepts_any_iterable_including_generators(self):
        assert C.attested_fingerprint(w for w in ["b", "a"]) == C.attested_fingerprint(["a", "b"])

    @pytest.mark.parametrize("bad", [None, 5, b"x", ("a",)])
    def test_non_string_inputs_are_refused_instead_of_silently_skipped(self, bad):
        with pytest.raises(TypeError):
            C.attested_fingerprint(["ok", bad])
        with pytest.raises(TypeError):
            C.headword_fingerprint([bad])

    def test_pairs_fingerprint_is_order_independent_but_content_sensitive(self):
        p1, p2 = RootPair("t", "mafilo", ("filo",)), RootPair("t", "maalaw", ("alaw",))
        assert C.pairs_fingerprint([p1, p2]) == C.pairs_fingerprint([p2, p1])
        assert C.pairs_fingerprint([p1, p2]) != C.pairs_fingerprint([p1, RootPair("t", "maalaw", ("alo",))])


class TestRuleSerialization:
    @pytest.mark.parametrize("rule", [P_MA, MorphRule("S", a="an"), MorphRule("I", a="m", k=1),
                                      MorphRule("C", a="ma", b="ay"), MorphRule("R", k=2)])
    def test_round_trip(self, rule):
        assert C.rule_from_dict(C.rule_to_dict(rule)) == rule

    @pytest.mark.parametrize("bad", [
        None, [], "P", {"kind": 1}, {"kind": "P", "a": 5}, {"kind": "P", "a": "m", "k": True},
        {"kind": "P", "a": "m", "k": "1"}, {"kind": "X", "a": "m"}, {"kind": "P", "a": ""},
        {"kind": "I", "a": "m", "k": 0}, {"kind": "C", "a": "m"},
    ])
    def test_invalid_rules_raise_value_error(self, bad):
        with pytest.raises(ValueError):
            C.rule_from_dict(bad)

    def test_dumps_is_deterministic_sorted_and_keeps_chinese(self):
        a = {"tribes": {"b": {"x": 1, "reason": "停用"}, "a": {}}, "schema": 1}
        text = C.dumps_artifact(a)
        assert text == C.dumps_artifact(json.loads(text))
        assert "停用" in text and text.endswith("\n") and "\r" not in text
        assert text.index('"a"') < text.index('"b"')


class TestProfiles:
    def test_both_profiles_exist_and_strict_is_default_ladder(self):
        assert set(C.PROFILES) == {"strict", "balanced"}
        assert C.PROFILES["strict"][1] == C.TIGHTENING_LADDER

    def test_balanced_starts_looser_but_ends_at_the_same_strict_floor(self):
        overrides, ladder = C.PROFILES["balanced"]
        assert ladder[0][0] > C.TIGHTENING_LADDER[0][0] and ladder[-1] == C.TIGHTENING_LADDER[-1]
        assert overrides["max_wrong_root_rate"] > C.AdmissionConfig().max_wrong_root_rate
        assert min(overrides["union_targets"].values()) > min(C.AdmissionConfig().union_targets.values())


class TestEndToEndOnSyntheticLanguage:
    def test_a_clean_rule_is_admitted_and_passes_the_final_gate(self):
        pairs, lexicon = _synthetic_pairs(2200)
        art = C.build_tribe_artifact("syn", "tid", pairs, lexicon, set(), C.AdmissionConfig())
        assert art["enabled"], art["reason"]
        assert {C.rule_from_dict(r) for r in art["rules"]} >= {P_MA}
        ft = art["final_test"]
        assert ft["passed"] and ft["accepted"] >= C.MIN_FINAL_ACCEPTED and ft["wrong_root"] == 0
        assert art["fingerprint"]["n_headwords"] == len(lexicon)

    def test_the_whole_pipeline_is_deterministic(self):
        pairs, lexicon = _synthetic_pairs(900)
        a = C.dumps_artifact(C.build_artifact({"syn": C.build_tribe_artifact("syn", "tid", pairs, lexicon, set(), C.AdmissionConfig())}))
        b = C.dumps_artifact(C.build_artifact({"syn": C.build_tribe_artifact("syn", "tid", pairs, lexicon, set(), C.AdmissionConfig())}))
        assert a == b

    def test_too_little_data_disables_the_tribe_instead_of_lowering_the_bar(self):
        pairs, lexicon = _synthetic_pairs(60)
        art = C.build_tribe_artifact("syn", "tid", pairs, lexicon, set(), C.AdmissionConfig())
        assert art["enabled"] is False and art["rules"] == [] and art["reason"]

    def test_no_induced_rules_is_reported_as_insufficient_data(self):
        # 每個衍生詞的詞綴都不一樣：沒有任何規則能累積到最低出現次數，不是「門檻太嚴」，
        # 而是資料根本不夠歸納——原因文字要說對，不然只能靠猜。
        rng = random.Random(4)
        roots = ["".join(rng.choice("ptkbdgmnlrsh") + rng.choice("aiueo") for _ in range(3)) for _ in range(40)]
        pairs = [RootPair("t", f"x{i:03d}q" + r, (r,)) for i, r in enumerate(roots)]
        cal = C.calibrate_tribe(pairs, set(roots) | {p.derived for p in pairs}, set(), C.AdmissionConfig())
        assert cal.admitted == {} and cal.ladder_step is None and "資料不足" in cal.reason

    def test_a_tribe_that_passes_cross_validation_but_fails_the_final_gate_is_disabled_with_no_rules(self):
        # 最重要的安全路徑：交叉驗證選出了規則，但最終測試的證據不足以通過閘門（這裡用把
        # 最低證據量調到不可能達到來模擬）→ 必須整族停用、規則清空，而不是只標記停用卻留著規則。
        from unittest.mock import patch
        pairs, lexicon = _synthetic_pairs(2200)
        cfg = C.AdmissionConfig()
        assert C.calibrate_tribe(pairs, lexicon, set(), cfg).admitted      # 交叉驗證確實有放行規則
        with patch.object(C, "MIN_FINAL_ACCEPTED", 10 ** 6):
            art = C.build_tribe_artifact("syn", "tid", pairs, lexicon, set(), cfg)
        assert art["enabled"] is False and art["rules"] == []
        assert "最終測試未通過" in art["reason"] and art["final_test"]["passed"] is False
        assert art["final_test"]["failed_checks"]

    def test_final_report_removes_the_test_words_from_the_lexicon_it_evaluates_against(self):
        # 衍生詞本身就是詞條；正式環境它們在第一關就直接命中，不會進分析器。最終測試要把測試詞
        # 從詞庫拿掉才能模擬「沒見過的詞形」，否則成績是虛高的。
        pairs, lexicon = _synthetic_pairs(900)
        cal = C.calibrate_tribe(pairs, lexicon, set(), C.AdmissionConfig())
        seen = {}
        real_union = C.union_check

        def spy(admitted, reliability, held, lexicon_set, negatives, min_root_len):
            seen["lexicon"] = set(lexicon_set)
            return real_union(admitted, reliability, held, lexicon_set, negatives, min_root_len)

        from unittest.mock import patch
        with patch.object(C, "union_check", side_effect=spy):
            C.final_report(cal.admitted, pairs, lexicon, set(), C.AdmissionConfig())
        test_forms = {p.derived for p in pairs if C.is_final_test(p.tribe, p.derived)}
        assert test_forms and not (test_forms & seen["lexicon"])

    def test_the_final_test_is_never_used_for_calibration(self):
        pairs, lexicon = _synthetic_pairs(900)
        cal = C.calibrate_tribe(pairs, lexicon, set(), C.AdmissionConfig())
        final_forms = {p.derived for p in pairs if C.is_final_test(p.tribe, p.derived)}
        assert final_forms and cal.cv_pairs == len(pairs) - len(final_forms)

    def test_rules_never_see_the_held_out_words_in_the_lexicon(self):
        # 規則證據的詞庫要把留出折的衍生詞拿掉：若沒拿掉，留出詞自己就在詞庫裡，會讓
        # 「剝完在詞庫」的判斷多出不屬於真實情境的命中。
        pairs, lexicon = _synthetic_pairs(300)
        pool = [p for p in pairs if not C.is_final_test(p.tribe, p.derived)]
        _, fold_data, _ = C.collect_cv_evidence(pool, lexicon, set(), C.AdmissionConfig())
        for fd in fold_data:
            assert not ({p.derived for p in fd["held"]} & fd["lexicon"])

    def test_every_fold_only_uses_rules_induced_from_the_other_folds(self):
        pairs, lexicon = _synthetic_pairs(600)
        pool = [p for p in pairs if not C.is_final_test(p.tribe, p.derived)]
        cfg = C.AdmissionConfig()
        _, fold_data, per_fold = C.collect_cv_evidence(pool, lexicon, set(), cfg)
        for k, fd in enumerate(fold_data):
            train = [p for j, other in enumerate(fold_data) if j != k for p in other["held"]]
            expected = set(M.induce_rules(train, fd["lexicon"]))
            assert fd["rules"] == expected == set(per_fold[k])
            assert all(ev.fa_hard_trials > 0 for ev in per_fold[k].values())


class TestPooledUnionIsOutOfFold:
    def _fold(self, rules, derived="mafilo", root="filo"):
        return {"held": [RootPair("t", derived, (root,))], "lexicon": {root, "alaw"},
                "negatives": {f: [] for f in C.FAMILIES}, "rules": set(rules)}

    def test_a_rule_that_this_fold_could_not_have_learned_is_not_applied_to_it(self):
        # fold 0 的訓練資料歸納得出 P(ma)，fold 1 的歸納不出來：聯集檢查在 fold 1 不能用它，
        # 否則就是用了這一折「本來沒有」的規則，結果不是真正的折外預測。
        ev = {P_MA: C.RuleEvidence(hits=50, wrong=0)}
        fold_data = [self._fold({P_MA}), self._fold(set())]
        per_fold = [{P_MA: C.RuleEvidence(hits=25)}, {}]
        res = C.pooled_union({P_MA}, ev, fold_data, per_fold, 3)
        assert res.real_n == 2 and res.accepted == 1

    def test_reliability_for_a_fold_excludes_that_folds_own_evidence(self):
        # 兩折都有這條規則；排序用的可靠度要用「另一折」的證據，不含自己這折。
        seen = []
        real_union = C.union_check

        def spy(admitted, reliability, held, lexicon_set, negatives, min_root_len):
            seen.append(dict(reliability))
            return real_union(admitted, reliability, held, lexicon_set, negatives, min_root_len)

        from unittest.mock import patch
        per_fold = [{P_MA: C.RuleEvidence(hits=100, wrong=0)}, {P_MA: C.RuleEvidence(hits=0, wrong=40)}]
        total = C._sum_evidence(per_fold)
        with patch.object(C, "union_check", side_effect=spy):
            C.pooled_union({P_MA}, total, [self._fold({P_MA}), self._fold({P_MA})], per_fold, 3)
        assert seen[0][P_MA] == C.wilson_lower(0, 40)       # fold 0 只能看 fold 1 的證據
        assert seen[1][P_MA] == C.wilson_lower(100, 100)    # fold 1 只能看 fold 0 的證據

    def test_evidence_sum_adds_every_counter(self):
        a = {P_MA: C.RuleEvidence(1, 2, 3, 4)}
        b = {P_MA: C.RuleEvidence(10, 20, 30, 40), MorphRule("S", a="n"): C.RuleEvidence(5, 5, 5, 5)}
        t = C._sum_evidence([a, b])
        assert (t[P_MA].hits, t[P_MA].wrong, t[P_MA].fa_hard, t[P_MA].fa_hard_trials) == (11, 22, 33, 44)
        assert t[MorphRule("S", a="n")].hits == 5
