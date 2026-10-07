"""config/morphology_reporting.py：凍結的數字定義、放行檔計數驗證、四層狀態。"""
import copy
import math

import pytest

from config import morphology_calibration as C
from config import morphology_reporting as R


def _wilson(k, n, z=1.96):
    """測試裡獨立重寫一份公式，不呼叫被測的實作。"""
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def _ft(**kw):
    ft = {
        "passed": True, "failed_checks": [], "test_pairs": 1076, "real_evaluated": 962, "accepted": 79,
        "correct": 78, "wrong_root": 1, "wrong_root_upper": 0.0683,
        "fa": {f: {"accepted": 0, "n": 1000, "rate": 0.0, "upper": 0.0038} for f in C.FAMILIES},
        "by_root_len": {}, "incremental_over_existing": {"accepted": 55, "correct": 55},
    }
    ft.update(kw)
    return ft


def _row(tribe="amis", h=True, p=True, loadable=True):
    return {"tribe": tribe, "headwords_match": h, "pairs_match": p, "loadable": loadable, "loadable_reason": "",
            "now": {"n_headwords": 1}}


CONFIG = {"max_wrong_root_rate": 0.10, "union_targets": {f: 0.01 for f in C.FAMILIES}}


def _entry(ft="default", enabled=True, config="default"):
    return {"enabled": enabled, "reason": "", "final_test": _ft() if ft == "default" else ft,
            "config": dict(CONFIG) if config == "default" else config}


class TestRatio:
    @pytest.mark.parametrize("k,n", [(79, 962), (78, 79), (1, 79), (0, 1000), (1000, 1000), (1, 1)])
    def test_matches_an_independent_wilson_formula(self, k, n):
        r = R.ratio(k, n)
        lo, hi = _wilson(k, n)
        assert (r["k"], r["n"]) == (k, n)
        assert r["value"] == round(k / n, 6) and r["lo"] == round(lo, 6) and r["hi"] == round(hi, 6)

    def test_zero_denominator_is_null_not_zero_and_interval_is_unit(self):
        r = R.ratio(0, 0)
        assert r["value"] is None and (r["lo"], r["hi"]) == (0.0, 1.0)

    def test_real_amis_numbers_match_the_documented_values(self):
        rel, pre = R.ratio(79, 962), R.ratio(78, 79)
        assert (round(rel["value"], 3), round(rel["lo"], 3), round(rel["hi"], 3)) == (0.082, 0.066, 0.101)
        assert (round(pre["value"], 3), round(pre["lo"], 3), round(pre["hi"], 3)) == (0.987, 0.932, 0.998)


