"""形態分析能力報表的核心：凍結的數字定義、放行檔計數驗證、四層狀態、決定性組裝。純函式，不碰 DB、檔案、時間。

【凍結的定義】報表、後台頁面與之後的基準指令都用這裡，不得各自重算；改定義＝改 REPORT_VERSION。
- 放行率（release_rate）  = accepted / real_evaluated：最終測試的真詞中，分析器敢給出答案的比例。
- 精確率（precision）     = correct / accepted：給出答案的當中，詞根正確的比例。
- 錯詞根率（wrong_root_rate）= wrong_root / accepted（= 1 - 精確率，另列是因為閘門比的是它的上界）。
- 錯放行率（fa[family]）   = accepted / n：對該族負例（人工造出的非詞）誤放行的比例，五類各一。
- 信賴區間：Wilson 95%（z=1.96），與校準閘門用的 config.morphology_calibration.wilson_interval 同一個函式。
- 分母為 0：value 為 None（不是 0.0，沒有資料不等於 0%），區間為 [0, 1]。
- 數值一律四捨五入到 6 位小數；JSON 鍵固定順序由呼叫端以 sort_keys 輸出。

【四層狀態】每層獨立回答不同問題，不合併成一個「OK」：
1. input_freshness：放行檔記錄的詞庫／配對指紋與現在的辭典是否一致（fresh／stale／unknown＝放行檔無紀錄）。
2. artifact_integrity：放行檔這一族的資料自身是否可信（valid／invalid／unknown）；invalid 時不顯示任何指標。
3. runtime_rebuild_loadable：執行期載入判斷現在會不會放行（True／False；用 morphology_artifact 同一份判斷）。
   名稱刻意不叫「runtime_effective」：真正生效還要看功能旗標與快取，報表看不到。
4. gate：放行檔記錄的最終測試閘門（passed／failed／disabled＝放行檔標示停用且無最終測試）。
stale 的列照樣顯示放行檔的數字，但標 snapshot_stale=True——那是「舊資料快照上量到的成績」，不是現況。
"""
from __future__ import annotations

from typing import Any, Mapping

from config import morphology_calibration as C

REPORT_VERSION = 1
_ND = 6


def _r(x: float) -> float:
    return round(x, _ND)


def _is_count(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def ratio(successes: int, trials: int) -> dict:
    """{k, n, value, lo, hi}；分母為 0 時 value 為 None、區間 [0, 1]。"""
    lo, hi = C.wilson_interval(successes, trials)
    return {"k": successes, "n": trials, "value": _r(successes / trials) if trials else None, "lo": _r(lo), "hi": _r(hi)}


def _gate_config(config: Any):
    """用放行檔自己記錄的設定還原閘門的門檻；設定缺或壞就回傳 None（無法重算＝不能宣稱閘門通過）。"""
    if not isinstance(config, dict):
        return None
    limit, targets = config.get("max_wrong_root_rate"), config.get("union_targets")
    if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not 0 <= limit <= 1:
        return None
    if not isinstance(targets, dict) or set(targets) != set(C.FAMILIES):
        return None
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in targets.values()):
        return None
    return C.AdmissionConfig(max_wrong_root_rate=float(limit), union_targets={k: float(v) for k, v in targets.items()})


def validate_final_test(ft: Any, config: Any = None) -> list[str]:
    """放行檔 final_test 內部是否自洽；回傳問題清單（空＝可信）。執行期載入不檢查這些，報表為了不顯示壞數字才檢查。
    除了計數的不變式，還會用放行檔自己記錄的 config 重新跑一次最終測試閘門（C.final_gate_failures），
    要求重算結果與 passed／failed_checks 一致：手改成 passed=True 但證據不足（接受筆數或負例太少、上界超標）的檔案會被抓到。"""
    if not isinstance(ft, dict):
        return ["final_test 不是物件"]
    problems: list[str] = []
    for key in ("test_pairs", "real_evaluated", "accepted", "correct", "wrong_root"):
        if not _is_count(ft.get(key)):
            problems.append(f"{key} 不是非負整數")
    if problems:
        return problems
    if not ft["accepted"] <= ft["real_evaluated"] <= ft["test_pairs"]:
        problems.append("accepted ≤ real_evaluated ≤ test_pairs 不成立")
    if ft["correct"] + ft["wrong_root"] != ft["accepted"]:
        problems.append("correct + wrong_root ≠ accepted")
    fa = ft.get("fa")
    if not isinstance(fa, dict) or set(fa) != set(C.FAMILIES):
        problems.append("fa 的負例類別與預期不符")
    else:
        for fam in C.FAMILIES:
            item = fa[fam]
            if not isinstance(item, dict) or not _is_count(item.get("accepted")) or not _is_count(item.get("n")) \
                    or item["accepted"] > item["n"]:
                problems.append(f"fa.{fam} 的計數不合法")
    if not isinstance(ft.get("passed"), bool) or not isinstance(ft.get("failed_checks"), list):
        problems.append("passed／failed_checks 型別不合法")
    elif ft["passed"] != (ft["failed_checks"] == []):
        problems.append("passed 與 failed_checks 互相矛盾")
    if problems:
        return problems
    cfg = _gate_config(config)
    if cfg is None:
        return ["放行檔的 config 缺少或不合法，無法重算最終測試閘門"]
    res = C.UnionResult(ft["real_evaluated"], ft["accepted"], ft["correct"], ft["wrong_root"],
                        {fam: (ft["fa"][fam]["accepted"], ft["fa"][fam]["n"]) for fam in C.FAMILIES})
    if (C.final_gate_failures(res, cfg) == []) != ft["passed"]:
        problems.append("以放行檔記錄的設定重算閘門，結果與 passed 不一致")
    return problems


