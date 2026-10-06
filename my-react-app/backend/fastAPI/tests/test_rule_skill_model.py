"""config/rule_skill_model.py：規則技能 ID、簡化 BKT、混淆計數、輸入清洗的單元測試。"""
import math

import pytest

from config import rule_skill_model as R


class TestRuleId:
    def test_round_trip_all_kinds(self):
        cases = [("amis", "P", "pa", "", 0), ("kavalan", "S", "an", "", 0),
                 ("tayal", "I", "in", "", 1), ("amis", "C", "ma", "ay", 0)]
        for tribe, kind, a, b, k in cases:
            rid = R.rule_id(tribe, kind, a, b, k)
            assert R.parse_rule_id(rid) == (tribe, kind, a, b, k)

    def test_special_characters_cannot_break_the_format(self):
        # 詞綴含分隔字元（| > .）也必須能來回、且不會變成別的欄位
        for a in ("p|a", "a>b", "a.b", "s'a", "ṣ", "a%7Cb"):
            rid = R.rule_id("amis", "P", a)
            assert rid.count("|") == 5
            assert ">" not in rid and "." not in rid
            assert R.parse_rule_id(rid) == ("amis", "P", a, "", 0)

    def test_same_affix_different_tribe_or_position_is_different_skill(self):
        assert R.rule_id("amis", "P", "pa") != R.rule_id("kavalan", "P", "pa")
        assert R.rule_id("tayal", "I", "in", k=1) != R.rule_id("tayal", "I", "in", k=2)

    @pytest.mark.parametrize("bad", [
        None, 5, "", "pa-", "v2|amis|P|pa||0", "v1|klingon|P|pa||0", "v1|amis|R|pa||0",
        "v1|amis|P||0", "v1|amis|P|pa||x", "v1|amis|P||| 0", "v1|amis|P|pa|ma|0",   # 前綴不能有 b
        "v1|amis|C|ma||0",                                                        # 環綴一定有 b
        "v1|amis|I|in||0", "v1|amis|P|pa||3",                                      # 中綴 k>0、非中綴 k=0
        "v1|amis|P|%70a||0",                                                       # 等價別寫，不是正規形式
        "v1|amis|P|" + "a" * 33 + "||0", "v1|amis|I|in||99", "x" * 300,
    ])
    def test_rejects_non_canonical_or_invalid_ids(self, bad):
        assert R.parse_rule_id(bad) is None

    def test_labels(self):
        assert R.rule_label(R.rule_id("amis", "P", "pa")) == "pa-"
        assert R.rule_label(R.rule_id("amis", "S", "en")) == "-en"
        assert R.rule_label(R.rule_id("tayal", "I", "in", k=1)) == "-in-（第 1 個字母後）"
        assert R.rule_label(R.rule_id("amis", "C", "ma", "ay")) == "ma-…-ay"
        assert R.rule_label("garbage") == "garbage"

    def test_tribe_of(self):
        assert R.tribe_of(R.rule_id("bunun", "P", "ma")) == "bunun"
        assert R.tribe_of("nope") is None


class TestBkt:
    def test_correct_raises_and_wrong_lowers_estimate(self):
        p = 0.5
        assert R.bkt_update(p, True) > p
        # 答錯會降低後驗，但學習機率會拉回一點；從 0.5 起算仍然要比答對低
        assert R.bkt_update(p, False) < R.bkt_update(p, True)
        assert R.bkt_update(0.9, False) < 0.9

    def test_matches_hand_computed_value(self):
        p = 0.35
        posterior = p * 0.9 / (p * 0.9 + 0.65 * 0.25)
        assert R.bkt_update(p, True) == pytest.approx(posterior + (1 - posterior) * R.P_LEARN)
        posterior_w = p * 0.1 / (p * 0.1 + 0.65 * 0.75)
        assert R.bkt_update(p, False) == pytest.approx(posterior_w + (1 - posterior_w) * R.P_LEARN)

    def test_stays_in_unit_interval_at_extremes(self):
        for p in (0.0, 1.0, 1e-12, 1 - 1e-12):
            for correct in (True, False):
                assert 0.0 <= R.bkt_update(p, correct) <= 1.0

    def test_repeated_correct_converges_upward_and_never_exceeds_one(self):
        p = R.P_INIT
        for _ in range(200):
            p = R.bkt_update(p, True)
        assert 0.95 < p <= 1.0

    def test_predict_correct_bounds(self):
        assert R.predict_correct(0.0) == pytest.approx(R.P_GUESS)
        assert R.predict_correct(1.0) == pytest.approx(1.0 - R.P_SLIP)
        assert R.P_GUESS < R.predict_correct(0.5) < 1.0 - R.P_SLIP

    def test_smoothed_rate_baseline(self):
        assert R.smoothed_rate({"n": 0, "c": 0}) == 0.5
        assert R.smoothed_rate({"n": 8, "c": 6}) == pytest.approx(0.7)
        assert R.smoothed_rate({}) == 0.5


