"""評測報告：彙整分數、記錄這次用的模型與提示詞版本、和基準比較（路線圖 #29）。

「退步就擋下」的做法：基準檔（baseline.json）是某個被認可的版本的分數；每次評測跟它比，
任一類別的規則通過率下降超過容許值、或評審平均分下降超過容許值，就判定退步，指令以失敗結束。
題數很少，所以容許值要放得合理（預設通過率 0.1、評審 0.5）：這是抓明顯退步的煙霧測試，不是統計檢定。
"""
import json
import random
from collections import defaultdict
from pathlib import Path

EVALS_DIR = Path(__file__).resolve().parent
BASELINE_PATH = EVALS_DIR / "baseline.json"
RESULTS_DIR = EVALS_DIR / "results"

DEFAULT_RULE_TOLERANCE = 0.1
DEFAULT_JUDGE_TOLERANCE = 0.5
MAX_JUDGE_FAILURE_RATE = 0.2         # 一個類別超過兩成的評審失敗，就不拿分數來比


def summarize(rows: list[dict]) -> dict:
    """rows: [{id, category, rules:{passed,...}, judge: {score,...}|None, judged: bool}] → 各類別與整體分數。"""
    by_category = defaultdict(list)
    for row in rows:
        by_category[row["category"]].append(row)

    def stats(items):
        judged = [r["judge"]["score"] for r in items if r.get("judge")]
        return {
            "n": len(items),
            "rule_pass_rate": round(sum(r["rules"]["passed"] for r in items) / len(items), 4) if items else None,
            "judge_mean": round(sum(judged) / len(judged), 3) if judged else None,
            "judged": len(judged),
            "judge_failed": sum(1 for r in items if r.get("judged") and not r.get("judge")),
        }

    return {"overall": stats(rows), "categories": {c: stats(items) for c, items in sorted(by_category.items())}}


def pick_human_review(rows: list[dict], *, fraction: float = 0.1, minimum: int = 3, seed: int = 1) -> list[dict]:
    """抽樣一部分「有評審分數」的題目請人工核對評審有沒有看走眼。
    分數兩端（1~2 與 5）各優先抽一些：最能看出評審是否失準的是它打極端分數的案例。"""
    judged = [r for r in rows if r.get("judge")]
    if not judged:
        return []
    count = min(len(judged), max(minimum, round(len(judged) * fraction)))
    rng = random.Random(seed)
    extremes = [r for r in judged if r["judge"]["score"] <= 2 or r["judge"]["score"] == 5]
    middle = [r for r in judged if r not in extremes]
    rng.shuffle(extremes)
    rng.shuffle(middle)
    chosen = (extremes + middle)[:count]
    return [{"id": r["id"], "category": r["category"], "message": r["message"], "reply": r["reply"],
             "judge": r["judge"]} for r in chosen]


def build_report(*, label: str, rows: list[dict], meta: dict) -> dict:
    return {"label": label, "meta": meta, "summary": summarize(rows), "human_review": pick_human_review(rows), "cases": rows}


def compare(report: dict, baseline: dict, *, rule_tolerance: float = DEFAULT_RULE_TOLERANCE,
            judge_tolerance: float = DEFAULT_JUDGE_TOLERANCE) -> list[str]:
    """回傳退步清單（空清單＝沒有退步）。只比兩邊都有的類別；基準沒有的新類別不算退步。"""
    problems = []
    before_categories = baseline.get("summary", {}).get("categories", {})
    now_categories = report["summary"]["categories"]
    for category in before_categories:
        if category not in now_categories:
            problems.append(f"{category}：基準有這個類別，這次沒有跑到（題組被刪除或沒跑完？）")
    for category, now in now_categories.items():
        # 評審失敗太多：分數是用剩下的題目算的，已經不可信，不能拿來判定「沒退步」
        asked = now["judged"] + now["judge_failed"]
        if asked and now["judge_failed"] / asked > MAX_JUDGE_FAILURE_RATE:
            problems.append(f"{category}：{now['judge_failed']}/{asked} 題評審失敗，評審分數不可信")
        before = before_categories.get(category)
        if not before:
            continue
        # 題數少的類別，一題之差就是很大的比例；容許值至少要等於「一題」，才不會被雜訊誤判成退步
        noise = 1 / max(min(now["n"], before["n"]), 1)
        if None not in (now["rule_pass_rate"], before["rule_pass_rate"]):
            drop = before["rule_pass_rate"] - now["rule_pass_rate"]
            if drop > max(rule_tolerance, noise):
                problems.append(f"{category}：規則通過率 {before['rule_pass_rate']:.0%} → {now['rule_pass_rate']:.0%}")
        if None not in (now["judge_mean"], before["judge_mean"]):
            drop = before["judge_mean"] - now["judge_mean"]
            if drop > judge_tolerance:
                problems.append(f"{category}：評審平均 {before['judge_mean']:.2f} → {now['judge_mean']:.2f}")
    return problems


def describe_change(report: dict, baseline: dict) -> list[str]:
    """基準與這次用的模型、提示詞版本有沒有不同（換模型或改提示詞後比較分數時，要知道比的是什麼）。"""
    notes = []
    for key, label in (("chat_model", "回答模型"), ("judge_model", "評審模型"), ("prompt_version", "提示詞版本")):
        old, new = baseline.get("meta", {}).get(key), report["meta"].get(key)
        if old != new:
            notes.append(f"{label}：{old} → {new}")
    return notes


def load_baseline(path: Path | None = None) -> dict | None:
    path = path or BASELINE_PATH            # 呼叫時才取值（測試與不同環境可以換掉基準檔位置）
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
