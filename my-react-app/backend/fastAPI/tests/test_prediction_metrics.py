"""config/prediction_metrics.py：AUC、log loss、Brier、校準、cluster bootstrap。

用手算得出的小例子驗證數值，不是只檢查「有回傳」。"""
import math
import random

import pytest

from config import prediction_metrics as M


class TestAuc:
    def test_perfect_and_inverted_and_random(self):
        assert M.auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]) == 1.0
        assert M.auc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]) == 0.0
        assert M.auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]) == 0.5

    def test_hand_computed_value(self):
        # 正例分數 0.8、0.4；負例 0.6、0.2。配對：0.8>0.6 ✓、0.8>0.2 ✓、0.4>0.6 ✗、0.4>0.2 ✓ → 3/4
        assert M.auc([1, 1, 0, 0], [0.8, 0.4, 0.6, 0.2]) == 0.75

    def test_ties_count_half(self):
        # 正 0.5 對負 0.5 平手 → 0.5；正 0.5 對負 0.1 → 1 ；平均 0.75
        assert M.auc([1, 0, 0], [0.5, 0.5, 0.1]) == 0.75

    def test_single_class_is_undefined(self):
        assert M.auc([1, 1, 1], [0.1, 0.2, 0.3]) is None and M.auc([0, 0], [0.1, 0.2]) is None and M.auc([], []) is None

    def test_matches_a_brute_force_pairwise_count_on_random_data(self):
        rng = random.Random(3)
        for _ in range(30):
            y = [rng.randint(0, 1) for _ in range(40)]
            p = [round(rng.random(), 1) for _ in range(40)]           # 故意大量同分
            pos = [pi for yi, pi in zip(y, p) if yi]
            neg = [pi for yi, pi in zip(y, p) if not yi]
            if not pos or not neg:
                continue
            wins = sum(1.0 if a > b else 0.5 if a == b else 0.0 for a in pos for b in neg)
            assert M.auc(y, p) == pytest.approx(wins / (len(pos) * len(neg)))

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            M.auc([1], [0.5, 0.6])


class TestLogLossAndBrier:
    def test_log_loss_hand_computed(self):
        assert M.log_loss([1, 0], [0.9, 0.2]) == pytest.approx(-(math.log(0.9) + math.log(0.8)) / 2)

    def test_certain_wrong_prediction_is_finite(self):
        assert math.isfinite(M.log_loss([1], [0.0])) and math.isfinite(M.log_loss([0], [1.0]))

    def test_constant_half_gives_ln2(self):
        assert M.log_loss([1, 0, 1, 0], [0.5] * 4) == pytest.approx(math.log(2))

    def test_brier_hand_computed(self):
        assert M.brier([1, 0], [0.8, 0.3]) == pytest.approx(((0.2) ** 2 + (0.3) ** 2) / 2)
        assert M.brier([1, 1], [1.0, 1.0]) == 0.0

    def test_empty_inputs(self):
        assert M.log_loss([], []) is None and M.brier([], []) is None and M.expected_calibration_error([], []) is None

    def test_better_predictor_has_lower_loss(self):
        y = [1, 1, 1, 0, 0, 1, 0, 1]
        good = [0.9 if v else 0.2 for v in y]
        assert M.log_loss(y, good) < M.log_loss(y, [0.5] * len(y)) and M.brier(y, good) < M.brier(y, [0.5] * len(y))


class TestCalibration:
    def test_bins_and_ece(self):
        y = [1, 1, 0, 0, 1, 0]
        p = [0.9, 0.9, 0.1, 0.1, 0.9, 0.1]
        bins = M.calibration_bins(y, p, bins=5)
        assert [(round(b["mean_pred"], 1), b["observed"], b["n"]) for b in bins] == [(0.1, 0.0, 3), (0.9, 1.0, 3)]
        assert M.expected_calibration_error(y, p) == pytest.approx(0.1)

    def test_overconfident_predictor_has_larger_ece(self):
        y = [1, 0] * 20
        assert M.expected_calibration_error(y, [0.95, 0.05] * 20) > M.expected_calibration_error(y, [0.5] * 40)

    def test_prediction_of_exactly_one_falls_in_the_last_bin(self):
        assert M.calibration_bins([1], [1.0], bins=5) == [{"mean_pred": 1.0, "observed": 1.0, "n": 1}]

    def test_summarize_has_all_metrics(self):
        out = M.summarize([1, 0, 1, 0], [0.8, 0.3, 0.6, 0.4])
        assert set(out) == {"n", "auc", "log_loss", "brier", "ece"} and out["n"] == 4 and out["auc"] == 1.0


def _clusters(n_users=30, per_user=12, seed=1):
    rng = random.Random(seed)
    data = {}
    for u in range(n_users):
        rows = []
        for _ in range(per_user):
            truth = rng.random()
            y = 1 if rng.random() < truth else 0
            rows.append((y, min(max(truth + rng.gauss(0, 0.05), 0.01), 0.99), 0.5))      # A 很準，B 是常數
        data[f"u{u}"] = rows
    return data


class TestClusterBootstrap:
    def test_a_clearly_better_predictor_has_an_interval_below_zero_for_log_loss(self):
        out = M.cluster_bootstrap_diff(_clusters(), M.log_loss, resamples=300)
        assert out["clusters"] == 30 and out["diff"] < 0 and out["high"] < 0 and out["low"] < out["diff"] < out["high"]

    def test_identical_predictors_straddle_zero(self):
        data = {u: [(y, a, a) for y, a, _ in rows] for u, rows in _clusters().items()}
        out = M.cluster_bootstrap_diff(data, M.log_loss, resamples=200)
        assert out["diff"] == 0 and out["low"] == 0 and out["high"] == 0

    def test_is_reproducible_with_a_seed(self):
        a = M.cluster_bootstrap_diff(_clusters(), M.log_loss, resamples=100, seed=5)
        assert a == M.cluster_bootstrap_diff(_clusters(), M.log_loss, resamples=100, seed=5)
        assert a != M.cluster_bootstrap_diff(_clusters(), M.log_loss, resamples=100, seed=6)

    def test_resamples_whole_users_not_single_events(self):
        # 每位使用者全對或全錯：以事件為單位會把區間算得太窄；以使用者為單位區間要明顯較寬
        users = {f"u{i}": [(i % 2, 0.5 + 0.3 * (i % 2), 0.5)] * 10 for i in range(10)}
        wide = M.cluster_bootstrap_diff(users, M.brier, resamples=300)
        events = {f"e{i}": [(users[f"u{i // 10}"][0][0], users[f"u{i // 10}"][0][1], 0.5)] for i in range(100)}
        narrow = M.cluster_bootstrap_diff(events, M.brier, resamples=300)
        assert (wide["high"] - wide["low"]) > (narrow["high"] - narrow["low"])

    def test_undefined_metric_gives_no_interval(self):
        single_class = {f"u{i}": [(1, 0.6, 0.5)] for i in range(10)}
        out = M.cluster_bootstrap_diff(single_class, M.auc, resamples=50)
        assert out["diff"] is None and out["low"] is None and out["high"] is None

    def test_empty_input(self):
        assert M.cluster_bootstrap_diff({}, M.auc) == {"diff": None, "low": None, "high": None, "clusters": 0}
