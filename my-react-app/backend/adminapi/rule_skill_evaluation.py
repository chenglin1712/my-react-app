"""比較「規則熟練度」與「單一能力值」誰更能預測學習者下一題會不會答對（事件資料來自 QuizSkillEvent）。

**這是預測準確度的比較，不是學習成效的證據**：預測得準不代表適性出題讓人學得更好；後者需要隨機對照或
前後測。報告永遠要同時給 log loss、Brier、AUC 與校準誤差，並附 cluster bootstrap 信賴區間（以使用者為單位）。

預測值是作答【之前】由伺服器記下的前瞻預測（見 adminapi/models/quiz_research.py），不是事後回算，所以不需要
再切訓練／測試集，也不會洩漏答案。只用 probe 事件（這題真的在測某條規則、而且當時有規則預測）。

比較的預測器：
- skill：伺服器當時的規則熟練度估計（簡化 BKT）；
- ability：既有單一能力值（IRT）；
- rule_rate：同一位使用者在同一條規則上過去答對率的 Beta(1,1) 平滑（只靠次數、不假設學習模型），
  從事件序列重算；
- prior：全體到目前為止的答對率（常數基線）。
資料不足（事件或使用者太少）時只列描述性數字，不做比較，也不下結論。
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Mapping

from config import prediction_metrics as PM

MIN_EVENTS = 300
MIN_USERS = 20
STRATA = ((1, 4, "每條規則第 1–4 次"), (5, 9, "第 5–9 次"), (10, None, "第 10 次以後"))
PREDICTORS = ("skill", "ability", "rule_rate", "prior")
METRICS = {"log_loss": PM.log_loss, "brier": PM.brier, "auc": PM.auc}


def _usable(event: Mapping) -> bool:
    return bool(event.get("probe")) and event.get("pred_skill") is not None and event.get("pred_ability") is not None \
        and bool(event.get("target_rule_id"))


def build_rows(events: Iterable[Mapping]) -> list[dict]:
    """依 (使用者, 事件順序) 排序後，替每一筆算出四個預測器在作答前的預測值，以及這條規則已是第幾次觀察。"""
    ordered = sorted((e for e in events if _usable(e)), key=lambda e: (e["pseudonym"], e["order"]))
    seen: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])      # (使用者, 規則) -> [次數, 答對]
    global_n = global_c = 0
    rows = []
    for event in ordered:
        key = (event["pseudonym"], event["target_rule_id"])
        n, c = seen[key]
        y = 1 if event["correct"] else 0
        rows.append({
            "user": event["pseudonym"], "tribe": event.get("tribe", ""), "y": y, "exposure": n + 1,
            "skill": float(event["pred_skill"]), "ability": float(event["pred_ability"]),
            "rule_rate": (c + 1.0) / (n + 2.0), "prior": (global_c + 1.0) / (global_n + 2.0),
        })
        seen[key] = [n + 1, c + y]
        global_n += 1
        global_c += y
    return rows


def _metrics(rows: list[dict]) -> dict:
    y = [r["y"] for r in rows]
    return {name: PM.summarize(y, [r[name] for r in rows]) for name in PREDICTORS}


def _compare(rows: list[dict], a: str, b: str, resamples: int, seed: int) -> dict:
    by_user: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for r in rows:
        by_user[r["user"]].append((r["y"], r[a], r[b]))
    return {name: PM.cluster_bootstrap_diff(by_user, fn, resamples=resamples, seed=seed) for name, fn in METRICS.items()}


def evaluate(events: Iterable[Mapping], *, resamples: int = 500, seed: int = 7) -> dict:
    rows = build_rows(events)
    users = {r["user"] for r in rows}
    report = {"events": len(rows), "users": len(users), "overall": _metrics(rows) if rows else {},
              "enough_data": len(rows) >= MIN_EVENTS and len(users) >= MIN_USERS,
              "min_events": MIN_EVENTS, "min_users": MIN_USERS, "strata": [], "comparisons": {},
              "calibration": {}}
    if rows:
        for low, high, label in STRATA:
            subset = [r for r in rows if r["exposure"] >= low and (high is None or r["exposure"] <= high)]
            if subset:
                report["strata"].append({"label": label, **_metrics(subset)})
        report["calibration"] = {name: PM.calibration_bins([r["y"] for r in rows], [r[name] for r in rows])
                                 for name in ("skill", "ability")}
    if report["enough_data"]:
        report["comparisons"] = {
            "skill_vs_ability": _compare(rows, "skill", "ability", resamples, seed),
            "skill_vs_rule_rate": _compare(rows, "skill", "rule_rate", resamples, seed),
        }
    return report


def _fmt(value, digits=3) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def verdict(comparison: Mapping) -> str:
    """依 log loss 的信賴區間下結論：區間完全在 0 的哪一邊才算有差異，否則「看不出差異」。差值 = skill − 對照，
    log loss 越低越好，所以區間在 0 以下代表 skill 預測得更準。"""
    ll = comparison.get("log_loss", {})
    low, high = ll.get("low"), ll.get("high")
    if low is None or high is None:
        return "無法判斷（重抽樣不足）"
    if high < 0:
        return "規則熟練度的預測較準（log loss 信賴區間全部在 0 以下）"
    if low > 0:
        return "對照組的預測較準（log loss 信賴區間全部在 0 以上）"
    return "看不出兩者有差異（信賴區間跨過 0）"


def format_report(report: Mapping) -> str:
    lines = [f"事件 {report['events']} 筆、使用者 {report['users']} 位（比較門檻：事件 >= {report['min_events']} 且使用者 >= {report['min_users']}）"]
    for name, m in report["overall"].items():
        lines.append(f"  {name:<10} log loss {_fmt(m['log_loss'])}  Brier {_fmt(m['brier'])}  AUC {_fmt(m['auc'])}  校準誤差 {_fmt(m['ece'])}")
    for stratum in report["strata"]:
        lines.append(f"  [{stratum['label']}] n={stratum['skill']['n']}  "
                     + "  ".join(f"{name} log loss {_fmt(stratum[name]['log_loss'])}" for name in PREDICTORS))
    if not report["enough_data"]:
        lines.append("資料不足：只列描述性數字，不做比較、不下結論。")
    for key, comparison in report["comparisons"].items():
        lines.append(f"  {key}：" + verdict(comparison))
        for metric, d in comparison.items():
            lines.append(f"    {metric}：差 {_fmt(d['diff'], 4)}，95% 區間 [{_fmt(d['low'], 4)}, {_fmt(d['high'], 4)}]（{d['clusters']} 位使用者）")
    lines.append("注意：這是預測準確度的比較。預測得準不代表適性出題讓人學得更好，那需要隨機對照或前後測。")
    return "\n".join(lines)