class TestApplyObservation:
    RID = R.rule_id("amis", "P", "pa")

    def test_first_observation_creates_skill_from_prior(self):
        skills = {}
        before, after = R.apply_observation(skills, self.RID, True)
        assert before == R.P_INIT and after > before
        assert skills[self.RID] == {"p": after, "n": 1, "c": 1, "v": R.MODEL_VERSION}

    def test_counts_track_correct_and_wrong(self):
        skills = {}
        for correct in (True, False, True, False, False):
            R.apply_observation(skills, self.RID, correct)
        assert skills[self.RID]["n"] == 5 and skills[self.RID]["c"] == 2

    def test_only_target_skill_changes(self):
        other = R.rule_id("amis", "P", "ma")
        skills = {other: {"p": 0.8, "n": 9, "c": 8, "v": R.MODEL_VERSION}}
        R.apply_observation(skills, self.RID, False)
        assert skills[other] == {"p": 0.8, "n": 9, "c": 8, "v": R.MODEL_VERSION}

    def test_evicts_least_evidence_skill_when_full(self):
        skills = {R.rule_id("amis", "P", f"x{i}"): {"p": 0.5, "n": 10 + i, "c": 5, "v": "v"} for i in range(R.MAX_RULE_SKILLS)}
        weakest = R.rule_id("amis", "P", "x0")          # n 最小
        R.apply_observation(skills, self.RID, True)
        assert len(skills) == R.MAX_RULE_SKILLS
        assert weakest not in skills and self.RID in skills

    def test_counts_are_capped(self):
        skills = {self.RID: {"p": 0.5, "n": R.MAX_COUNT, "c": R.MAX_COUNT, "v": "v"}}
        R.apply_observation(skills, self.RID, True)
        assert skills[self.RID]["n"] == R.MAX_COUNT and skills[self.RID]["c"] == R.MAX_COUNT


class TestConfusions:
    A = R.rule_id("amis", "P", "pa")
    B = R.rule_id("amis", "P", "ma")

    def test_counts_and_split(self):
        conf = {}
        R.add_confusion(conf, self.A, self.B)
        R.add_confusion(conf, self.A, self.B)
        assert conf == {f"{self.A}>{self.B}": 2}
        assert R.split_confusion_key(f"{self.A}>{self.B}") == (self.A, self.B)

    def test_split_rejects_garbage(self):
        for bad in ("", "a>b", f"{self.A}", f"{self.A}>x", f">{self.B}"):
            assert R.split_confusion_key(bad) is None

    def test_evicts_lowest_count_when_full(self):
        conf = {f"{R.rule_id('amis', 'P', f'a{i}')}>{self.B}": 5 + i for i in range(R.MAX_CONFUSIONS)}
        lowest = f"{R.rule_id('amis', 'P', 'a0')}>{self.B}"
        R.add_confusion(conf, self.A, self.B)
        assert len(conf) == R.MAX_CONFUSIONS and lowest not in conf and f"{self.A}>{self.B}" in conf


