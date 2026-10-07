"""放行檔（morphology_rules.json）的讀取與「這一族能不能啟用」的判斷——純函式，不碰 DB、HTTP、快取、logger。

執行期載入（fastAPI/routes/translation/morph.py）與後台報表（adminapi 的 report_morphology_*）都要回答同一個
問題：「這份放行檔裡這個族語的資料，現在能不能被載入？」如果兩邊各寫一套檢查，只要一邊多一道、少一道，報表就會
對著維運人員說「可以載入」而實際不行（或反過來）。所以判斷邏輯只放在這裡：

- assess_artifact_entry()：依序檢查檔案、版本、族語資料、啟用旗標、最終測試的通過紀錄、規則、設定、詞庫指紋，
  任何一關不過就回傳 ok=False 加上原因；**永遠不丟例外**（讀檔、JSON、型別錯誤都轉成 reason）。
- 判斷的順序與原因文字，與抽出之前的 morph._build_entry 完全一致（執行期的測試鎖住這些文字與行為）。
- 詞庫指紋是用「呼叫端給的函式」才去算：停用的族語連資料庫都不用查（原本就是這樣）。

報表另外會用 validate_final_test() 檢查最終測試各項計數的內部一致性（執行期載入並不檢查這些，只看 passed 與
failed_checks）；兩者不要混為一談：這裡的「載入判斷」是執行期的契約，「計數一致性」是報表為了不顯示壞數字多做的檢查。
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Mapping

from config import morphology as M
from config import morphology_calibration as C

MAX_RULES = 500   # 放行檔規則數量上限，防止異常檔案撐爆記憶體


def read_artifact(path: Path) -> dict:
    """讀放行檔並檢查最外層格式；不合就丟 ValueError（呼叫端或 assess_artifact_entry 轉成原因）。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema") != C.SCHEMA_VERSION or not isinstance(data.get("tribes"), dict):
        raise ValueError("放行檔格式或版本不符")
    return data


def parse_rules(entry: dict) -> tuple[dict[M.MorphRule, int], dict[M.MorphRule, float]]:
    raw_rules = entry.get("rules")
    if not isinstance(raw_rules, list) or not raw_rules or len(raw_rules) > MAX_RULES:
        raise ValueError("規則清單為空或數量不合理")
    support: dict[M.MorphRule, int] = {}
    reliability: dict[M.MorphRule, float] = {}
    for item in raw_rules:
        rule = C.rule_from_dict(item)
        sup, rel = item.get("support"), item.get("reliability")
        if isinstance(sup, bool) or not isinstance(sup, int) or sup < 1:
            raise ValueError(f"規則 {rule.marker} 的 support 不合法")
        if isinstance(rel, bool) or not isinstance(rel, (int, float)) or not math.isfinite(rel) or not 0.0 <= rel <= 1.0:
            raise ValueError(f"規則 {rule.marker} 的 reliability 不合法")
        if rule in support:
            raise ValueError(f"規則重複：{rule.marker}")
        support[rule] = sup
        reliability[rule] = float(rel)
    return support, reliability


@dataclass(frozen=True)
class EntryAssessment:
    ok: bool
    reason: str = ""
    log: bool = True                       # 執行期是否要為這個停用原因記 warning（「放行檔標示停用」是預期狀況，不記）
    support: Mapping = field(default_factory=dict)
    reliability: Mapping = field(default_factory=dict)
    min_root_len: int = 0


def _no(reason: str, log: bool = True) -> EntryAssessment:
    return EntryAssessment(False, reason, log)


def assess_artifact_entry(path: Path, slug: str, tribe_id: str,
                          current_headword_fingerprint: Callable[[], str]) -> EntryAssessment:
    """這一族的放行檔資料現在能不能被載入。current_headword_fingerprint 是「算出目前辭典詞庫指紋」的函式，
    只有前面所有檢查都通過才會被呼叫。永遠不丟例外。"""
    try:
        artifact = read_artifact(path)
    except Exception as exc:
        return _no(f"載入失敗（{type(exc).__name__}）：{exc}")
    return assess_loaded_artifact(artifact, slug, tribe_id, current_headword_fingerprint)


def assess_loaded_artifact(artifact: dict, slug: str, tribe_id: str,
                           current_headword_fingerprint: Callable[[], str]) -> EntryAssessment:
    """同 assess_artifact_entry，但用已讀入（且通過 read_artifact 外層檢查）的內容：報表一次讀檔、五族共用同一份，
    才不會在讀檔之間被部署換掉而混用不同版本。永遠不丟例外。"""
    try:
        if artifact.get("generator") != C.GENERATOR_VERSION:
            return _no("放行檔不是由目前版本的產生器產生，請重跑 build_morphology_rules")
        entry = artifact["tribes"].get(slug)
        if not isinstance(entry, dict):
            return _no(f"放行檔沒有 {slug} 的資料")
        if entry.get("tribe_id") != tribe_id:
            return _no(f"放行檔裡 {slug} 的族語 ID 與目前資料庫不一致")
        if entry.get("enabled") is not True:
            return _no(f"放行檔標示 {slug} 停用：{entry.get('reason', '')}", log=False)

        # 啟用必須有「通過最終測試閘門」的紀錄，不能只靠 enabled 欄位（手動改檔不能繞過閘門）。
        final = entry.get("final_test")
        if not isinstance(final, dict) or final.get("passed") is not True or final.get("failed_checks") != []:
            return _no(f"放行檔裡 {slug} 沒有通過最終測試的紀錄")

        support, reliability = parse_rules(entry)
        cfg = entry.get("config")
        min_root_len = cfg.get("min_root_len") if isinstance(cfg, dict) else None
        if isinstance(min_root_len, bool) or not isinstance(min_root_len, int) or min_root_len < M.MIN_RESIDUE_LEN:
            return _no("放行檔的 min_root_len 不合法")
        fp = entry.get("fingerprint")
        expected = fp.get("headwords_sha256") if isinstance(fp, dict) else None
        if not isinstance(expected, str):
            return _no("放行檔缺少詞庫指紋")
        if current_headword_fingerprint() != expected:
            return _no(f"{slug} 的辭典詞庫內容與放行檔不一致，請重跑 build_morphology_rules 並提交新檔")
        return EntryAssessment(True, "", True, support, reliability, min_root_len)
    except Exception as exc:   # 檔案、JSON、規則驗證、資料庫——任何一種都只回報原因，不外洩例外
        return _no(f"載入失敗（{type(exc).__name__}）：{exc}")