class TestValidateFinalTest:
    def test_a_real_looking_entry_is_valid(self):
        assert R.validate_final_test(_ft(), CONFIG) == []

    def test_real_artifact_entries_are_valid_under_their_own_config(self):
        import json
        from pathlib import Path
        data = json.loads((Path(C.__file__).parent / "morphology_rules.json").read_text(encoding="utf-8"))
        checked = 0
        for entry in data["tribes"].values():
            if entry["final_test"] is not None:
                assert R.validate_final_test(entry["final_test"], entry["config"]) == []
                checked += 1
        assert checked >= 1

    def test_hand_edited_pass_with_too_little_evidence_is_caught_by_recomputing_the_gate(self):
        # passed=True、failed_checks=[]，但只接受 5 筆（< 30）：計數自洽，閘門重算卻不會過
        thin = _ft(accepted=5, correct=5, wrong_root=0)
        assert any("重算" in p for p in R.validate_final_test(thin, CONFIG))

    def test_hand_edited_pass_with_too_few_negatives_or_high_false_accepts_is_caught(self):
        few = _ft()
        few["fa"]["stem"] = {"accepted": 0, "n": 100}
        assert R.validate_final_test(few, CONFIG)
        leaky = _ft()
        leaky["fa"]["rand"] = {"accepted": 50, "n": 1000}
        assert R.validate_final_test(leaky, CONFIG)

    def test_a_genuinely_failed_gate_is_consistent_when_recorded_as_failed(self):
        thin = _ft(accepted=5, correct=5, wrong_root=0, passed=False, failed_checks=["證據不足"])
        assert R.validate_final_test(thin, CONFIG) == []

    @pytest.mark.parametrize("config", [None, {}, {"max_wrong_root_rate": 0.1}, {"max_wrong_root_rate": True, "union_targets": {}},
                                          {"max_wrong_root_rate": 0.1, "union_targets": {"stem": 0.01}},
                                          {"max_wrong_root_rate": 2, "union_targets": {f: 0.01 for f in C.FAMILIES}}])
    def test_missing_or_bad_config_means_the_gate_cannot_be_recomputed(self, config):
        assert any("config" in p for p in R.validate_final_test(_ft(), config))

    @pytest.mark.parametrize("patch", [
        {"accepted": 963}, {"real_evaluated": 1077}, {"correct": 79}, {"wrong_root": 2},
        {"accepted": -1}, {"accepted": True}, {"accepted": 79.0}, {"correct": None},
        {"passed": False}, {"failed_checks": ["x"]}, {"passed": "yes"}, {"fa": {}},
    ])
    def test_inconsistent_entries_are_rejected(self, patch):
        assert R.validate_final_test(_ft(**patch))

    def test_false_accept_counts_must_be_sane(self):
        bad = _ft()
        bad["fa"]["stem"] = {"accepted": 5, "n": 3}
        assert R.validate_final_test(bad)
        missing = _ft()
        del missing["fa"]["rand"]
        assert R.validate_final_test(missing)

    def test_non_dict_is_rejected_without_raising(self):
        for v in (None, [], "x", 5):
            assert R.validate_final_test(v)


