"""讓「TTL 到期就同步重抓」的設定快取改在背景執行緒更新（稽核 BE4-06）。

feature_flags、rate_limit_config、game_config 原本在請求路徑上、逾時到期的那一刻同步查資料庫或呼叫 Django
（requests 逾時 5 秒、資料庫連線預設更久），而這幾個函式是在 async 端點／slowapi 的限流判斷裡直接呼叫的，
卡住的就是整個事件迴圈：Django 或資料庫一慢，整個 FastAPI 一起停。

做法：main.py 的 lifespan 呼叫 enable()；到期時請求只負責「認領」這次更新、立刻用目前的快取值回應，
實際的抓取丟給背景執行緒（第一次請求時快取還是空的，先用預設值回應並觸發載入；會花錢的旗標用
feature_flags.is_enabled_paid()，載入完成前視為關閉）。沒有呼叫 enable()（測試、獨立腳本）時維持原本的同步行為，
所以既有的快取測試不受影響。
注意：查詢本身沒有 statement timeout（只有連線逾時）。查詢卡住時該名稱的更新會一直佔著，旗標超過 10 分鐘沒更新
會讓付費功能 fail-closed，這是刻意接受的失效方向。
"""
import logging
import threading

logger = logging.getLogger(__name__)

_enabled = False
_running: set[str] = set()
_lock = threading.Lock()


def enable() -> None:
    global _enabled
    _enabled = True


def disable() -> None:
    global _enabled
    _enabled = False


def is_enabled() -> bool:
    return _enabled


def spawn(name: str, fn) -> bool:
    """在背景執行 fn（同名的更新同一時間只會有一個）。回傳是否真的啟動了新的執行緒。"""
    with _lock:
        if name in _running:
            return False
        _running.add(name)

    def _run():
        try:
            fn()
        except Exception:
            logger.exception("[background_refresh] %s 更新失敗", name)
        finally:
            with _lock:
                _running.discard(name)

    try:
        threading.Thread(target=_run, daemon=True, name=f"refresh-{name}").start()
    except RuntimeError:
        # 開不了新執行緒：把名稱放掉，否則之後這個更新永遠被當成「還在跑」而不再重試
        with _lock:
            _running.discard(name)
        logger.exception("[background_refresh] %s 無法啟動背景執行緒", name)
        return False
    return True