class TestSanitize:
    GOOD = R.rule_id("amis", "P", "pa")

    def test_keeps_valid_entries(self):
        raw = {self.GOOD: {"p": 0.4, "n": 6, "c": 3, "v": "bkt-blend-1"}}
        assert R.sanitize_rule_skills(raw) == raw

    def test_non_dict_inputs_become_empty(self):
        for raw in (None, [], "x", 5):
            assert R.sanitize_rule_skills(raw) == {}
            assert R.sanitize_rule_confusions(raw) == {}

    @pytest.mark.parametrize("entry", [
        {"p": 1.5, "n": 1, "c": 1}, {"p": -0.1, "n": 1, "c": 1}, {"p": "x", "n": 1, "c": 1},
        {"p": float("nan"), "n": 1, "c": 1}, {"p": float("inf"), "n": 1, "c": 1}, {"p": True, "n": 1, "c": 1},
        {"p": 0.5, "n": -1, "c": 0}, {"p": 0.5, "n": 1, "c": 2}, {"p": 0.5, "n": 1.5, "c": 1},
        {"p": 0.5, "n": True, "c": 0}, {"p": 0.5, "n": R.MAX_COUNT + 1, "c": 0}, {"p": 0.5}, "str", None,
    ])
    def test_drops_invalid_values(self, entry):
        assert R.sanitize_rule_skills({self.GOOD: entry}) == {}

    def test_drops_non_canonical_keys(self):
        assert R.sanitize_rule_skills({"pa-": {"p": 0.5, "n": 1, "c": 1}}) == {}

    def test_bad_entries_do_not_poison_good_ones(self):
        other = R.rule_id("amis", "S", "en")
        raw = {self.GOOD: {"p": 9, "n": 1, "c": 1}, other: {"p": 0.5, "n": 2, "c": 1}}
        assert list(R.sanitize_rule_skills(raw)) == [other]

    def test_truncates_to_cap(self):
        raw = {R.rule_id("amis", "P", f"x{i}"): {"p": 0.5, "n": 1, "c": 1} for i in range(R.MAX_RULE_SKILLS + 20)}
        assert len(R.sanitize_rule_skills(raw)) == R.MAX_RULE_SKILLS

    def test_whole_float_counts_are_accepted_as_ints(self):
        out = R.sanitize_rule_skills({self.GOOD: {"p": 0.5, "n": 4.0, "c": 2.0}})
        assert out[self.GOOD]["n"] == 4 and isinstance(out[self.GOOD]["n"], int)

    def test_unknown_or_oversized_version_is_replaced(self):
        out = R.sanitize_rule_skills({self.GOOD: {"p": 0.5, "n": 1, "c": 1, "v": "x" * 99}})
        assert out[self.GOOD]["v"] == R.MODEL_VERSION

    def test_confusions_validation(self):
        b = R.rule_id("amis", "P", "ma")
        good = f"{self.GOOD}>{b}"
        assert R.sanitize_rule_confusions({good: 3}) == {good: 3}
        for bad_value in (0, -1, "3", None, True, 2.5, R.MAX_COUNT + 1):
            assert R.sanitize_rule_confusions({good: bad_value}) == {}
        assert R.sanitize_rule_confusions({"junk": 3, f"{good}>{b}": 3}) == {}


class TestSummaries:
    def test_weakest_rules_needs_enough_data_and_low_estimate(self):
        a, b, c = (R.rule_id("amis", "P", x) for x in ("pa", "ma", "sa"))
        skills = {
            a: {"p": 0.3, "n": 6, "c": 2, "v": "v"},     # 夠資料、偏低 → 列出
            b: {"p": 0.1, "n": 4, "c": 0, "v": "v"},     # 資料不足 → 不列
            c: {"p": 0.9, "n": 20, "c": 19, "v": "v"},   # 熟練 → 不列
        }
        rows = R.weakest_rules(skills)
        assert [r["rule"] for r in rows] == [a] and rows[0]["label"] == "pa-"

    def test_weakest_rules_sorted_and_limited(self):
        skills = {R.rule_id("amis", "P", f"x{i}"): {"p": 0.1 + i / 100, "n": 9, "c": 1, "v": "v"} for i in range(6)}
        rows = R.weakest_rules(skills, limit=3)
        assert [r["p"] for r in rows] == sorted(r["p"] for r in rows) and len(rows) == 3

    def test_threshold_boundary_is_exclusive(self):
        rid = R.rule_id("amis", "P", "pa")
        assert R.weakest_rules({rid: {"p": R.WEAK_THRESHOLD, "n": 9, "c": 4, "v": "v"}}) == []
        assert R.weakest_rules({rid: {"p": R.WEAK_THRESHOLD - 0.01, "n": R.MIN_OBS_FOR_ESTIMATE, "c": 1, "v": "v"}})

    def test_top_confusions_sorted_by_count(self):
        a, b, c = (R.rule_id("amis", "P", x) for x in ("pa", "ma", "sa"))
        conf = {f"{a}>{b}": 2, f"{a}>{c}": 5, "junk": 9}
        rows = R.top_confusions(conf)
        assert [(r["selected"], r["count"]) for r in rows] == [(c, 5), (b, 2)]
        assert rows[0]["targetLabel"] == "pa-" and rows[0]["selectedLabel"] == "sa-"

    def test_has_enough_data(self):
        assert not R.has_enough_data(None)
        assert not R.has_enough_data({"n": R.MIN_OBS_FOR_ESTIMATE - 1})
        assert R.has_enough_data({"n": R.MIN_OBS_FOR_ESTIMATE})

    def test_estimate_of_defaults_to_prior(self):
        assert R.estimate_of({}, "x") == R.P_INIT
        assert math.isclose(R.estimate_of({"x": {"p": 0.7}}, "x"), 0.7)