class TestLayers:
    def test_fresh_valid_passed(self):
        t = R.tribe_capability(_row(), _entry())
        assert t["layers"] == {"input_freshness": "fresh", "artifact_integrity": "valid",
                               "runtime_rebuild_loadable": True, "gate": "passed"}
        assert t["snapshot_stale"] is False and t["metrics"]["accepted"] == 79

    def test_stale_row_keeps_numbers_but_is_marked_a_snapshot(self):
        t = R.tribe_capability(_row(h=False), _entry())
        assert t["layers"]["input_freshness"] == "stale" and t["snapshot_stale"] is True
        assert t["metrics"] is not None

    def test_either_fingerprint_mismatch_is_stale_and_none_is_unknown(self):
        assert R.tribe_capability(_row(p=False), _entry())["layers"]["input_freshness"] == "stale"
        assert R.tribe_capability(_row(h=None, p=None), _entry())["layers"]["input_freshness"] == "unknown"
        assert R.tribe_capability(_row(h=True, p=None), _entry())["layers"]["input_freshness"] == "unknown"

    def test_disabled_without_final_test_is_valid_and_has_no_metrics(self):
        t = R.tribe_capability(_row(loadable=False), _entry(ft=None, enabled=False))
        assert t["layers"]["gate"] == "disabled" and t["layers"]["artifact_integrity"] == "valid" and t["metrics"] is None

    def test_enabled_without_final_test_is_invalid(self):
        t = R.tribe_capability(_row(), _entry(ft=None, enabled=True))
        assert t["layers"]["artifact_integrity"] == "invalid" and t["layers"]["gate"] == "unknown" and t["metrics"] is None

    def test_invalid_counts_suppress_all_metrics(self):
        t = R.tribe_capability(_row(), _entry(ft=_ft(accepted=5000)))
        assert t["layers"]["artifact_integrity"] == "invalid" and t["metrics"] is None and t["problems"]

    def test_failed_gate_is_reported_as_failed_with_metrics(self):
        thin_fail = _ft(accepted=5, correct=5, wrong_root=0, passed=False, failed_checks=["證據不足"])
        t = R.tribe_capability(_row(loadable=False), _entry(ft=thin_fail, enabled=False))
        assert t["layers"]["gate"] == "failed" and t["metrics"] is not None

    def test_a_pass_recorded_as_failed_despite_strong_evidence_is_a_contradiction(self):
        t = R.tribe_capability(_row(loadable=False), _entry(ft=_ft(passed=False, failed_checks=["x"]), enabled=False))
        assert t["layers"]["artifact_integrity"] == "invalid" and t["metrics"] is None

    def test_missing_artifact_entry_is_unknown(self):
        t = R.tribe_capability(_row(h=None, p=None, loadable=False), None)
        assert t["layers"]["artifact_integrity"] == "unknown" and t["artifact_enabled"] is None

    @pytest.mark.parametrize("enabled", [None, "true", 1, 0])
    def test_non_boolean_enabled_is_invalid(self, enabled):
        t = R.tribe_capability(_row(), _entry(enabled=enabled))
        assert t["layers"]["artifact_integrity"] == "invalid" and t["metrics"] is None

    def test_enabled_true_with_a_failed_gate_is_a_contradiction(self):
        t = R.tribe_capability(_row(), _entry(ft=_ft(passed=False, failed_checks=["x"]), enabled=True))
        assert t["layers"]["artifact_integrity"] == "invalid" and t["layers"]["gate"] == "unknown"

    def test_hand_edited_thin_pass_is_invalid_not_passed(self):
        t = R.tribe_capability(_row(), _entry(ft=_ft(accepted=5, correct=5, wrong_root=0)))
        assert t["layers"]["artifact_integrity"] == "invalid" and t["layers"]["gate"] == "unknown" and t["metrics"] is None

    def test_missing_config_makes_a_present_final_test_untrustworthy(self):
        t = R.tribe_capability(_row(), _entry(config=None))
        assert t["layers"]["artifact_integrity"] == "invalid"

    @pytest.mark.parametrize("h,p", [("false", True), (True, 1), (1, 1), ("x", "y")])
    def test_non_boolean_fingerprint_matches_are_unknown_not_fresh(self, h, p):
        assert R.tribe_capability(_row(h=h, p=p), _entry())["layers"]["input_freshness"] == "unknown"

    @pytest.mark.parametrize("loadable", ["no", 1, "true", None])
    def test_loadable_is_true_only_for_the_boolean_true(self, loadable):
        assert R.tribe_capability(_row(loadable=loadable), _entry())["layers"]["runtime_rebuild_loadable"] is False

    def test_loadable_is_independent_of_the_other_layers(self):
        # 指紋一致、完整性正常、閘門通過，但執行期判斷說不能載入（例如產生器版本過期）
        t = R.tribe_capability(_row(loadable=False), _entry())
        assert t["layers"]["runtime_rebuild_loadable"] is False and t["layers"]["gate"] == "passed"


class TestBuildReport:
    def _inputs(self):
        return {"artifact_generator": "g", "artifact_error": None, "tribes": [_row("tayal"), _row("amis")]}

    def test_order_follows_the_inputs_and_is_deterministic(self):
        a = R.build_report(self._inputs(), {"amis": _entry(), "tayal": _entry(ft=None, enabled=False)})
        b = R.build_report(self._inputs(), {"tayal": _entry(ft=None, enabled=False), "amis": _entry()})
        assert a == b and [t["tribe"] for t in a["tribes"]] == ["tayal", "amis"]

    def test_unreadable_artifact_yields_unknown_layers_not_an_exception(self):
        r = R.build_report({"artifact_generator": None, "artifact_error": "ValueError",
                            "tribes": [_row("amis", None, None, False)]}, None)
        assert r["tribes"][0]["layers"]["artifact_integrity"] == "unknown" and r["artifact_error"] == "ValueError"

    def test_inputs_are_not_mutated(self):
        entries = {"amis": _entry(), "tayal": _entry()}
        snap = copy.deepcopy(entries)
        R.build_report(self._inputs(), entries)
        assert entries == snap

    def test_report_declares_version_and_definitions(self):
        r = R.build_report(self._inputs(), {})
        assert r["report_version"] == R.REPORT_VERSION and "release_rate" in r["definitions"]
