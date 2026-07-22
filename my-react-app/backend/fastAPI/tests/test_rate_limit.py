"""測試 fastAPI/rate_limit.py 的 REDIS_URL 接線：原本這支檔案完全沒接 REDIS_URL，
一律用記憶體計數，多 worker 部署時限流門檻會被 worker 數量乘倍放大，且 .env.example
的說明只提到 Django 三個 app，容易讓人誤以為設了就對 FastAPI 也生效。

limiter 是模組載入當下就依 os.getenv("REDIS_URL") 建好的模組層級單例，用
importlib.reload 搭配 monkeypatch 的環境變數重新載入模組來驗證兩種情境。
"""
import importlib

from limits.storage.memory import MemoryStorage
from limits.storage.redis import RedisStorage

from fastAPI import rate_limit as rate_limit_module


def _reload_with_env(monkeypatch, redis_url):
    if redis_url is None:
        monkeypatch.delenv("REDIS_URL", raising=False)
    else:
        monkeypatch.setenv("REDIS_URL", redis_url)
    return importlib.reload(rate_limit_module)


def test_no_redis_url_falls_back_to_memory_storage(monkeypatch):
    module = _reload_with_env(monkeypatch, None)
    assert isinstance(module.limiter._storage, MemoryStorage)


def test_redis_url_set_uses_redis_storage(monkeypatch):
    module = _reload_with_env(monkeypatch, "redis://localhost:6379/0")
    assert isinstance(module.limiter._storage, RedisStorage)


def teardown_module(module):
    # 恢復成沒有 REDIS_URL 的預設狀態，避免影響同一個 pytest session 裡其他
    # 會 import fastAPI.rate_limit（例如透過 fastAPI.main）的測試模組。
    import os
    os.environ.pop("REDIS_URL", None)
    importlib.reload(rate_limit_module)
