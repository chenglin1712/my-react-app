"""詞素級學習者模型（M4）的功能旗標（後台「功能開關」頁可即時開關，預設全部關閉）。

四個旗標彼此有相依，由上往下一層一層打開：
- DIAGNOSIS：出題時附診斷 token、作答時診斷錯誤類型（只回傳診斷，不改任何模型）；
- SKILL_UPDATE：依診斷更新每條規則的熟練度與混淆次數（需要 DIAGNOSIS）；
- ADAPTIVE：句子填空依熟練度估計挑「該練的規則」出題（需要 SKILL_UPDATE）；
- EVENTS：經使用者同意後，記錄假名化的研究事件（需要 DIAGNOSIS，另外還要有同意紀錄）。
相依關係用 enabled() 統一判斷，呼叫端不要各自拼湊。查詢旗標失敗一律視為關閉。
"""
import logging

from fastAPI import feature_flags

logger = logging.getLogger(__name__)

DIAGNOSIS = "quiz_morphology_diagnosis"
SKILL_UPDATE = "quiz_rule_skill_update"
ADAPTIVE = "quiz_rule_adaptive_selection"
EVENTS = "quiz_rule_event_logging"

ALL_FLAGS = (DIAGNOSIS, SKILL_UPDATE, ADAPTIVE, EVENTS)
_REQUIRES = {DIAGNOSIS: (), SKILL_UPDATE: (DIAGNOSIS,), ADAPTIVE: (DIAGNOSIS, SKILL_UPDATE), EVENTS: (DIAGNOSIS,)}


def _on(key: str) -> bool:
    try:
        return bool(feature_flags.is_enabled(key, default=False))
    except Exception:
        logger.exception("quiz flag lookup failed: %s", key)
        return False


def enabled(key: str) -> bool:
    """這個旗標本身與它相依的旗標都打開才算開。"""
    if key not in _REQUIRES:
        raise KeyError(key)
    return all(_on(k) for k in (*_REQUIRES[key], key))
