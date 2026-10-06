"""讓「加分功能」的外部呼叫（Firestore 交易、Postgres 寫入）有明確的等待上限，不拖慢作答回應。

作答端點是同步函式，Firestore 交易爭用時最壞要等好幾秒（見 rule_state_store.MAX_TRANSACTION_ATTEMPTS）、
Postgres 連線池耗盡時也可能等 pool_timeout。這些步驟都不是作答的必要條件，所以：
- 丟到有上限的背景執行緒池跑，呼叫端最多等 timeout 秒；
- 同時執行中的工作數有上限（BoundedSemaphore）；滿了就直接放棄這次（"busy"），不排隊，免得外部服務
  故障時工作堆積、把執行緒池塞滿；
- 逾時的工作不會被中斷，會在背景跑完（狀態可能仍然寫入）；呼叫端要把逾時當成「不確定有沒有寫入」。

回傳 (狀態, 值)：狀態是 "ok"、"busy"、"timeout"、"error" 之一。
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any, Callable

logger = logging.getLogger(__name__)

MAX_WORKERS = 8

_pool: ThreadPoolExecutor | None = None
_pool_lock = threading.Lock()
_slots = threading.BoundedSemaphore(MAX_WORKERS)


def _get_pool() -> ThreadPoolExecutor:
    """執行緒池在第一次用到時才建立；shutdown() 之後再用會重新建立（同一個行程裡 app 可能重新啟動，
    例如測試與 --reload，不能讓一次關閉就讓之後所有背景工作永久失敗）。"""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="quiz-bg")
        return _pool


def shutdown() -> None:
    """服務關閉時呼叫：放棄還沒開始的工作，不等執行中的（底層呼叫卡住時不要拖住關閉／滾動部署）。"""
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.shutdown(wait=False, cancel_futures=True)


def run_with_deadline(fn: Callable[[], Any], timeout: float) -> tuple[str, Any]:
    if not _slots.acquire(blocking=False):
        logger.warning("quiz background work skipped: all %d workers busy", MAX_WORKERS)
        return "busy", None
    try:
        future = _get_pool().submit(fn)
    except Exception:
        _slots.release()
        logger.exception("quiz background work could not be scheduled")
        return "error", None
    future.add_done_callback(lambda _f: _slots.release())
    try:
        return "ok", future.result(timeout=timeout)
    except FutureTimeout:
        logger.warning("quiz background work exceeded %.1fs (continues in the background)", timeout)
        return "timeout", None
    except Exception:
        logger.warning("quiz background work failed", exc_info=True)
        return "error", None
