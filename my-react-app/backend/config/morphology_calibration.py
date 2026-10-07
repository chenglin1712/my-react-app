"""詞形分析器的「放行規則」校準——純函式，不碰 DB、不碰 HTTP。

config/morphology.py 能從衍生詞對照歸納出幾十到上百條詞綴規則，但「歸納得出來」
不代表「可以拿來當佐證」：佐證檢核最怕的是把不存在的詞判成有依據，或把詞判到
錯誤的詞根（介面會顯示那個錯詞根的釋義，比標成查無佐證更誤導）。這裡負責決定
**哪些規則可以放行**，並且把放行後的真實錯放行率量出來。

方法上刻意避開幾個容易高估成績的坑（來自獨立審查）：
1. **規則是在「沒看過的資料」上被評估的**：用 K 折交叉驗證，每一折用其他折歸納規則，
   在這一折上統計每條規則的命中／錯詞根／錯放行，再把各折的次數加總。直接在訓練
   資料上量規則精確度會偏樂觀（挑出「剛好沒出錯」的規則是 winner's curse）。
2. **測試詞要從詞庫拿掉**：衍生詞本身就是詞條，正式環境裡它們在第一關就直接命中
   headword，根本不會進到分析器。評估時把留出的詞從詞庫（與語料詞形）移除，才能
   模擬「真的沒見過的詞形」。
3. **錯詞根算錯誤放行**：剝出來的殘餘雖然是詞庫裡的詞、卻不是正確詞根，介面會顯示
   錯誤的釋義；所以它跟「假詞被放行」同等嚴重，各自獨立設上限，不合併成一個比率。
4. **最後在規則與門檻都凍結後，用另一份沒碰過的測試詞只跑一次**。測試詞不得用來回頭
   調門檻；不合格就整族停用，而不是放寬門檻。
   **所有「是否夠安全」的判斷都比 95% 信賴【上界】，不比點估計**：300 筆零錯誤的上界仍
   約 1.3%，只看點估計等於把「沒抽到」當成「不存在」。交叉驗證階段的聯集檢查也用上界，
   以抵銷「從多組門檻裡挑第一個達標者」帶來的樂觀偏差（winner's curse）。
5. **規則層級的門檻管不住詞層級的錯放行**（一個假詞只要任一放行規則命中就算放行），
   所以門檻是否夠嚴，是看「所有放行規則聯集」的詞層級錯放行率，不是單條規則。

資料量不足的族語（衍生詞對照太少）會因為證據不夠而全部規則被拒絕，結果是停用，
不是降低門檻。
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Collection, Iterable, Mapping, Sequence

from config import morphology as M

SCHEMA_VERSION = 1
# 最終測試的最低證據量：接受的真詞、各族群的負例都要有足夠筆數，否則「零次錯誤」
# 沒有意義（300 筆零錯誤的 95% 上界仍約 1%）。
MIN_FINAL_ACCEPTED = 30
MIN_FINAL_NEGATIVES = 300
GENERATOR_VERSION = "morphology_calibration/2"

_LETTERS = "abcdefghijklmnopqrstuvwxyz"

# 負例族群。stem（保留真實詞綴、只編造詞幹）最像 LLM 的幻覺；sub1／indel1 是離真詞
# 一個字母的假詞；sub2 差兩個字母；rand 是隨機字串（最容易，幾乎不具鑑別力）。
FAMILIES = ("stem", "sub1", "indel1", "sub2", "rand")
# 這幾族是「困難負例」：規則層級的過濾與聯集上限都以它們為準。
HARD_FAMILIES = ("stem", "sub1", "indel1")


# ---------------------------------------------------------------------------
# 統計
# ---------------------------------------------------------------------------

def wilson_interval(successes: int, trials: int, z: float = 1.96) -> tuple[float, float]:
    """二項比例的 Wilson 信賴區間（預設 95%）。trials 為 0 時回傳 (0, 1)：沒有證據
    就不能宣稱任何事。小樣本與零次錯誤時，Wilson 比 normal approximation 可靠。"""
    if trials <= 0:
        return 0.0, 1.0
    p = successes / trials
    denom = 1 + z * z / trials
    centre = (p + z * z / (2 * trials)) / denom
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def wilson_upper(successes: int, trials: int, z: float = 1.96) -> float:
    return wilson_interval(successes, trials, z)[1]


def wilson_lower(successes: int, trials: int, z: float = 1.96) -> float:
    return wilson_interval(successes, trials, z)[0]


# ---------------------------------------------------------------------------
# 切分
# ---------------------------------------------------------------------------

def _bucket(label: str, tribe: str, derived: str, mod: int) -> int:
    digest = hashlib.sha1(f"{label}|{tribe}|{derived}".encode("utf-8")).hexdigest()
    return int(digest, 16) % mod


def is_final_test(tribe: str, derived: str) -> bool:
    """最終測試集（約 20%）：規則與門檻凍結之前完全不碰。用獨立的雜湊標籤，跟
    config.morphology.is_test_pair（評估指令用的切分）彼此無關，不會因為先前看過
    那份切分的數字而汙染這份。"""
    return _bucket("final", tribe, derived, 5) == 0


def fold_of(tribe: str, derived: str, folds: int) -> int:
    return _bucket("fold", tribe, derived, folds)


# ---------------------------------------------------------------------------
# 負例
# ---------------------------------------------------------------------------

def _substitute(word: str, index: int, rng: random.Random) -> str:
    return word[:index] + rng.choice([c for c in _LETTERS if c != word[index]]) + word[index + 1:]


def _inner_indices(word: str) -> list[int]:
    return list(range(1, len(word) - 1)) if len(word) > 3 else list(range(len(word)))


def generate_negatives(pairs: Iterable[M.RootPair], lexicon_set: Collection[str],
                       attested: Collection[str], rng: random.Random) -> dict[str, list[str]]:
    """造「不在詞庫也不在語料詞形」的假詞，分族群回傳（已去重）。

    - stem：取一個真實配對，保留它的詞綴規則，把詞根改掉一個字母再套回去——詞綴是對的、
      詞幹是編的，最像 LLM 幻覺。
    - sub1／indel1：把真實衍生詞改一個字母／刪或插一個字母。
    - sub2：改兩個【不同位置】的字母（太短的詞跳過）。
    - rand：同長度的隨機字串。
    """
    out: dict[str, list[str]] = {f: [] for f in FAMILIES}
    seen: dict[str, set[str]] = {f: set() for f in FAMILIES}

    def add(family: str, fake: str, real: str) -> None:
        if (fake and fake != real and fake not in lexicon_set and fake not in attested
                and fake not in seen[family] and M._is_valid_derived(fake)):
            seen[family].add(fake)
            out[family].append(fake)

    for p in pairs:
        w = p.derived
        add("sub1", _substitute(w, rng.choice(_inner_indices(w)), rng), w)

        if len(w) >= 4:
            inner = _inner_indices(w)
            i = rng.choice(inner)
            if rng.random() < 0.5 and len(w) > 3:
                add("indel1", w[:i] + w[i + 1:], w)
            else:
                add("indel1", w[:i] + rng.choice(_LETTERS) + w[i:], w)
            i, j = rng.sample(range(1, len(w) - 1), 2) if len(w) > 4 else rng.sample(range(len(w)), 2)
            add("sub2", _substitute(_substitute(w, i, rng), j, rng), w)

        add("rand", "".join(rng.choice(_LETTERS) for _ in range(len(w))), w)

        for root in p.roots:
            if root in lexicon_set and len(root) >= 3:
                derived_rules = M.derive_rules(w, root)
                if derived_rules:
                    fake_root = _substitute(root, rng.randrange(len(root)), rng)
                    fake = M.simplest_rule(derived_rules).generate(fake_root)
                    if fake_root not in lexicon_set:
                        add("stem", fake, w)
                break
    return out


# ---------------------------------------------------------------------------
# 規則證據（交叉驗證）
# ---------------------------------------------------------------------------

@dataclass
class RuleEvidence:
    hits: int = 0          # 剝完得到正確詞根
    wrong: int = 0         # 剝完得到詞庫裡的詞，但不是正確詞根
    fa_hard: int = 0       # 對困難負例剝完得到詞庫裡的詞（錯放行）
    # 這條規則「實際被測過」的困難負例數。一條規則只在部分折裡被歸納出來（其他折的訓練資料
    # 不足以達到最低次數），它就只看過那幾折的負例；分母若用全部折的負例總數會低估它的
    # 錯放行率。分母為 0 代表沒有證據，一律不放行。
    fa_hard_trials: int = 0


@dataclass(frozen=True)
class AdmissionConfig:
    folds: int = 5
    min_root_len: int = 3
    min_applicable: int = 10          # hits + wrong 至少要這麼多，證據才算夠
    max_wrong_upper: float = 0.10     # 錯詞根率的 Wilson 上界上限（規則層級）
    max_fa_rate: float = 0.0015       # 困難負例錯放行率上限（規則層級，分母是全部困難負例）
    # 聯集（詞層級）目標，【都是 95% 信賴上界的上限】，不是點估計：各負例族群的錯放行率，
    # 以及被接受的真詞裡剝出錯誤詞根的比例。嚴格程度由寬到嚴逐階收緊直到達標。
    # 錯詞根率的上限比錯放行寬：辭典的衍生詞標註本身就有歧義（同一個詞有多個合理詞根，
    # 但只標了一個），實測就算規則再嚴，也有約 4~6% 的接受案例剝出的是另一個合理詞根。
    union_targets: Mapping[str, float] = field(default_factory=lambda: {
        "stem": 0.01, "sub1": 0.01, "indel1": 0.01, "sub2": 0.01, "rand": 0.01,
    })
    max_wrong_root_rate: float = 0.10
    min_support: int = 10             # 規則在完整訓練集的出現次數下限
    seed: int = 20261006


def _evidence_for_fold(fold_pairs: Sequence[M.RootPair], rules: Mapping[M.MorphRule, int],
                       lexicon_cv: Collection[str], negatives_hard: Sequence[str],
                       min_root_len: int) -> dict[M.MorphRule, RuleEvidence]:
    """這一折的證據：只含「這一折的訓練資料歸納得出來」的規則。"""
    out: dict[M.MorphRule, RuleEvidence] = {}
    for rule in rules:
        ev = out.setdefault(rule, RuleEvidence())
        ev.fa_hard_trials += len(negatives_hard)
        for p in fold_pairs:
            residue = rule.apply(p.derived)
            if residue is None or len(residue) < min_root_len or residue not in lexicon_cv:
                continue
            if residue in p.roots:
                ev.hits += 1
            else:
                ev.wrong += 1
        for fake in negatives_hard:
            residue = rule.apply(fake)
            if residue is not None and len(residue) >= min_root_len and residue in lexicon_cv:
                ev.fa_hard += 1
    return out


def _sum_evidence(parts: Iterable[Mapping[M.MorphRule, RuleEvidence]]) -> dict[M.MorphRule, RuleEvidence]:
    total: dict[M.MorphRule, RuleEvidence] = {}
    for part in parts:
        for rule, ev in part.items():
            t = total.setdefault(rule, RuleEvidence())
            t.hits += ev.hits
            t.wrong += ev.wrong
            t.fa_hard += ev.fa_hard
            t.fa_hard_trials += ev.fa_hard_trials
    return total


def collect_cv_evidence(pool: Sequence[M.RootPair], lexicon_set: Collection[str], attested: Collection[str],
                        cfg: AdmissionConfig) -> tuple[dict[M.MorphRule, RuleEvidence], list[dict],
                                                       list[dict[M.MorphRule, RuleEvidence]]]:
    """回傳 (各規則加總的證據, 各折資料以便做聯集檢查, 各折各自的證據)。

    每一折：規則只用「其他折」歸納；詞庫把「這一折的衍生詞」拿掉（模擬沒見過的詞形）；
    負例也只由這一折的詞造出。各折的資料裡保存這一折的規則集合（rules），聯集檢查時
    只能用「這一折本來就有」的規則，否則就不是真正的折外預測。"""
    folds = [[p for p in pool if fold_of(p.tribe, p.derived, cfg.folds) == k] for k in range(cfg.folds)]
    fold_data: list[dict] = []
    per_fold: list[dict[M.MorphRule, RuleEvidence]] = []

    for k, held in enumerate(folds):
        train = [p for f_idx, f in enumerate(folds) if f_idx != k for p in f]
        held_forms = {p.derived for p in held}
        lexicon_cv = set(lexicon_set) - held_forms
        attested_cv = set(attested) - held_forms
        rules = M.induce_rules(train, lexicon_cv)
        negatives = generate_negatives(held, lexicon_cv, attested_cv, random.Random(f"{cfg.seed}|{k}"))
        hard = [w for fam in HARD_FAMILIES for w in negatives[fam]]
        per_fold.append(_evidence_for_fold(held, rules, lexicon_cv, hard, cfg.min_root_len))
        fold_data.append({"held": held, "lexicon": lexicon_cv, "negatives": negatives, "rules": set(rules)})
    return _sum_evidence(per_fold), fold_data, per_fold


def admit_rules(evidence: Mapping[M.MorphRule, RuleEvidence],
                support: Mapping[M.MorphRule, int], cfg: AdmissionConfig,
                max_wrong_upper: float | None = None, max_fa_rate: float | None = None) -> set[M.MorphRule]:
    """依規則層級的證據挑出放行的規則。三個獨立條件，缺一不可：證據量夠、錯詞根率的
    Wilson 上界夠低、對困難負例的錯放行率夠低。不把它們混成單一比率——比率會隨
    負例抽樣數量改變，卻代表不了真實流量的比例。"""
    mw = cfg.max_wrong_upper if max_wrong_upper is None else max_wrong_upper
    mf = cfg.max_fa_rate if max_fa_rate is None else max_fa_rate
    admitted: set[M.MorphRule] = set()
    for rule, ev in evidence.items():
        n_app = ev.hits + ev.wrong
        if support.get(rule, 0) < cfg.min_support or n_app < cfg.min_applicable:
            continue
        if wilson_upper(ev.wrong, n_app) > mw:
            continue
        if ev.fa_hard_trials <= 0 or ev.fa_hard / ev.fa_hard_trials > mf:
            continue
        admitted.add(rule)
    return admitted


@dataclass
class UnionResult:
    real_n: int = 0
    accepted: int = 0
    correct: int = 0
    wrong_root: int = 0
    fa: dict[str, tuple[int, int]] = field(default_factory=dict)   # family -> (放行數, 總數)

    @property
    def wrong_root_rate(self) -> float:
        return self.wrong_root / self.accepted if self.accepted else 0.0


def _analyzer(rules: Iterable[M.MorphRule], lexicon_set: Collection[str], reliability: Mapping[M.MorphRule, float],
              min_root_len: int) -> M.MorphAnalyzer:
    rule_list = list(rules)
    return M.MorphAnalyzer(
        {r: 1 for r in rule_list}, lexicon_set,
        precision={r: reliability.get(r, 0.0) for r in rule_list},
        rank_by="precision", max_edit=0, min_root_len=min_root_len,
    )


def union_check(admitted: Collection[M.MorphRule], reliability: Mapping[M.MorphRule, float],
                held: Sequence[M.RootPair], lexicon_set: Collection[str],
                negatives: Mapping[str, Sequence[str]], min_root_len: int) -> UnionResult:
    """放行規則聯集的【詞層級】結果：一個 token 只要任一放行規則剝出詞庫裡的詞，就算被放行。
    真詞看第一名是不是正確詞根；負例只要有任何候選就算錯放行。"""
    res = UnionResult()
    if not admitted:
        res.fa = {fam: (0, len(negatives.get(fam, ()))) for fam in FAMILIES}
        res.real_n = sum(1 for p in held if set(p.roots) & set(lexicon_set))
        return res
    an = _analyzer(admitted, lexicon_set, reliability, min_root_len)
    for p in held:
        if not (set(p.roots) & set(lexicon_set)):
            continue
        res.real_n += 1
        out = an.analyze(p.derived, 1)
        if not out:
            continue
        res.accepted += 1
        if out[0].root in p.roots:
            res.correct += 1
        else:
            res.wrong_root += 1
    for fam in FAMILIES:
        fakes = negatives.get(fam, ())
        res.fa[fam] = (sum(1 for w in fakes if an.analyze(w, 1)), len(fakes))
    return res


def meets_targets(res: UnionResult, cfg: AdmissionConfig) -> bool:
    """聯集結果是否達標。比的是 95% 信賴【上界】，不是點估計。"""
    if res.accepted and wilson_upper(res.wrong_root, res.accepted) > cfg.max_wrong_root_rate:
        return False
    for fam, limit in cfg.union_targets.items():
        k, n = res.fa.get(fam, (0, 0))
        if n and wilson_upper(k, n) > limit:
            return False
    return True


# 從寬到嚴的規則層級門檻；聯集若達不到目標，就一路收緊，全部都不行就停用該族。
TIGHTENING_LADDER = (
    (0.10, 0.0015), (0.08, 0.0010), (0.06, 0.0007), (0.05, 0.0005), (0.04, 0.0003), (0.03, 0.0002), (0.02, 0.0001),
)


# 兩種預設鬆緊。strict 是預設：寧可少放行也不要錯放行；balanced 容許稍高的錯詞根率換更多
# 覆蓋率（取捨曲線見 build_morphology_rules 指令的說明）。兩者的最終測試閘門都用各自的目標。
PROFILES: dict[str, tuple[dict, tuple]] = {
    "strict": ({}, TIGHTENING_LADDER),
    "balanced": (
        {"max_wrong_root_rate": 0.12, "union_targets": {f: 0.015 for f in FAMILIES}},
        ((0.25, 0.002), (0.20, 0.0015), (0.15, 0.0015)) + TIGHTENING_LADDER,
    ),
}


def reliability_from(evidence: Mapping[M.MorphRule, RuleEvidence]) -> dict[M.MorphRule, float]:
    """規則可靠度＝（命中, 命中＋錯詞根）的 Wilson 下界；沒有證據的規則是 0。"""
    return {r: wilson_lower(e.hits, e.hits + e.wrong) for r, e in evidence.items()}


def pooled_union(admitted: Collection[M.MorphRule], evidence: Mapping[M.MorphRule, RuleEvidence],
                 fold_data: Sequence[dict], per_fold: Sequence[Mapping[M.MorphRule, RuleEvidence]],
                 min_root_len: int) -> UnionResult:
    """各折的聯集結果加總。每一折都是真正的折外預測：只使用「這一折的訓練資料歸納得出來」
    的放行規則，而規則的可靠度（用來排序候選）也只用【不含這一折】的證據計算。"""
    total = UnionResult()
    for k, fd in enumerate(fold_data):
        others = _sum_evidence(e for j, e in enumerate(per_fold) if j != k)
        fold_rules = set(admitted) & fd["rules"]
        r = union_check(fold_rules, reliability_from(others), fd["held"], fd["lexicon"], fd["negatives"], min_root_len)
        total.real_n += r.real_n
        total.accepted += r.accepted
        total.correct += r.correct
        total.wrong_root += r.wrong_root
        for fam, (k, n) in r.fa.items():
            k0, n0 = total.fa.get(fam, (0, 0))
            total.fa[fam] = (k0 + k, n0 + n)
    return total


@dataclass
class TribeCalibration:
    admitted: dict[M.MorphRule, dict]       # 規則 -> {support, reliability, hits, wrong, fa_hard}
    ladder_step: int | None                  # 用到第幾階門檻；None 代表全部不達標、整族停用
    cv_union: UnionResult
    cv_pairs: int
    reason: str = ""


def calibrate_tribe(pairs: Sequence[M.RootPair], lexicon_set: Collection[str], attested: Collection[str],
                    cfg: AdmissionConfig | None = None, ladder=None) -> TribeCalibration:
    """對一個族語做完整的規則放行校準，只用「非最終測試」的配對。回傳放行的規則與
    交叉驗證下的聯集結果。最終測試由呼叫端另外用 final_report() 對凍結後的結果只跑一次。"""
    cfg = cfg or AdmissionConfig()
    pool = [p for p in pairs if not is_final_test(p.tribe, p.derived)]
    evidence, fold_data, per_fold = collect_cv_evidence(pool, lexicon_set, attested, cfg)
    if not pool:
        return TribeCalibration({}, None, UnionResult(), len(pool), "沒有可用的配對")
    if not evidence:
        return TribeCalibration({}, None, UnionResult(), len(pool), "資料不足：訓練資料歸納不出任何規則")

    support = M.induce_rules(pool, lexicon_set)
    reliability = reliability_from(evidence)

    for step, (mw, mf) in enumerate(ladder or TIGHTENING_LADDER):
        admitted = admit_rules(evidence, support, cfg, mw, mf)
        admitted &= set(support)
        union = pooled_union(admitted, evidence, fold_data, per_fold, cfg.min_root_len)
        if admitted and meets_targets(union, cfg):
            return TribeCalibration(
                {r: {"support": support[r], "reliability": round(reliability[r], 6), "hits": evidence[r].hits,
                     "wrong": evidence[r].wrong, "fa_hard": evidence[r].fa_hard} for r in sorted(admitted)},
                step, union, len(pool),
            )
    return TribeCalibration({}, None, union if 'union' in locals() else UnionResult(), len(pool),
                            "沒有任何門檻能同時達到聯集目標，整族停用")


def final_gate_failures(res: UnionResult, cfg: AdmissionConfig) -> list[str]:
    """最終測試的閘門：用跟交叉驗證相同的目標檢查凍結後的結果，回傳未通過的項目
    （空 list 代表通過）。比的是 95% 信賴【上界】，不是點估計——點估計低只代表這次沒抽到。
    不通過就整族停用，不得回頭調門檻再測一次——那樣最終測試就變成第二個校準集。證據太少
    （接受筆數或負例太少）同樣視為不通過：沒有證據不能宣稱安全。"""
    failed: list[str] = []
    if res.accepted < MIN_FINAL_ACCEPTED:
        failed.append(f"最終測試接受的真詞只有 {res.accepted} 筆（< {MIN_FINAL_ACCEPTED}），證據不足")
    else:
        upper = wilson_upper(res.wrong_root, res.accepted)
        if upper > cfg.max_wrong_root_rate:
            failed.append(f"錯詞根率 {res.wrong_root}/{res.accepted} 的 95% 上界 {upper:.1%} 超過 {cfg.max_wrong_root_rate:.1%}")
    for fam, limit in cfg.union_targets.items():
        k, n = res.fa.get(fam, (0, 0))
        if n < MIN_FINAL_NEGATIVES:
            failed.append(f"{fam} 負例只有 {n} 筆（< {MIN_FINAL_NEGATIVES}），證據不足")
        elif wilson_upper(k, n) > limit:
            failed.append(f"{fam} 錯放行 {k}/{n} 的 95% 上界 {wilson_upper(k, n):.2%} 超過 {limit:.2%}")
    return failed


def final_report(admitted: Mapping[M.MorphRule, Mapping], pairs: Sequence[M.RootPair],
                 lexicon_set: Collection[str], attested: Collection[str], cfg: AdmissionConfig,
                 existing_accepts=None) -> dict:
    """在規則與門檻凍結後，對最終測試詞【只跑一次】。測試詞從詞庫與語料詞形拿掉，模擬
    沒見過的詞形；回傳各項計數與 Wilson 上界。existing_accepts（可選）是現有單層剝詞綴
    的判定函式 (token, 詞庫)->bool，用來另外報「現有做法本來就不會放行」的增量。"""
    test = [p for p in pairs if is_final_test(p.tribe, p.derived)]
    held_forms = {p.derived for p in test}
    lex = set(lexicon_set) - held_forms
    att = set(attested) - held_forms
    negatives = generate_negatives(test, lex, att, random.Random(f"{cfg.seed}|final"))
    reliability = {r: s["reliability"] for r, s in admitted.items()}
    res = union_check(admitted.keys(), reliability, test, lex, negatives, cfg.min_root_len)

    by_len: dict[str, dict[str, int]] = defaultdict(lambda: {"accepted": 0, "wrong": 0})
    new_accept = new_correct = 0
    if admitted:
        an = _analyzer(admitted.keys(), lex, reliability, cfg.min_root_len)
        for p in test:
            if not (set(p.roots) & lex):
                continue
            out = an.analyze(p.derived, 1)
            if not out:
                continue
            bucket = "2" if len(out[0].root) == 2 else "3" if len(out[0].root) == 3 else "4+"
            by_len[bucket]["accepted"] += 1
            by_len[bucket]["wrong"] += out[0].root not in p.roots
            if existing_accepts is not None and not existing_accepts(p.derived, lex):
                new_accept += 1
                new_correct += out[0].root in p.roots
    failed = final_gate_failures(res, cfg)
    return {
        "passed": not failed, "failed_checks": failed,
        "test_pairs": len(test), "real_evaluated": res.real_n, "accepted": res.accepted,
        "correct": res.correct, "wrong_root": res.wrong_root,
        "wrong_root_upper": round(wilson_upper(res.wrong_root, res.accepted), 4),
        "fa": {fam: {"accepted": k, "n": n, "rate": round(k / n, 4) if n else 0.0,
                      "upper": round(wilson_upper(k, n), 4)} for fam, (k, n) in res.fa.items()},
        "by_root_len": {k: dict(v) for k, v in sorted(by_len.items())},
        "incremental_over_existing": {"accepted": new_accept, "correct": new_correct}
        if existing_accepts is not None else None,
    }


# ---------------------------------------------------------------------------
# 指紋與放行檔（artifact）
# ---------------------------------------------------------------------------

def _string_set_fingerprint(values: Iterable[str]) -> str:
    """字串集合的內容雜湊：去重、排序、逐筆以換行分隔後取 SHA-256。不是字串（例如 None）直接丟
    TypeError，不悄悄略過或轉成 'None'——那樣會產生一個看似正常、其實少算了資料的指紋。
    已知限制：元素以換行分隔且不跳脫，所以 {"a","b"} 與 {"a
b"} 會得到相同指紋；既有放行檔的詞庫指紋就是這個
    格式（不能改）。詞形（token）本來就不含換行，這只在資料庫混進換行時才有影響。"""
    h = hashlib.sha256()
    for w in sorted(set(values)):
        if not isinstance(w, str):
            raise TypeError(f"指紋的輸入必須是字串，收到 {type(w).__name__}")
        h.update(w.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def headword_fingerprint(lexicon_set: Iterable[str]) -> str:
    """正規化詞庫的內容雜湊（不是筆數）：刪一個詞、加一個詞筆數不變，但候選空間與錯放行
    風險已經改變。"""
    return _string_set_fingerprint(lexicon_set)


def attested_fingerprint(attested: Iterable[str]) -> str:
    """語料詞形（translation_attested_form.surface_form_norm）的內容雜湊，作法與詞庫指紋相同。
    校準的負例會排除這些詞形，所以它是校準的輸入之一；但目前（schema 1）放行檔沒有記錄它，
    只有報表用來「看目前的值」，不寫進放行檔、不參與載入判斷。"""
    return _string_set_fingerprint(attested)


def pairs_fingerprint(pairs: Iterable[M.RootPair]) -> str:
    h = hashlib.sha256()
    for p in sorted(pairs, key=lambda x: (x.tribe, x.derived)):
        h.update(f"{p.tribe}\t{p.derived}\t{','.join(p.roots)}\n".encode("utf-8"))
    return h.hexdigest()


def rule_to_dict(rule: M.MorphRule) -> dict:
    return {"kind": rule.kind, "a": rule.a, "b": rule.b, "k": rule.k}


def rule_from_dict(d: Mapping) -> M.MorphRule:
    """從放行檔還原規則；欄位型別不對會丟 ValueError，由載入端整族停用。"""
    if not isinstance(d, Mapping):
        raise ValueError("規則必須是物件")
    kind, a, b, k = d.get("kind"), d.get("a", ""), d.get("b", ""), d.get("k", 0)
    if not isinstance(kind, str) or not isinstance(a, str) or not isinstance(b, str) \
            or isinstance(k, bool) or not isinstance(k, int):
        raise ValueError(f"規則欄位型別不正確：{d!r}")
    return M.MorphRule(kind, a=a, b=b, k=k)


def dumps_artifact(artifact: Mapping) -> str:
    """決定性序列化：同樣內容永遠得到同樣位元組，方便在版本控制裡看差異。"""
    return json.dumps(artifact, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def build_tribe_artifact(tribe_slug: str, tribe_id: str, pairs: Sequence[M.RootPair],
                         lexicon_set: Collection[str], attested: Collection[str], cfg: AdmissionConfig,
                         existing_accepts=None, ladder=None) -> dict:
    """一個族語的放行檔內容：校準 → 凍結 → 最終測試只跑一次 → 通過才啟用。

    啟用條件：放行規則非空，且最終測試通過閘門。否則 enabled=False 且 rules=[]：
    保留規則會讓人誤以為「只是停用」而日後直接打開。"""
    cal = calibrate_tribe(pairs, lexicon_set, attested, cfg, ladder)
    report = final_report(cal.admitted, pairs, lexicon_set, attested, cfg, existing_accepts) if cal.admitted else None
    enabled = bool(cal.admitted) and bool(report and report["passed"])
    reason = cal.reason
    if cal.admitted and not enabled:
        reason = "最終測試未通過：" + "；".join(report["failed_checks"])
    entry = {
        "tribe_id": tribe_id,
        "enabled": enabled,
        "reason": "" if enabled else reason,
        "fingerprint": {
            "headwords_sha256": headword_fingerprint(lexicon_set),
            "pairs_sha256": pairs_fingerprint(pairs),
            "n_headwords": len(set(lexicon_set)),
            "n_pairs": len(pairs),
        },
        "config": {
            "min_root_len": cfg.min_root_len, "folds": cfg.folds, "min_applicable": cfg.min_applicable,
            "min_support": cfg.min_support, "max_wrong_upper": cfg.max_wrong_upper, "max_fa_rate": cfg.max_fa_rate,
            "max_wrong_root_rate": cfg.max_wrong_root_rate, "union_targets": dict(sorted(cfg.union_targets.items())),
            "seed": cfg.seed, "ladder_step": cal.ladder_step,
        },
        "rules": [dict(rule_to_dict(r), **stats) for r, stats in sorted(cal.admitted.items())] if enabled else [],
        "cv_union": {
            "real": cal.cv_union.real_n, "accepted": cal.cv_union.accepted, "wrong_root": cal.cv_union.wrong_root,
            "fa": {f: list(v) for f, v in sorted(cal.cv_union.fa.items())},
        },
        "final_test": report,
    }
    return entry


def build_artifact(tribes: Mapping[str, dict]) -> dict:
    return {"schema": SCHEMA_VERSION, "generator": GENERATOR_VERSION, "tribes": dict(sorted(tribes.items()))}