def _metrics(ft: Mapping) -> dict:
    return {
        "real_evaluated": ft["real_evaluated"],
        "accepted": ft["accepted"],
        "release_rate": ratio(ft["accepted"], ft["real_evaluated"]),
        "precision": ratio(ft["correct"], ft["accepted"]),
        "wrong_root_rate": ratio(ft["wrong_root"], ft["accepted"]),
        "false_accept": {fam: ratio(ft["fa"][fam]["accepted"], ft["fa"][fam]["n"]) for fam in C.FAMILIES},
        "incremental_over_existing": ft.get("incremental_over_existing"),
    }


def _freshness(row: Mapping) -> str:
    h, p = row.get("headwords_match"), row.get("pairs_match")
    if not isinstance(h, bool) or not isinstance(p, bool):   # None 或異常型別一律 unknown，不靠 truthiness
        return "unknown"
    return "fresh" if h and p else "stale"


def tribe_capability(row: Mapping, entry: Any) -> dict:
    """row 是 report_morphology_inputs.collect 的一列（含 loadable），entry 是放行檔裡這一族的資料（或 None）。"""
    freshness = _freshness(row)
    ft = entry.get("final_test") if isinstance(entry, dict) else None
    if not isinstance(entry, dict):
        integrity, problems = "unknown", ["放行檔沒有這一族的資料"]
    elif not isinstance(entry.get("enabled"), bool):
        integrity, problems = "invalid", ["enabled 不是布林值"]
    elif ft is None:
        # 停用且沒有最終測試是正常的（資料不足／聯集達不到目標）；啟用卻沒有最終測試就是壞資料
        integrity, problems = ("valid", []) if entry["enabled"] is False else ("invalid", ["啟用卻沒有最終測試紀錄"])
    else:
        problems = validate_final_test(ft, entry.get("config"))
        # 產生器：enabled = 有通過門檻的規則 且 最終測試通過；所以 enabled=True 一定伴隨 passed=True
        if not problems and entry["enabled"] and not ft["passed"]:
            problems = ["enabled=True 但最終測試未通過"]
        integrity = "invalid" if problems else "valid"

    if ft is None:
        gate = "disabled" if integrity == "valid" else "unknown"
    elif integrity == "valid":
        gate = "passed" if ft["passed"] else "failed"
    else:
        gate = "unknown"

    return {
        "tribe": row["tribe"],
        "layers": {
            "input_freshness": freshness,
            "artifact_integrity": integrity,
            "runtime_rebuild_loadable": row.get("loadable") is True,
            "gate": gate,
        },
        "snapshot_stale": freshness == "stale",
        "artifact_enabled": entry.get("enabled") if isinstance(entry, dict) else None,
        "reason": (entry.get("reason") or "") if isinstance(entry, dict) else "",
        "loadable_reason": row.get("loadable_reason", ""),
        "problems": problems,
        "metrics": _metrics(ft) if ft is not None and integrity == "valid" else None,
        "inputs": row["now"],
    }


def build_report(inputs_report: Mapping, artifact_tribes: Mapping | None) -> dict:
    """inputs_report 是 report_morphology_inputs.collect 的輸出；artifact_tribes 是放行檔的 tribes（讀不到時為 None）。"""
    tribes = artifact_tribes or {}
    return {
        "report_version": REPORT_VERSION,
        "artifact_generator": inputs_report.get("artifact_generator"),
        "artifact_error": inputs_report.get("artifact_error"),
        "definitions": {
            "release_rate": "accepted / real_evaluated", "precision": "correct / accepted",
            "wrong_root_rate": "wrong_root / accepted", "false_accept": "accepted / n（各負例類別）",
            "interval": "Wilson 95% (z=1.96)", "zero_denominator": "value=null, interval=[0,1]",
        },
        "tribes": [tribe_capability(row, tribes.get(row["tribe"])) for row in inputs_report["tribes"]],
    }
