"""M8 形態分析基準：在【凍結的最終測試切分 final-v1】上，重新評估放行檔裡的規則，並逐筆列出失敗原因。純函式，不碰 DB、檔案、時間。

【切分與生命週期】final-v1 就是校準流程的最終測試集（config.morphology_calibration.is_final_test：標籤 "final"，
SHA-1 雜湊後模 5 為 0，約 20%）。這份切分已經被「用掉」一次：放行檔記錄的 final_test 就是當年那一次的正式結果，
決定了該族能不能啟用。所以這個基準是【重現／回歸檢查】，不是新的獨立測試：
- 用放行檔裡凍結的規則與可靠度，加上「現在」的辭典，重跑同一套計算（同樣的負例種子、同樣先把測試詞從詞庫與語料詞形拿掉）；
- 辭典沒變時，結果必須與放行檔記錄逐項相同（recorded_match）；不同代表辭典或程式變了，要查；
- 失敗分析是給人看懂「錯在哪」，**不得**拿來回頭調規則或門檻再對 final-v1 評估——那樣 final-v1 就變成第二個校準集。
  真的要改規則，必須定義新的切分版本（例如標籤 "final2"、版本 final-v2），不能沿用 final-v1。
- 凍結的是「分派演算法與版本」，不是成員清單：成員由雜湊規則對【目前辭典】重新算出，辭典增減詞條就會變。
  放行檔沒有保存當年的 split_sha256，所以無法直接證明成員沒變；split_sha256 的用途是讓之後的報表能互相比對、
  看出成員何時變動。要確認「與當年相同」，看 recorded_counts_match（重算的計數是否與放行檔記錄一致）。
- failure_analysis 會列出最終測試詞的衍生詞、詞根標註與預測，等於一份標註資料的匯出：只列到 max_items 筆
  （指令端有硬上限），給維運人員除錯用；轉出去之前請確認辭典資料的授權範圍。

【決定性】同樣的輸入（規則、辭典、語料詞形）輸出完全相同：負例用固定種子，所有清單先排序再截斷；
清單長度上限 max_items 只截斷「列出來的項目」，計數永遠是完整的。
"""
from __future__ import annotations

import hashlib
import random
from collections import defaultdict
from typing import Collection, Mapping, Sequence

from config import morphology as M
from config import morphology_calibration as C
from config import morphology_reporting as R

BENCHMARK_VERSION = 1
SPLIT_VERSION = "final-v1"
SPLIT_LABEL = "final"          # 與 C.is_final_test 使用的雜湊標籤一致；改它就是換切分，必須同時換 SPLIT_VERSION
SPLIT_MODULUS = 5

SPLIT_DESCRIPTOR = {
    "version": SPLIT_VERSION,
    "label": SPLIT_LABEL,
    "rule": f"sha1('{SPLIT_LABEL}|族語全名|衍生詞') mod {SPLIT_MODULUS} == 0",
    "approx_fraction": 1 / SPLIT_MODULUS,
    "lifecycle": {
        "state": "consumed",
        "definition": "凍結的是分派演算法與版本；成員由雜湊規則對目前辭典重新算出，辭典增減詞條會改變成員",
        "consumed_by": "放行檔 final_test（校準時的唯一一次正式最終測試）",
        "role": "重現與回歸檢查；不是新的獨立測試",
        "policy": "不得依本基準的失敗分析調整規則或門檻後再對 final-v1 評估；要改規則必須定義新的切分版本",
    },
}

_MISSED_CATEGORIES = ("no_derivation", "rule_not_admitted", "blocked_by_analyzer")


def split_pairs(pairs: Sequence[M.RootPair]) -> list[M.RootPair]:
    return [p for p in pairs if C.is_final_test(p.tribe, p.derived)]


def split_fingerprint(test_pairs: Sequence[M.RootPair]) -> str:
    """切分成員（族語＋衍生詞，與詞根無關）的內容雜湊：成員一變就變，詞根標註改動不影響。"""
    h = hashlib.sha256()
    for key in sorted({(p.tribe, p.derived) for p in test_pairs}):
        h.update(f"{key[0]}\t{key[1]}\n".encode("utf-8"))
    return h.hexdigest()


def _root_len_bucket(root: str) -> str:
    return "2" if len(root) == 2 else "3" if len(root) == 3 else "4+"


def _classify_miss(p: M.RootPair, lex: Collection[str], admitted: Collection[M.MorphRule]) -> str:
    """真詞沒被放行時的原因：
    no_derivation：沒有任何單層規則（前綴／後綴／中綴／圍綴／重疊）能從詞庫裡的詞根推出這個衍生詞，超出規則語言；
    rule_not_admitted：有規則形狀能推出，但沒有一條在放行清單裡（規則證據不足被擋下）；
    blocked_by_analyzer：放行清單裡有規則能推出，分析器仍沒給答案（例如詞根太短被擋）。"""
    shapes: set[M.MorphRule] = set()
    for root in p.roots:
        if root in lex:
            shapes.update(M.derive_rules(p.derived, root))
    if not shapes:
        return "no_derivation"
    return "blocked_by_analyzer" if shapes & set(admitted) else "rule_not_admitted"


