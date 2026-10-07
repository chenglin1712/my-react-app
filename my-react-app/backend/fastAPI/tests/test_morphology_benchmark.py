"""config/morphology_benchmark.py：M8 基準（final-v1 切分、重新評估、失敗分析）。

最重要的一組測試是「與 C.final_report 交叉驗證」：基準是另寫的逐筆版本，計數必須和校準流程當年算最終測試的函式完全一致，
否則「與放行檔記錄相同」這個重現檢查就沒有意義。
"""
import copy
import itertools
import json
import random
from unittest import mock

import pytest

from config import morphology as M
from config import morphology_benchmark as B
from config import morphology_calibration as C
from config.morphology import MorphRule, RootPair

TRIBE = "葛瑪蘭語"
P_MA = MorphRule("P", a="ma")
CFG = C.AdmissionConfig()


def _dataset(n=500, seed=7):
    """合成辭典：n 個隨機詞根，衍生詞 = ma + 詞根；少數詞根不在詞庫（測試「真詞」篩選）。"""
    rng = random.Random(seed)
    letters = "abdgiklmnpqrstuwy"
    roots, seen = [], set()
    while len(roots) < n:
        r = "".join(rng.choice(letters) for _ in range(rng.randint(4, 7)))
        if r not in seen:
            seen.add(r)
            roots.append(r)
    # 偶數位用 ma-（放行清單有），奇數位用 pa-（放行清單沒有）：後者是「規則形狀存在但沒放行」的未放行真詞
    pairs = [RootPair(TRIBE, ("ma" if i % 2 == 0 else "pa") + r, (r,)) for i, r in enumerate(roots)]
    lexicon = set(roots) | {p.derived for p in pairs}
    lexicon -= set(roots[:10])                   # 這些詞根不在詞庫：對應的配對不算「真詞」
    for r in roots[10:110]:                      # 100 筆刻意讓分析器選錯詞根的配對（最終測試約抽到 20 筆）
        pairs.append(RootPair(TRIBE, "ma" + r + "z", (r + "zq",)))
        lexicon |= {r + "z", r + "zq", "ma" + r + "z"}
    return pairs, lexicon, set()


def _dense_dataset(n=6000, seed=5):
    """詞根只有 3 個字母、詞庫佔了字母組合空間的三分之一：人工造的假詞容易碰巧剝出詞庫裡的詞，錯放行才會真的出現
    （稀疏資料裡它們幾乎永遠是 0，交叉驗證會變成兩邊都 0 的空轉）。"""
    rng = random.Random(seed)
    roots = rng.sample(["".join(t) for t in itertools.product(C._LETTERS, repeat=3)], n)
    pairs = [RootPair(TRIBE, ("ma" if i % 2 == 0 else "pa") + r, (r,)) for i, r in enumerate(roots)]
    return pairs, set(roots) | {p.derived for p in pairs}, set()


def _eval(pairs, lexicon, attested, reliability=None, max_items=20):
    return B.evaluate_split(pairs, lexicon, attested, reliability if reliability is not None else {P_MA: 0.95}, CFG, max_items)


