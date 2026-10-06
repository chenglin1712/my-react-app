"""二元預測（預測「下一題會不會答對」）的評估指標：AUC、log loss、Brier、校準度，以及以「使用者」為單位
的 cluster bootstrap 信賴區間。純函式、不依賴 numpy／sklearn。

為什麼用 cluster bootstrap：同一位學習者的多筆作答彼此相關，把每一筆當成獨立樣本會把信賴區間算得太窄。
重抽樣的單位是使用者，同一位使用者的所有作答一起被抽進來。

只報 AUC 會騙人：AUC 只看排序，機率完全失準也可以很高；所以永遠同時報 log loss、Brier 與校準誤差。
"""
from __future__ import annotations

import math
import random
from typing import Callable, Mapping, Sequence

EPS = 1e-6


def _check(y: Sequence[int], p: Sequence[float]) -> None:
    if len(y) != len(p):
        raise ValueError("y 與 p 長度不同")


def auc(y: Sequence[int], p: Sequence[float]) -> float | None:
    """ROC-AUC（Mann–Whitney，同分取平均名次）。只有單一類別時回傳 None。"""
    _check(y, p)
    pos = sum(1 for v in y if v)
    neg = len(y) - pos
    if pos == 0 or neg == 0:
        return None
    order = sorted(range(len(p)), key=lambda i: p[i])
    ranks = [0.0] * len(p)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and p[order[j + 1]] == p[order[i]]:
            j += 1
        average = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = average
        i = j + 1
    rank_sum_pos = sum(ranks[i] for i, v in enumerate(y) if v)
    return (rank_sum_pos - pos * (pos + 1) / 2.0) / (pos * neg)


def log_loss(y: Sequence[int], p: Sequence[float]) -> float | None:
    _check(y, p)
    if not y:
        return None
    total = 0.0
    for yi, pi in zip(y, p):
        pi = min(max(float(pi), EPS), 1.0 - EPS)
        total -= math.log(pi) if yi else math.log(1.0 - pi)
    return total / len(y)


def brier(y: Sequence[int], p: Sequence[float]) -> float | None:
    _check(y, p)
    if not y:
        return None
    return sum((float(pi) - (1.0 if yi else 0.0)) ** 2 for yi, pi in zip(y, p)) / len(y)


def calibration_bins(y: Sequence[int], p: Sequence[float], bins: int = 5) -> list[dict]:
    """把預測值等寬分成 bins 組，回傳每組的 {"mean_pred", "observed", "n"}（空的組略過）。"""
    _check(y, p)
    groups: list[list[tuple[int, float]]] = [[] for _ in range(bins)]
    for yi, pi in zip(y, p):
        groups[min(int(min(max(pi, 0.0), 1.0) * bins), bins - 1)].append((1 if yi else 0, float(pi)))
    return [{"mean_pred": sum(pi for _, pi in g) / len(g), "observed": sum(yi for yi, _ in g) / len(g), "n": len(g)}
            for g in groups if g]


def expected_calibration_error(y: Sequence[int], p: Sequence[float], bins: int = 5) -> float | None:
    if not y:
        return None
    return sum(b["n"] * abs(b["mean_pred"] - b["observed"]) for b in calibration_bins(y, p, bins)) / len(y)


def summarize(y: Sequence[int], p: Sequence[float]) -> dict:
    return {"n": len(y), "auc": auc(y, p), "log_loss": log_loss(y, p), "brier": brier(y, p),
            "ece": expected_calibration_error(y, p)}


def cluster_bootstrap_diff(by_cluster: Mapping[str, Sequence[tuple[int, float, float]]],
                           metric: Callable[[Sequence[int], Sequence[float]], float | None],
                           *, resamples: int = 1000, seed: int = 7, alpha: float = 0.05) -> dict:
    """比較兩個預測器 A、B 在同一批作答上的指標差（A - B）。by_cluster 是 {使用者: [(答對, A 的預測, B 的預測), …]}。
    回傳 {"diff": 全體的差, "low", "high": 以使用者為單位重抽樣的 (1-alpha) 信賴區間, "clusters": 使用者數}。
    指標算不出來（例如單一類別）的重抽樣會略過；有效重抽樣太少就不給區間。"""
    names = sorted(by_cluster)
    rng = random.Random(seed)

    def diff_for(sampled: Sequence[str]) -> float | None:
        y, pa, pb = [], [], []
        for name in sampled:
            for yi, a, b in by_cluster[name]:
                y.append(yi)
                pa.append(a)
                pb.append(b)
        ma, mb = metric(y, pa), metric(y, pb)
        return None if ma is None or mb is None else ma - mb

    overall = diff_for(names)
    draws = []
    if names:
        for _ in range(resamples):
            d = diff_for([names[rng.randrange(len(names))] for _ in names])
            if d is not None:
                draws.append(d)
    out = {"diff": overall, "low": None, "high": None, "clusters": len(names)}
    if len(draws) >= max(20, resamples // 2):
        draws.sort()
        out["low"] = draws[int((alpha / 2) * (len(draws) - 1))]
        out["high"] = draws[int((1 - alpha / 2) * (len(draws) - 1))]
    return out