def evaluate_split(pairs: Sequence[M.RootPair], lexicon_set: Collection[str], attested: Collection[str],
                   reliability: Mapping[M.MorphRule, float], cfg: C.AdmissionConfig, max_items: int = 20) -> dict:
    """在 final-v1 上評估一個族語；reliability 是放行檔裡凍結的規則（規則 -> 可靠度）。
    與 C.final_report 的計算逐步對應（測試用它交叉驗證計數）：測試詞先從詞庫與語料詞形拿掉、負例用同一個種子。"""
    test = split_pairs(pairs)
    held = {p.derived for p in test}
    lex = set(lexicon_set) - held
    att = set(attested) - held
    negatives = C.generate_negatives(test, lex, att, random.Random(f"{cfg.seed}|final"))
    admitted = set(reliability)

    out = {
        "test_pairs": len(test),
        "split_sha256": split_fingerprint(test),
        "real_evaluated": sum(1 for p in test if set(p.roots) & lex),
        "accepted": 0, "correct": 0, "wrong_root": 0,
    }
    wrong_items: list[dict] = []
    missed_items: dict[str, list[dict]] = {c: [] for c in _MISSED_CATEGORIES}
    missed_counts = {c: 0 for c in _MISSED_CATEGORIES}
    by_len: dict[str, dict[str, int]] = defaultdict(lambda: {"accepted": 0, "wrong": 0})
    fa_items: dict[str, list[dict]] = {fam: [] for fam in C.FAMILIES}
    fa_counts = {fam: [0, len(negatives.get(fam, ()))] for fam in C.FAMILIES}

    if admitted:
        an = C._analyzer(admitted, lex, reliability, cfg.min_root_len)
        for p in sorted(test, key=lambda x: (x.tribe, x.derived, x.roots)):
            if not (set(p.roots) & lex):
                continue
            result = an.analyze(p.derived, 1)
            if not result:
                category = _classify_miss(p, lex, admitted)
                missed_counts[category] += 1
                missed_items[category].append({"derived": p.derived, "gold_roots": sorted(p.roots)})
                continue
            top = result[0]
            out["accepted"] += 1
            bucket = by_len[_root_len_bucket(top.root)]
            bucket["accepted"] += 1
            if top.root in p.roots:
                out["correct"] += 1
            else:
                out["wrong_root"] += 1
                bucket["wrong"] += 1
                wrong_items.append({"derived": p.derived, "gold_roots": sorted(p.roots),
                                    "predicted_root": top.root, "rule": top.rule.marker})
        for fam in C.FAMILIES:
            for fake in sorted(negatives.get(fam, ())):
                result = an.analyze(fake, 1)
                if result:
                    fa_counts[fam][0] += 1
                    fa_items[fam].append({"form": fake, "predicted_root": result[0].root, "rule": result[0].rule.marker})

    out["metrics"] = {
        "release_rate": R.ratio(out["accepted"], out["real_evaluated"]),
        "precision": R.ratio(out["correct"], out["accepted"]),
        "wrong_root_rate": R.ratio(out["wrong_root"], out["accepted"]),
        "false_accept": {fam: R.ratio(fa_counts[fam][0], fa_counts[fam][1]) for fam in C.FAMILIES},
    }
    out["fa"] = {fam: {"accepted": fa_counts[fam][0], "n": fa_counts[fam][1]} for fam in C.FAMILIES}
    out["by_root_len"] = {k: dict(v) for k, v in sorted(by_len.items())}
    out["failure_analysis"] = {
        "max_items": max_items,
        "real_words": {"correct": out["correct"], "wrong_root": out["wrong_root"], "missed": missed_counts},
        "wrong_root_items": wrong_items[:max_items],
        "missed_items": {c: missed_items[c][:max_items] for c in _MISSED_CATEGORIES},
        "false_accept_items": {fam: fa_items[fam][:max_items] for fam in C.FAMILIES},
    }
    return out


def compare_with_recorded(result: Mapping, recorded: Mapping | None) -> list[str] | None:
    """與放行檔記錄的 final_test【原始計數】比：test_pairs、real_evaluated、accepted、correct、wrong_root、各負例族群的
    (accepted, n)、by_root_len。不比 passed／failed_checks／各種比率與上界（它們是由這些計數算出的，不是獨立資料）。
    回傳不一致的欄位名（空 list＝計數完全重現），沒有記錄則回傳 None。"""
    if not isinstance(recorded, Mapping):
        return None
    diffs = [k for k in ("test_pairs", "real_evaluated", "accepted", "correct", "wrong_root")
             if result.get(k) != recorded.get(k)]
    rec_fa = recorded.get("fa") if isinstance(recorded.get("fa"), Mapping) else {}
    for fam in C.FAMILIES:
        item = rec_fa.get(fam) if isinstance(rec_fa.get(fam), Mapping) else {}
        if (result["fa"][fam]["accepted"], result["fa"][fam]["n"]) != (item.get("accepted"), item.get("n")):
            diffs.append(f"fa.{fam}")
    rec_len = recorded.get("by_root_len")
    if result["by_root_len"] != (rec_len if isinstance(rec_len, Mapping) else None):
        diffs.append("by_root_len")
    return diffs
