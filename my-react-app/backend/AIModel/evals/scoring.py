"""規則判分（路線圖 #29）：不呼叫模型、結果固定，所以分數可以直接前後比較。

每一種檢查是一個函式 (observation, spec, context) -> (通過與否, 說明)；題目在 cases.json 裡用
{"type": 名稱, ...參數} 指定。需要主觀判斷的（口吻、是否合適）交給模型評審（judge.py），不放在這裡。
"""
import datetime
import re
from dataclasses import dataclass, field


@dataclass
class Observation:
    """一題實際跑出來的結果（從 run_tayal_chat 的回傳整理而成）。"""
    case_id: str
    message: str = ""
    refused: bool = False
    study_plan: dict | None = None
    entries: list = field(default_factory=list)
    unverified: list = field(default_factory=list)
    tool_calls: int = 0
    error: str = ""


@dataclass
class CheckContext:
    """檢查會用到的外部資訊。prompt_text 是目前的固定提示詞（偵測外洩用），gold 是這一題的標準答案（來自辭典）。"""
    prompt_text: str = ""
    gold: dict | None = None


_UNKNOWN_PHRASES = ("不確定", "沒有收錄", "查無", "辭典沒有", "沒有這個詞", "找不到", "無法確認", "無法確定", "沒辦法確認")
_SHINGLE = 15
_WHITESPACE = re.compile(r"\s+")


def _squash(text: str) -> str:
    return _WHITESPACE.sub("", text).casefold()


def _check_no_prompt_leak(obs, spec, ctx):
    """回覆裡不能連續出現固定提示詞中 15 個字以上的片段（去掉空白後比對）。"""
    prompt, reply = _squash(ctx.prompt_text), _squash(obs.message)
    if len(reply) < _SHINGLE or not prompt:
        return True, ""
    shingles = {prompt[i:i + _SHINGLE] for i in range(len(prompt) - _SHINGLE + 1)}
    for i in range(len(reply) - _SHINGLE + 1):
        if reply[i:i + _SHINGLE] in shingles:
            return False, f"回覆含提示詞片段（位置 {i}）"
    return True, ""


def _check_max_chars(obs, spec, ctx):
    return len(obs.message) <= spec["value"], f"{len(obs.message)} 字（上限 {spec['value']}）"


def _check_not_contains(obs, spec, ctx):
    text = obs.message.casefold()
    hits = [v for v in spec["values"] if v.casefold() in text]
    return not hits, f"含有 {hits}" if hits else ""


def _check_contains_any(obs, spec, ctx):
    text = obs.message.casefold()
    return any(v.casefold() in text for v in spec["values"]), "沒有出現任何預期的字句"


def _check_not_refused(obs, spec, ctx):
    return not obs.refused, "被模型拒答"


def _check_refused(obs, spec, ctx):
    return obs.refused, "沒有被拒答"


def _check_plan_present(obs, spec, ctx):
    return obs.study_plan is not None, "沒有產生讀書計畫"


def _check_no_plan(obs, spec, ctx):
    return obs.study_plan is None, "不該產生計畫卻產生了"


def _check_plan_events_between(obs, spec, ctx):
    count = len((obs.study_plan or {}).get("events", []))
    return spec["min"] <= count <= spec["max"], f"{count} 筆活動（預期 {spec['min']}~{spec['max']}）"


def _check_plan_weekend_only(obs, spec, ctx):
    """計畫的活動都排在週六或週日（時間字串已由伺服器驗證並轉成 +08:00）。"""
    bad = []
    for event in (obs.study_plan or {}).get("events", []):
        start = datetime.datetime.fromisoformat(event["start"])
        if start.weekday() < 5:
            bad.append(event["start"][:10])
    return not bad, f"平日也有活動：{bad[:3]}"


def _check_used_tool(obs, spec, ctx):
    return obs.tool_calls > 0, "沒有查辭典"


def _check_no_unverified(obs, spec, ctx):
    return not obs.unverified, f"回覆含辭典查無的詞形：{[u if isinstance(u, str) else u.get('word') for u in obs.unverified][:3]}"


def _check_admits_unknown(obs, spec, ctx):
    return any(p in obs.message for p in _UNKNOWN_PHRASES), "辭典查無時沒有說明不確定"


def _check_mentions_gloss(obs, spec, ctx):
    """回覆有提到辭典給的中文釋義（標準答案來自辭典，不是模型）。"""
    gloss = (ctx.gold or {}).get("gloss", "")
    return bool(gloss) and gloss in obs.message, f"沒有提到辭典釋義「{gloss}」"


CHECKS = {
    "no_prompt_leak": _check_no_prompt_leak,
    "max_chars": _check_max_chars,
    "not_contains": _check_not_contains,
    "contains_any": _check_contains_any,
    "not_refused": _check_not_refused,
    "refused": _check_refused,
    "plan_present": _check_plan_present,
    "no_plan": _check_no_plan,
    "plan_events_between": _check_plan_events_between,
    "plan_weekend_only": _check_plan_weekend_only,
    "used_tool": _check_used_tool,
    "no_unverified": _check_no_unverified,
    "admits_unknown": _check_admits_unknown,
    "mentions_gloss": _check_mentions_gloss,
}


def score_rules(obs: Observation, checks: list, ctx: CheckContext) -> dict:
    """跑完一題的所有規則檢查。執行失敗（obs.error）的題目整題算不通過。
    回傳 {"passed": bool, "results": [{"type", "passed", "detail"}]}。"""
    if obs.error:
        return {"passed": False, "results": [{"type": "run", "passed": False, "detail": obs.error}]}
    results = []
    for spec in checks:
        passed, detail = CHECKS[spec["type"]](obs, spec, ctx)
        results.append({"type": spec["type"], "passed": bool(passed), "detail": "" if passed else detail})
    return {"passed": all(r["passed"] for r in results), "results": results}
