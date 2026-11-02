"""讓 FastAPI 的付費功能（翻譯）也受 AI 月預算自動關閉保護（稽核 AI-1）。

預算的評估與關閉旗標都在 Django（adminapi/ai_budget.py：要彙總 AiUsageLog、套價目表、寫稽核紀錄），
而且原本只有 Django 的 AI 請求會觸發它；如果只有翻譯在花錢，預算永遠沒有人評估。
所以這裡在翻譯要呼叫 LLM 之前，「順便」通知 Django 的內部端點（adminapi/internal_views.py）評估一次：

- 每個 process 至多每 INTERVAL_SECONDS 秒通知一次，且在背景執行緒送出，不增加翻譯請求的延遲。
- best-effort：失敗只記 log，不影響翻譯。預算超過時 Django 會把 translation_enabled 關掉，
  FastAPI 的旗標快取（feature_flags.py）最多再過約 30 秒就會看到，所以這不是精確的硬上限
  （Anthropic Console 的硬性花費上限才是最後一道防線）。
- 用共用密鑰 INTERNAL_API_SECRET 認證（至少 32 字元），位址只接受 https 或本機的 http（config/internal_api.py）。
"""
import logging
import os
import threading
import time

import requests

from config.internal_api import base_url_problem, secret_problem

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 60
_TIMEOUT_SECONDS = 5
_ENFORCE_PATH = "/adminapi/internal/ai-budget/enforce/"

_lock = threading.Lock()
_last_poke = 0.0
_warned = False


def _django_base_url() -> str:
    return os.getenv("DJANGO_INTERNAL_BASE_URL") or "http://127.0.0.1:8000"


def _send(secret: str, base_url: str) -> None:
    try:
        # allow_redirects=False：密鑰標頭不跟著重新導向去別的位址
        resp = requests.post(
            base_url + _ENFORCE_PATH, headers={"X-Internal-Secret": secret},
            timeout=_TIMEOUT_SECONDS, allow_redirects=False,
        )
        if resp.status_code != 200:
            logger.warning("通知 Django 評估 AI 月預算失敗：HTTP %s", resp.status_code)
    except Exception:
        logger.warning("通知 Django 評估 AI 月預算失敗", exc_info=True)


def poke(now: float | None = None) -> bool:
    """需要時在背景通知 Django 評估預算；回傳這次是否真的送出（給測試用）。不會丟出例外。"""
    global _last_poke, _warned
    secret = os.getenv("INTERNAL_API_SECRET", "")
    base_url = _django_base_url()
    # 沒設定密鑰＝內部通道沒開，默默略過（本機開發）；設定不合格則大聲說一次
    if not secret:
        return False
    problem = secret_problem(secret) or base_url_problem(base_url)
    if problem:
        if not _warned:
            _warned = True
            logger.error("不通知 Django 評估 AI 月預算：%s", problem)
        return False

    now = time.monotonic() if now is None else now
    with _lock:
        if _last_poke and now - _last_poke < INTERVAL_SECONDS:
            return False
        _last_poke = now
    threading.Thread(target=_send, args=(secret, base_url), daemon=True, name="ai-budget-poke").start()
    return True
