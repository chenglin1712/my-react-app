"""FastAPI 端 12 個 @limiter.limit(...) 呼叫點的動態限流值——輪詢 Django
adminapi 的 RateLimitRule（backend=fastapi 那批，見
backend/adminapi/rate_limit_views.py 的 public_fastapi_rate_limit_rules）。

完全比照 game_config.py／routes/quiz.py 既有的 TTL 輪詢模式，差別只在於
這裡快取的是「key -> rate 字串」的整包字典（一次 HTTP 請求換全部 12 筆），
不是逐一攤平成模組層級變數——因為 slowapi 的 @limiter.limit() 接受
zero-arg callable（見 rate_limit.py 的既有驗證），呼叫端只需要
`get_configured_rate("key", "20/minute")` 這種寫法，不需要 12 個獨立的
全域變數名稱。

get_configured_rate() 是給 @limiter.limit(lambda: get_configured_rate(...))
用的——slowapi／limits 套件會在每次請求時才真正呼叫這個 callable（不是
裝飾器套用當下的一次性求值），但函式內部的 _refresh_if_stale() 有 TTL
保護，不會讓每個請求都真的發一次 HTTP 請求給 Django。
"""
import logging
import os
import threading
import time

import requests

logger = logging.getLogger(__name__)

_RATE_LIMIT_CONFIG_URL = (
    os.getenv("DJANGO_INTERNAL_BASE_URL", "http://127.0.0.1:8000")
    + "/adminapi/public/fastapi-rate-limit-rules/"
)
# 限流值改了之後最慢幾分鐘內生效即可，不是秒等的即時性需求，跟 IRT／
# 遊戲參數輪詢同一種取捨。
_RATE_LIMIT_CONFIG_TTL_SECONDS = 300
_rate_limit_last_fetch = 0.0
_rate_limit_lock = threading.Lock()
_rate_limit_rules: dict = {}


def _refresh_if_stale() -> None:
    global _rate_limit_last_fetch, _rate_limit_rules

    if time.monotonic() - _rate_limit_last_fetch < _RATE_LIMIT_CONFIG_TTL_SECONDS:
        return

    with _rate_limit_lock:
        if time.monotonic() - _rate_limit_last_fetch < _RATE_LIMIT_CONFIG_TTL_SECONDS:
            return
        try:
            resp = requests.get(_RATE_LIMIT_CONFIG_URL, timeout=5)
            resp.raise_for_status()
            _rate_limit_rules = resp.json().get("rules", {})
        except Exception:
            # Django 暫時連不上時保留目前值（可能是上次成功抓到的，也可能是
            # 空字典）——空字典會讓 get_configured_rate() 一律退回呼叫端的
            # 預設值，等於這次輪詢失敗前的行為完全不變，不會讓限流突然失效。
            logger.warning("[rate_limit_config] 無法從後台讀取限流規則，沿用目前值", exc_info=True)
        finally:
            _rate_limit_last_fetch = time.monotonic()


def get_configured_rate(key: str, default: str) -> str:
    _refresh_if_stale()
    return _rate_limit_rules.get(key, default)
