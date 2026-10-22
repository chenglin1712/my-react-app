"""評測題組的載入與格式檢查（路線圖 #29）。

題目有兩個來源：
  - cases.json：人工撰寫、不需要族語標準答案的題目（提示注入、離題、安全、計畫、閒聊…）。
  - dictionary_cases.py：每次從辭典資料庫抽樣產生的詞彙題。族語正確性的標準答案只能來自辭典，
    不由模型或程式作者產生，所以這類題目不寫死在檔案裡。
"""
import json
import re
from pathlib import Path

from .scoring import CHECKS

CASES_PATH = Path(__file__).resolve().parent / "cases.json"
# 同時也是 Batch API 的 custom_id 規則
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


# 各項檢查必要的參數與型別（沒列出的檢查不需要參數）
_PARAMS = {
    "max_chars": {"value": "int"},
    "not_contains": {"values": "list"},
    "contains_any": {"values": "list"},
    "plan_events_between": {"min": "int", "max": "int"},
}


class CaseError(ValueError):
    pass


def validate_case(case: dict) -> dict:
    if not isinstance(case, dict):
        raise CaseError(f"題目不是物件：{case!r}")
    case_id = case.get("id", "")
    if not isinstance(case_id, str) or not _ID_RE.match(case_id):
        raise CaseError(f"題目編號只能用英數字、底線與連字號（64 字內）：{case_id!r}")
    for key in ("category", "message"):
        if not isinstance(case.get(key), str) or not case[key].strip():
            raise CaseError(f"{case_id}：缺少 {key}")
    checks = case.get("checks", [])
    if not isinstance(checks, list):
        raise CaseError(f"{case_id}：checks 必須是清單")
    for spec in checks:
        if not isinstance(spec, dict) or spec.get("type") not in CHECKS:
            raise CaseError(f"{case_id}：不認得的檢查 {spec!r}（可用：{', '.join(sorted(CHECKS))}）")
        # 參數在載入時就檢查，不要等花了 API 費用、跑到那一題才因為缺參數而失敗
        for key, kind in _PARAMS.get(spec["type"], {}).items():
            value = spec.get(key)
            if kind == "int" and (isinstance(value, bool) or not isinstance(value, int)):
                raise CaseError(f"{case_id}：{spec['type']} 需要整數參數 {key}")
            if kind == "list" and (not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value)):
                raise CaseError(f"{case_id}：{spec['type']} 需要字串清單參數 {key}")
    if not checks and not case.get("judge"):
        raise CaseError(f"{case_id}：至少要有一項規則檢查或評審標準")
    judge = case.get("judge")
    if judge is not None and (not isinstance(judge, str) or not judge.strip()):
        raise CaseError(f"{case_id}：judge 必須是非空字串")
    return case


def load_cases(path: Path = CASES_PATH) -> list[dict]:
    cases = [validate_case(c) for c in json.loads(path.read_text(encoding="utf-8"))]
    seen = set()
    for case in cases:
        if case["id"] in seen:
            raise CaseError(f"題目編號重複：{case['id']}")
        seen.add(case["id"])
    return cases
