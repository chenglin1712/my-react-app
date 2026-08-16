"""通知 FastAPI 清除辭典/文法快取的呼叫端。

跟 _shared.py 的 safe_write_audit_log 同一種精神：辭典資料庫的寫入已經
commit 了（見 dictionary_write.py），快取失效通知失敗不能讓呼叫端收到
500——最壞情況只是 FastAPI 那邊沿用舊資料到下次寫入或重啟，記 log 讓
Sentry 能告警即可，不影響已經成功的主要操作。

呼叫順序很重要，呼叫端必須遵守：(1) 辭典 DB commit → (2) Django 端狀態
更新（transaction.atomic()）→ (3) 這裡的快取失效通知，在前兩者都完成之後、
交易區塊外。放在交易區塊內會在交易還可能回滾時就通知；在辭典 commit
之前通知，背景重新預熱反而會抓到舊資料重新快取，比完全不通知還糟。

這個通知機制只會清除「收到這次 HTTP request 的那一個 FastAPI process」裡的
process-local 記憶體快取，因此目前的部署前提是全系統同一時間只有一個
FastAPI process。不論是在單一容器內開啟多個 Uvicorn worker，或把 FastAPI 水平
擴展成多個 container replica，都會使這次通知只命中其中一個 process，其餘
process 可能無聲地持續回傳舊資料。水平擴展前必須先改用 Redis 等共享快取，
或導入能廣播到每個 process 的快取失效機制；不能只複製現有容器就當作完成擴展。
"""
import logging
import os

import requests

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "http://127.0.0.1:8001"
_TIMEOUT_SECONDS = 5


def invalidate_dictionary_cache(scopes, tribes=None):
    """scopes 是 {"words", "grammar", "grammar_affixes", "grammar_quiz"} 的子集合
    （或直接傳 ["all"]）；tribes 是族語 slug/簡稱/全名的清單，None 代表全部族語。

    INTERNAL_API_SECRET 沒設定時直接跳過（本機開發沒設定這個環境變數也不該
    讓辭典寫入功能整個不能用；FastAPI 那端本來就會在密鑰缺失時回 503，這裡
    提早跳過只是省一次注定失敗的 HTTP 往返，行為上沒有差異）。"""
    secret = os.getenv("INTERNAL_API_SECRET")
    if not secret:
        logger.warning("INTERNAL_API_SECRET 未設定，略過辭典快取失效通知（%s／%s）", scopes, tribes)
        return

    base_url = os.getenv("FASTAPI_INTERNAL_BASE_URL", _DEFAULT_BASE_URL)
    try:
        resp = requests.post(
            f"{base_url}/internal/cache/invalidate",
            json={"scopes": list(scopes), "tribes": tribes},
            headers={"X-Internal-Secret": secret},
            timeout=_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
    except Exception:
        logger.exception("辭典快取失效通知失敗（辭典寫入已完成，不影響本次操作結果，僅公開查詢頁面可能短暫沿用舊資料）")
