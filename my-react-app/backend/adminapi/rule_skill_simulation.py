"""模擬學習者：檢驗「規則熟練度模型」的評估流程本身可不可信（不是證明它對真人有效）。

**為什麼不能用同一個 BKT 生成再用 BKT 還原**：那樣一定贏，什麼都證明不了。這裡的「真實學習者」用完全不同
的機制生成，跟被測的簡化 BKT 刻意不一致：
- 每條規則有各自的真實技能 s_r，跟「整體能力」g 的相關係數 rho 可調（rho=1 代表其實只有一種整體能力）；
- 作答機率是 logistic（猜對率每題不同，不是固定的 0.25），技能隨練習緩慢成長、沒練的時候緩慢遺忘；
- 一部分題目測不到規則（隨機干擾項）：那些題目只反映整體詞彙熟悉度；
- 規則歸屬可能被標錯（label_noise）。

**一定要有負對照**：one_skill_control 的真實世界只有一種整體能力（rho=1），規則熟練度模型不該贏過單一
能力值；如果它贏了，代表評估流程有問題（例如洩漏答案）。

被比較的預測器都只在「作答之前」預測、作答後才更新，跟正式環境記下的前瞻預測同一個流程；事件交給跟正式環境
完全相同的 rule_skill_evaluation.evaluate() 計算，所以這也是對評估程式碼的端到端測試。

單一能力值那一邊用的是正式環境的 IRT 函式（irt.compute_P_theta、update_theta、compute_Dq_and_bw），
不是另寫一個簡化版。
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace

from config import rule_skill_model as R
from fastAPI.routes.quiz import irt

from adminapi import rule_skill_evaluation as EV


@dataclass(frozen=True)
class Scenario:
    name: str
    description: str
    learners: int = 60
    rules: int = 8
    questions: int = 90
    rho: float = 0.5                       # 規則技能與整體能力的相關係數
    guess_low: float = 0.15
    guess_high: float = 0.40
    learn_rate: float = 0.15               # 每次練習某條規則，技能增加 learn_rate * log(1 + 練習次數) 的成長
    forget: float = 0.002                  # 每題所有規則的技能衰減（被練習的那條除外）
    probe_rate: float = 0.6                # 這一題測得到規則（有引擎干擾項）的機率
    label_noise: float = 0.0               # 規則歸屬被標錯的機率
    seed: int = 7


SCENARIOS = {s.name: s for s in (
    Scenario("baseline", "規則技能與整體能力中度相關，猜對率每題不同（0.15–0.40）"),
    Scenario("one_skill_control", "【負對照】只有一種整體能力（rho=1）：規則熟練度模型不該贏", rho=1.0),
    Scenario("independent_skills", "規則技能彼此獨立（rho=0），各規則強弱差異大", rho=0.0),
    Scenario("misattributed", "15% 的規則歸屬被標錯", rho=0.3, label_noise=0.15),
    Scenario("fast_learning", "學得很快（技能快速成長）", rho=0.3, learn_rate=0.6),
    Scenario("sparse", "每位學習者只作答 25 題", rho=0.3, questions=25),
    Scenario("wrong_guess_prior", "真實猜對率 0.35–0.50，高於模型假設的 0.25", rho=0.3, guess_low=0.35, guess_high=0.50),
)}


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


class AbilityPredictor:
    """單一能力值預測器：沿用 api.submit_answer_frontend 的 IRT 計算鏈（逐字錯誤率、題型錯誤率、單一 ability）。"""

    QTYPE = "sentence-fill"

    def __init__(self):
        self.theta = 0.5
        self.word = {}                      # 字 -> [錯誤次數, 作答次數]
        self.qtype = [0, 0]

    def _bw(self, word: str) -> float:
        e, n = self.word.get(word, (0, 0))
        dw = irt.compute_smoothed_error_rate(e, n)
        dt = irt.compute_smoothed_error_rate(*self.qtype)
        return irt.compute_Dq_and_bw(dw, dt, 0.5)[1]

    def predict(self, word: str) -> float:
        return irt.compute_P_theta(self.theta, self._bw(word), irt.TYPE_AQ.get(self.QTYPE, 1.0), irt.DEFAULT_GUESS)

    def update(self, word: str, correct: bool) -> None:
        p = self.predict(word)
        self.theta = irt.update_theta(self.theta, correct, p, irt.LEARNING_RATE)
        e, n = self.word.get(word, (0, 0))
        self.word[word] = (e + (0 if correct else 1), n + 1)
        self.qtype = [self.qtype[0] + (0 if correct else 1), self.qtype[1] + 1]


def run(scenario: Scenario, outcomes: dict | None = None) -> dict:
    """跑完整個模擬，回傳 {"events": [...事件...], "recovery": 弱點還原指標}。
    outcomes 是測試用的反事實開關：{(學習者序號, 題序): 強制的答對與否}，用來驗證預測不依賴它自己的結果；
    亂數流程不受影響（結果照常抽出，再被覆蓋）。"""
    rng = random.Random(scenario.seed)
    rule_ids = [R.rule_id("amis", "P", f"r{i}") for i in range(scenario.rules)]
    events = []
    spearmans, recalls = [], []
    order = 0
    for learner in range(scenario.learners):
        user = f"sim-{learner}"
        g = rng.gauss(0, 1)
        skill = [scenario.rho * g + math.sqrt(max(0.0, 1 - scenario.rho ** 2)) * rng.gauss(0, 1) for _ in rule_ids]
        practiced = [0] * len(rule_ids)
        ability = AbilityPredictor()
        estimated: dict = {}
        overall = {"n": 0, "c": 0}                           # 整體表現：所有題目（含測不到規則的）都計入
        for step in range(scenario.questions):
            guess = rng.uniform(scenario.guess_low, scenario.guess_high)
            difficulty = rng.gauss(0, 0.7)
            word = f"w{rng.randrange(40)}"
            is_probe = rng.random() < scenario.probe_rate
            if is_probe:
                r = rng.randrange(len(rule_ids))
                effective = skill[r] + scenario.learn_rate * math.log1p(practiced[r])
                p_true = guess + (1 - guess) * _sigmoid(1.2 * (effective - difficulty))
            else:
                p_true = guess + (1 - guess) * _sigmoid(1.2 * (g - difficulty))
            correct = rng.random() < p_true
            if outcomes is not None:
                correct = outcomes.get((learner, step), correct)

            pred_ability = ability.predict(word)
            if is_probe:
                recorded = r
                if scenario.label_noise and rng.random() < scenario.label_noise:
                    recorded = rng.choice([i for i in range(len(rule_ids)) if i != r])
                rid = rule_ids[recorded]
                pred_skill = R.blended_prediction(estimated, rid, overall)
                order += 1
                events.append({"pseudonym": user, "order": order, "tribe": "amis", "target_rule_id": rid, "correct": correct,
                               "probe": True, "pred_skill": pred_skill, "pred_ability": pred_ability, "pred_oracle": p_true})
                R.apply_observation(estimated, rid, correct)
                practiced[r] += 1
            ability.update(word, correct)
            R.add_overall(overall, correct)
            for i in range(len(skill)):                      # 沒練的規則緩慢遺忘
                if not (is_probe and i == r):
                    skill[i] -= scenario.forget
        rho_s, recall = _recovery(estimated, rule_ids, skill)
        if rho_s is not None:
            spearmans.append(rho_s)
            recalls.append(recall)
    return {"events": events, "recovery": {
        "learners_scored": len(spearmans),
        "mean_spearman": sum(spearmans) / len(spearmans) if spearmans else None,
        "mean_weakest_recall": sum(recalls) / len(recalls) if recalls else None,
        "chance_weakest_recall": 2 / scenario.rules}}


def _recovery(estimated: dict, rule_ids: list[str], true_skill: list[float], top: int = 2):
    """估計值與真實技能的 Spearman 相關，以及「估計最弱的 top 條」命中「真實最弱的 top 條」的比例。
    只看觀察次數夠、有估計的規則；不足 4 條就不算。"""
    pairs = [(estimated[rid]["p"], true_skill[i]) for i, rid in enumerate(rule_ids)
             if rid in estimated and R.has_enough_data(estimated[rid])]
    if len(pairs) < 4:
        return None, None
    est_rank, true_rank = _ranks([p for p, _ in pairs]), _ranks([t for _, t in pairs])
    n = len(pairs)
    mean = (n + 1) / 2
    cov = sum((a - mean) * (b - mean) for a, b in zip(est_rank, true_rank))
    var = sum((a - mean) ** 2 for a in est_rank) * sum((b - mean) ** 2 for b in true_rank)
    spearman = cov / math.sqrt(var) if var > 0 else 0.0
    weakest_est = set(sorted(range(n), key=lambda i: pairs[i][0])[:top])
    weakest_true = set(sorted(range(n), key=lambda i: pairs[i][1])[:top])
    return spearman, len(weakest_est & weakest_true) / top


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def evaluate_scenario(scenario: Scenario, *, resamples: int = 200) -> dict:
    sim = run(scenario)
    report = EV.evaluate(sim["events"], resamples=resamples, seed=scenario.seed)
    from config import prediction_metrics as PM
    y = [1 if e["correct"] else 0 for e in sim["events"]]
    report["oracle"] = PM.summarize(y, [e["pred_oracle"] for e in sim["events"]]) if y else {}
    report["recovery"] = sim["recovery"]
    report["scenario"] = scenario.name
    report["description"] = scenario.description
    return report


def format_scenario(report: dict) -> str:
    def row(name, m):
        return f"    {name:<10} log loss {EV._fmt(m['log_loss'])}  Brier {EV._fmt(m['brier'])}  AUC {EV._fmt(m['auc'])}"
    lines = [f"[{report['scenario']}] {report['description']}", f"  事件 {report['events']} 筆、學習者 {report['users']} 位"]
    for name in EV.PREDICTORS:
        if name in report["overall"]:
            lines.append(row(name, report["overall"][name]))
    if report.get("oracle"):
        lines.append(row("oracle", report["oracle"]) + "（知道真實機率的上限）")
    comp = report["comparisons"].get("skill_vs_ability")
    lines.append("  規則熟練度 vs 單一能力值：" + (EV.verdict(comp) if comp else "資料不足"))
    rec = report["recovery"]
    if rec["mean_spearman"] is not None:
        lines.append(f"  弱點還原：估計與真實技能的 Spearman 平均 {rec['mean_spearman']:.2f}；"
                     f"估計最弱 2 條命中真實最弱 2 條的比例 {rec['mean_weakest_recall']:.2f}（隨機猜是 {rec['chance_weakest_recall']:.2f}）"
                     f"，共 {rec['learners_scored']} 位學習者有足夠資料")
    return "\n".join(lines)


def with_overrides(scenario: Scenario, **kwargs) -> Scenario:
    return replace(scenario, **kwargs)