class TestOverallAndBlend:
    RID = R.rule_id("amis", "P", "pa")

    def test_overall_rate_is_a_smoothed_rate_with_a_neutral_prior(self):
        assert R.overall_rate(None) == 0.5 and R.overall_rate({}) == 0.5 and R.overall_rate({"n": 0, "c": 0}) == 0.5
        assert R.overall_rate({"n": 6, "c": 6}) == pytest.approx((6 + 2) / (6 + 4))
        assert R.overall_rate({"n": 6, "c": 0}) == pytest.approx(2 / 10)

    def test_with_no_rule_observations_the_prediction_is_the_overall_rate(self):
        overall = {"n": 20, "c": 17}
        assert R.blended_prediction({}, self.RID, overall) == pytest.approx(R.overall_rate(overall))

    def test_weight_on_the_rule_grows_with_its_observations(self):
        overall = {"n": 20, "c": 10}
        rule_pred = R.predict_correct(0.95)
        previous = None
        for n in (1, 3, 6, 12, 60):
            skills = {self.RID: {"p": 0.95, "n": n, "c": n, "v": "v"}}
            pred = R.blended_prediction(skills, self.RID, overall)
            weight = n / (n + R.BLEND_K)
            assert pred == pytest.approx(weight * rule_pred + (1 - weight) * R.overall_rate(overall))
            assert previous is None or pred > previous                 # 規則很強、整體普通：越相信規則預測越高
            previous = pred

    def test_the_blend_stays_between_its_two_ingredients(self):
        skills = {self.RID: {"p": 0.2, "n": 4, "c": 1, "v": "v"}}
        for overall in ({"n": 0, "c": 0}, {"n": 30, "c": 29}, {"n": 30, "c": 2}):
            blended = R.blended_prediction(skills, self.RID, overall)
            low, high = sorted((R.predict_correct(0.2), R.overall_rate(overall)))
            assert low - 1e-12 <= blended <= high + 1e-12

    def test_another_rules_skill_does_not_leak_into_the_prediction(self):
        other = R.rule_id("amis", "P", "ma")
        skills = {other: {"p": 0.99, "n": 50, "c": 50, "v": "v"}}
        assert R.blended_prediction(skills, self.RID, {"n": 10, "c": 5}) == R.blended_prediction({}, self.RID, {"n": 10, "c": 5})

    def test_add_overall_counts_and_caps(self):
        overall = {"n": 0, "c": 0}
        for correct in (True, False, True):
            R.add_overall(overall, correct)
        assert overall == {"n": 3, "c": 2}
        capped = {"n": R.MAX_COUNT, "c": R.MAX_COUNT}
        R.add_overall(capped, True)
        assert capped == {"n": R.MAX_COUNT, "c": R.MAX_COUNT}
        R.add_overall({}, True)                                       # 缺欄位視為 0

    def test_add_overall_fills_in_missing_fields(self):
        overall = {}
        R.add_overall(overall, True)
        assert overall == {"n": 1, "c": 1}

    @pytest.mark.parametrize("bad", [None, [], "x", {"n": -1, "c": 0}, {"n": 3, "c": 4}, {"n": "3", "c": 1}, {"n": 3},
                                     {"n": True, "c": 0}, {"n": 2.5, "c": 1}, {"n": R.MAX_COUNT + 1, "c": 0}])
    def test_sanitize_overall_resets_invalid_values(self, bad):
        assert R.sanitize_overall(bad) == {"n": 0, "c": 0}

    def test_sanitize_overall_keeps_valid_values(self):
        assert R.sanitize_overall({"n": 9, "c": 4}) == {"n": 9, "c": 4}
        assert R.sanitize_overall({"n": 9.0, "c": 4.0}) == {"n": 9, "c": 4}

    def test_model_version_identifies_the_blended_model(self):
        assert R.MODEL_VERSION == "bkt-blend-1"


class TestRuleIdFixturesSharedWithTheFrontend:
    """frontend/components/_quiz/ruleSkillView.test.js 用同樣的字串驗證前端的解析；兩邊有一邊改格式，測試就會失敗。"""

    def test_exact_strings(self):
        assert R.rule_id("amis", "P", "pa") == "v1|amis|P|pa||0"
        assert R.rule_id("kavalan", "S", "an") == "v1|kavalan|S|an||0"
        assert R.rule_id("tayal", "I", "in", k=1) == "v1|tayal|I|in||1"
        assert R.rule_id("amis", "C", "ma", "ay") == "v1|amis|C|ma|ay|0"
        assert R.rule_id("amis", "P", "s'a") == "v1|amis|P|s%27a||0"
        assert R.rule_id("amis", "P", "p|a") == "v1|amis|P|p%7Ca||0"
        assert R.rule_id("amis", "P", "a.b") == "v1|amis|P|a%2Eb||0"

    def test_the_frontend_rejects_what_the_backend_rejects(self):
        for bad in ("v2|amis|P|pa||0", "v1|klingon|P|pa||0", "v1|amis|R|pa||0", "v1|amis|P|pa|ma|0",
                    "v1|amis|C|ma||0", "v1|amis|I|in||0", "v1|amis|P|pa||3"):
            assert R.parse_rule_id(bad) is None

