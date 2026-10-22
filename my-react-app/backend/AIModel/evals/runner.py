"""實際跑一題（路線圖 #29）：走和學生一樣的 run_tayal_chat，只是不經過 HTTP、驗證與額度。

評測不碰學生資料：不傳學習資料（profile=None）、不接記憶、uid 固定為 "eval"。
用量照常記進 AiUsage（feature=chat），評測的花費在後台「AI 用量」頁看得到，uid 為 eval。
"""
import datetime
import logging

from config.tribes import TRIBE_IDS, TRIBE_MAP

from ..services import TAIPEI, build_chat_system, run_tayal_chat, system_text
from ..tools import DictionaryLookup
from .scoring import Observation

logger = logging.getLogger(__name__)

EVAL_UID = "eval"


class CountingLookup(DictionaryLookup):
    """包住真正的辭典查詢，數有沒有被呼叫（「助手有沒有先查辭典」是規則判分的依據）。"""

    def __init__(self, inner: DictionaryLookup):
        self.inner = inner
        self.calls = 0

    def search(self, forms):
        self.calls += 1
        return self.inner.search(forms)

    def names(self, forms):
        return self.inner.names(forms)

    def get(self, word_id):
        self.calls += 1
        return self.inner.get(word_id)


def current_prompt_text(tribe_name: str = "") -> str:
    """目前正式使用的固定提示詞（偵測回覆有沒有外洩它）。含辭典規則，不含學生資料。"""
    today = datetime.datetime.now(TAIPEI).date()
    blocks = build_chat_system(tribe_name or "泰雅語", None, today, with_dictionary=True)
    return system_text(blocks[:1])


def run_case(client, case: dict, *, tribe: str, lookup: DictionaryLookup | None) -> Observation:
    """跑一題。任何例外都轉成 Observation.error（這題算失敗），不讓一題的錯誤中斷整批。"""
    counting = CountingLookup(lookup) if lookup is not None else None
    try:
        result = run_tayal_chat(
            client, TRIBE_MAP.get(tribe, "泰雅語"), case["message"], None, uid=EVAL_UID,
            history=None, lookup=counting, memory=False,
        )
    except Exception as exc:  # noqa: BLE001 - 評測要能跑完整批
        logger.warning("[AIModel.evals] %s 執行失敗：%s", case["id"], type(exc).__name__)
        return Observation(case_id=case["id"], error=f"{type(exc).__name__}: {str(exc)[:200]}")
    return Observation(
        case_id=case["id"],
        message=result.get("message", ""),
        refused=bool(result.get("refused")),
        study_plan=result.get("study_plan"),
        entries=result.get("entries") or [],
        unverified=result.get("unverified") or [],
        tool_calls=counting.calls if counting else 0,
    )


def default_lookup(tribe: str):
    from ..tools import SqlDictionaryLookup

    return SqlDictionaryLookup(TRIBE_IDS.get(tribe, TRIBE_IDS["tayal"]))