class TestSplit:
    def test_descriptor_matches_the_calibration_split_function(self):
        assert B.SPLIT_LABEL == "final" and B.SPLIT_MODULUS == 5
        for i in range(300):
            d = f"w{i}x"
            assert (C._bucket(B.SPLIT_LABEL, TRIBE, d, B.SPLIT_MODULUS) == 0) == C.is_final_test(TRIBE, d)

    def test_split_membership_is_pinned_so_an_accidental_change_is_noticed(self):
        # 這幾個值是 final-v1 的定義：改了切分函式或標籤，這個測試會失敗，必須同時換 SPLIT_VERSION
        members = [i for i in range(40) if C.is_final_test(TRIBE, f"pin{i}")]
        assert members == [11, 12, 14, 15, 20, 31, 32, 33]

    def test_fraction_is_about_one_fifth(self):
        pairs, _, _ = _dataset(1000)
        assert 0.15 < len(B.split_pairs(pairs)) / len(pairs) < 0.25

    def test_fingerprint_depends_on_membership_not_on_roots_or_order(self):
        pairs, _, _ = _dataset()
        test = B.split_pairs(pairs)
        assert B.split_fingerprint(test) == B.split_fingerprint(list(reversed(test)))
        relabelled = [RootPair(p.tribe, p.derived, ("zzz",)) for p in test]
        assert B.split_fingerprint(relabelled) == B.split_fingerprint(test)
        assert B.split_fingerprint(test[1:]) != B.split_fingerprint(test)
        other_tribe = [RootPair("泰雅語", p.derived, p.roots) for p in test]
        assert B.split_fingerprint(other_tribe) != B.split_fingerprint(test)

    def test_lifecycle_says_the_split_is_consumed_and_must_not_be_tuned_on(self):
        life = B.SPLIT_DESCRIPTOR["lifecycle"]
        assert life["state"] == "consumed" and "不得" in life["policy"] and B.SPLIT_DESCRIPTOR["version"] == "final-v1"
        assert "不是成員清單" not in life["definition"] and "分派演算法" in life["definition"]   # 不宣稱成員清單凍結


class TestCrossCheckAgainstFinalReport:
    @pytest.mark.parametrize("seed,n", [(7, 500), (11, 300), (3, 800)])
    def test_counts_equal_the_calibration_final_report(self, seed, n):
        pairs, lexicon, attested = _dataset(n, seed)
        mine = _eval(pairs, lexicon, attested)
        theirs = C.final_report({P_MA: {"reliability": 0.95}}, pairs, lexicon, attested, CFG)
        for key in ("test_pairs", "real_evaluated", "accepted", "correct", "wrong_root"):
            assert mine[key] == theirs[key], key
        assert mine["accepted"] > 20          # 合成資料確實有東西可比，不是兩邊都 0
        for fam in C.FAMILIES:
            assert (mine["fa"][fam]["accepted"], mine["fa"][fam]["n"]) == (theirs["fa"][fam]["accepted"], theirs["fa"][fam]["n"]), fam
        assert mine["by_root_len"] == theirs["by_root_len"]
        assert B.compare_with_recorded(mine, theirs) == []

    def test_cross_check_is_not_vacuous_on_the_dense_dataset_false_accepts_actually_occur(self):
        pairs, lexicon, attested = _dense_dataset()
        mine = _eval(pairs, lexicon, attested)
        theirs = C.final_report({P_MA: {"reliability": 0.95}}, pairs, lexicon, attested, CFG)
        assert sum(v["accepted"] for v in mine["fa"].values()) > 3
        for fam in C.FAMILIES:
            assert (mine["fa"][fam]["accepted"], mine["fa"][fam]["n"]) == (theirs["fa"][fam]["accepted"], theirs["fa"][fam]["n"]), fam
        assert B.compare_with_recorded(mine, theirs) == []

    def test_cross_check_is_not_vacuous_for_wrong_roots_and_root_length_buckets(self):
        pairs, lexicon, attested = _dataset(500)
        mine = _eval(pairs, lexicon, attested)
        theirs = C.final_report({P_MA: {"reliability": 0.95}}, pairs, lexicon, attested, CFG)
        assert mine["wrong_root"] >= 5 and mine["wrong_root"] == theirs["wrong_root"]
        assert sum(b["wrong"] for b in mine["by_root_len"].values()) == mine["wrong_root"]
        assert mine["by_root_len"] == theirs["by_root_len"]

    def test_negatives_use_the_calibration_seed_and_the_held_out_lexicon(self):
        # 直接檢查傳給負例生成器的東西：種子必須是 f"{seed}|final"；測試詞必須已從詞庫與語料詞形拿掉
        pairs, lexicon, _ = _dataset()
        test = B.split_pairs(pairs)
        held = {p.derived for p in test}
        attested = set(held) | {"unrelated"}
        seen = {}
        real = C.generate_negatives

        def spy(p, lex, att, rng):
            seen.update(lex=set(lex), att=set(att), first=rng.random())
            return real(p, lex, att, random.Random(f"{CFG.seed}|final"))
        with mock.patch.object(C, "generate_negatives", side_effect=spy):
            _eval(pairs, lexicon, attested)
        assert seen["first"] == random.Random(f"{CFG.seed}|final").random()
        assert not (seen["lex"] & held) and not (seen["att"] & held)
        assert "unrelated" in seen["att"] and len(seen["lex"]) > 100

    def test_held_out_words_are_removed_from_the_lexicon_the_analyzer_uses(self):
        # w 與 ma+w 都是 final-v1 成員：測試詞從詞庫拿掉之後，「ma+w 的詞根是 w」才不算真詞（詞根 ma+w 不在詞庫）
        w = next("".join(k) for k in itertools.product("abdgik", repeat=4)
                 if C.is_final_test(TRIBE, "ma" + "".join(k)) and C.is_final_test(TRIBE, "mama" + "".join(k)))
        pairs = [RootPair(TRIBE, "ma" + w, (w,)), RootPair(TRIBE, "mama" + w, ("ma" + w,))]
        lex = {w, "ma" + w, "mama" + w}
        r = B.evaluate_split(pairs, lex, set(), {P_MA: 0.95}, CFG, 10)
        assert r["real_evaluated"] == 1 and r["accepted"] == 1

    def test_attested_forms_change_the_negatives_and_are_removed_for_held_words(self):
        pairs, lexicon, _ = _dataset()
        test = B.split_pairs(pairs)
        attested = {test[0].derived}                     # 測試詞出現在語料詞形：要和詞庫一樣先拿掉
        mine = _eval(pairs, lexicon, attested)
        theirs = C.final_report({P_MA: {"reliability": 0.95}}, pairs, lexicon, attested, CFG)
        assert mine["fa"] == {f: {"accepted": theirs["fa"][f]["accepted"], "n": theirs["fa"][f]["n"]} for f in C.FAMILIES}

    def test_no_admitted_rules_matches_the_calibration_too(self):
        pairs, lexicon, attested = _dataset()
        mine = _eval(pairs, lexicon, attested, reliability={})
        theirs = C.final_report({}, pairs, lexicon, attested, CFG)
        assert (mine["real_evaluated"], mine["accepted"], mine["correct"], mine["wrong_root"]) == \
               (theirs["real_evaluated"], 0, 0, 0)
        assert mine["metrics"]["release_rate"]["value"] == 0.0 and mine["metrics"]["precision"]["value"] is None


class TestDeterminismAndShape:
    def test_same_inputs_give_identical_output_even_with_shuffled_inputs(self):
        pairs, lexicon, attested = _dataset()
        a = _eval(pairs, lexicon, attested)
        shuffled = list(pairs)
        random.Random(1).shuffle(shuffled)
        b = _eval(shuffled, set(lexicon), set(attested))
        assert json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)

    def test_max_items_truncates_lists_but_never_counts(self):
        pairs, lexicon, attested = _dataset(800)
        full = _eval(pairs, lexicon, attested, max_items=10_000)
        small = _eval(pairs, lexicon, attested, max_items=2)
        assert small["failure_analysis"]["real_words"] == full["failure_analysis"]["real_words"]
        assert small["fa"] == full["fa"]
        assert all(len(v) <= 2 for v in small["failure_analysis"]["missed_items"].values())
        long_list = full["failure_analysis"]["missed_items"]["rule_not_admitted"]
        assert len(long_list) > 5                      # 清單真的有內容，下面的截斷比對才有意義
        assert small["failure_analysis"]["missed_items"]["rule_not_admitted"] == long_list[:2]
        assert full["failure_analysis"]["real_words"]["missed"]["rule_not_admitted"] == len(long_list)
        assert max_items_ok(small) and small["failure_analysis"]["max_items"] == 2

    def test_wrong_root_list_is_truncated_exactly_at_max_items(self):
        pairs, lexicon, attested = _dataset(500)
        full = _eval(pairs, lexicon, attested, max_items=10_000)
        assert full["wrong_root"] >= 5
        assert len(full["failure_analysis"]["wrong_root_items"]) == full["wrong_root"]
        assert len(_eval(pairs, lexicon, attested, max_items=3)["failure_analysis"]["wrong_root_items"]) == 3

    def test_zero_max_items_lists_nothing_but_counts_everything(self):
        pairs, lexicon, attested = _dataset()
        r = _eval(pairs, lexicon, attested, max_items=0)
        assert r["failure_analysis"]["wrong_root_items"] == [] and r["accepted"] > 0

    def test_lists_are_sorted_by_derived_form(self):
        pairs, lexicon, attested = _dataset(800)
        items = _eval(pairs, lexicon, attested, max_items=10_000)["failure_analysis"]["missed_items"]["rule_not_admitted"]
        keys = [i["derived"] for i in items]
        assert len(keys) > 5 and keys == sorted(keys)


def max_items_ok(result):
    fa = result["failure_analysis"]
    return len(fa["wrong_root_items"]) <= fa["max_items"] and all(len(v) <= fa["max_items"] for v in fa["false_accept_items"].values())


class TestFailureAnalysis:
    def test_wrong_root_is_listed_with_prediction_and_rule(self):
        # 衍生詞 "ma"+key 標註的詞根是 key+"q"；分析器剝掉 ma- 得到 key（也在詞庫）→ 錯詞根
        key = "aaaa"
        assert C.is_final_test(TRIBE, "ma" + key)          # 這個衍生詞落在 final-v1
        pairs = [RootPair(TRIBE, "ma" + key, (key + "q",))]
        lex = {key, key + "q", "ma" + key}
        r = B.evaluate_split(pairs, lex, set(), {P_MA: 0.95}, CFG, 10)
        assert (r["real_evaluated"], r["accepted"], r["wrong_root"]) == (1, 1, 1)
        item = r["failure_analysis"]["wrong_root_items"][0]
        assert item == {"derived": "ma" + key, "gold_roots": [key + "q"], "predicted_root": key, "rule": "ma-"}

    def test_missed_categories(self):
        lexicon_roots = {"alaw", "filo", "sapi"}
        gold = []
        # no_derivation：衍生詞與詞根毫無規則關係
        d1 = next(f"zz{i}" for i in range(2000) if C.is_final_test(TRIBE, f"zz{i}"))
        gold.append(RootPair(TRIBE, d1, ("alaw",)))
        # rule_not_admitted：有前綴規則形狀（pa-）可推出，但放行清單只有 ma-
        d2 = next(f"pafilo{i}" for i in range(2000) if C.is_final_test(TRIBE, f"pafilo{i}"))
        gold.append(RootPair(TRIBE, d2, ("filo",)))
        lex = lexicon_roots | {p.derived for p in gold}
        r = B.evaluate_split(gold, lex, set(), {P_MA: 0.95}, CFG, 10)
        miss = r["failure_analysis"]["real_words"]["missed"]
        assert miss["no_derivation"] == 1 and miss["rule_not_admitted"] == 1 and miss["blocked_by_analyzer"] == 0
        assert r["accepted"] == 0
        assert [i["derived"] for i in r["failure_analysis"]["missed_items"]["rule_not_admitted"]] == [d2]

    def test_blocked_by_analyzer_is_reported_when_an_admitted_rule_applies_but_the_root_is_too_short(self):
        # ma- 在放行清單裡，可以從只有 2 個字母的詞根推出衍生詞；但詞根低於 min_root_len(3)，分析器不給答案
        two = next("".join(t) for t in itertools.product("abdgikl", repeat=2) if C.is_final_test(TRIBE, "ma" + "".join(t)))
        pairs = [RootPair(TRIBE, "ma" + two, (two,))]
        r = B.evaluate_split(pairs, {two, "ma" + two}, set(), {P_MA: 0.95}, CFG, 10)
        miss = r["failure_analysis"]["real_words"]["missed"]
        assert (r["real_evaluated"], r["accepted"]) == (1, 0)
        assert miss["blocked_by_analyzer"] == 1 and miss["rule_not_admitted"] == 0 and miss["no_derivation"] == 0

    def test_gold_roots_are_listed_in_sorted_order_and_duplicates_have_a_stable_order(self):
        key = "aaaa"
        assert C.is_final_test(TRIBE, "ma" + key)
        roots = (key + "z", key + "q")
        a = [RootPair(TRIBE, "ma" + key, roots), RootPair(TRIBE, "ma" + key, (key + "a",))]
        lex = {key, *roots, key + "a", "ma" + key}
        one = B.evaluate_split(a, lex, set(), {P_MA: 0.95}, CFG, 10)
        two = B.evaluate_split(list(reversed(a)), lex, set(), {P_MA: 0.95}, CFG, 10)
        assert json.dumps(one, sort_keys=True) == json.dumps(two, sort_keys=True)
        assert all(item["gold_roots"] == sorted(item["gold_roots"]) for item in one["failure_analysis"]["wrong_root_items"])

    def test_false_accepts_are_listed_by_family_and_match_the_counts(self):
        pairs, lexicon, attested = _dense_dataset()
        r = _eval(pairs, lexicon, attested, max_items=10_000)
        assert sum(v["accepted"] for v in r["fa"].values()) > 3
        for fam in C.FAMILIES:
            items = r["failure_analysis"]["false_accept_items"][fam]
            assert len(items) == r["fa"][fam]["accepted"]
            assert [i["form"] for i in items] == sorted(i["form"] for i in items)
            assert all(i["rule"] == "ma-" for i in items)

    def test_miss_category_only_considers_roots_that_are_in_the_lexicon(self):
        # roots=("filo","pafilo")：只有 filo 在詞庫。能從 filo 推出 "mapafilo..." 的只有別的前綴規則（沒放行）；
        # 若錯把不在詞庫的 pafilo 也算進去，ma- 規則看起來能推出，會被誤分成 blocked_by_analyzer
        tail = next("".join(t) for t in itertools.product("abdgikl", repeat=2) if C.is_final_test(TRIBE, "mapafilo" + "".join(t)))
        d = "mapafilo" + tail
        pairs = [RootPair(TRIBE, d, ("filo" + tail, "pafilo" + tail))]
        lex = {"filo" + tail, d}
        r = B.evaluate_split(pairs, lex, set(), {P_MA: 0.95}, CFG, 10)
        assert r["failure_analysis"]["real_words"]["missed"]["rule_not_admitted"] == 1
        assert r["failure_analysis"]["real_words"]["missed"]["blocked_by_analyzer"] == 0


class TestCompareWithRecorded:
    def _recorded(self):
        pairs, lexicon, attested = _dataset()
        return _eval(pairs, lexicon, attested), C.final_report({P_MA: {"reliability": 0.95}}, pairs, lexicon, attested, CFG)

    def test_no_record_means_none(self):
        mine, _ = self._recorded()
        assert B.compare_with_recorded(mine, None) is None
        assert B.compare_with_recorded(mine, "x") is None

    @pytest.mark.parametrize("field", ["test_pairs", "real_evaluated", "accepted", "correct", "wrong_root"])
    def test_each_scalar_difference_is_named(self, field):
        mine, rec = self._recorded()
        rec = copy.deepcopy(rec)
        rec[field] += 1
        assert B.compare_with_recorded(mine, rec) == [field]

    def test_false_accept_and_root_length_differences_are_named(self):
        mine, rec = self._recorded()
        rec = copy.deepcopy(rec)
        rec["fa"]["stem"]["n"] += 1
        rec["by_root_len"] = {}
        assert B.compare_with_recorded(mine, rec) == ["fa.stem", "by_root_len"]

    def test_missing_fields_in_the_record_are_differences_not_crashes(self):
        mine, _ = self._recorded()
        assert B.compare_with_recorded(mine, {}) != []
