"""FastAPI 端讀取 Django 的 FeatureFlag 表——只有族語翻譯功能在用，讓後台
（frontend/src/_admin/system/FeatureFlags.jsx，通用登錄表，讀
/adminapi/feature-flags/）能即時開關這個功能，不用改程式碼、不用重新部署。

跟 backend/fastAPI/usage_events.py 是同一種「兩個服務共用同一個 Postgres
執行個體、FastAPI 用 SQLAlchemy Core 直接讀寫 Django migration 管理的表」
精神，這裡是唯讀方向。刻意不用 ORM、不 import Django 的 model 定義——只需要
對一張表做單欄查詢，用 Table/select() 就足夠，避免產生 FastAPI 對 Django
程式碼的相依。**這張表的欄位一旦異動，這裡手動組的 Table 定義要記得同步
更新**，兩邊沒有共用的 schema 定義來源。

用跟 backend/fastAPI/rate_limit_config.py 相同的 TTL 輪詢模式——開關改了之後
最慢幾十秒內生效即可，不是每個請求都真的查一次 DB。查詢失敗（連線問題、
表結構對不上）一律 fail-open 視為啟用：這個查詢只是「要不要允許呼叫付費
LLM」的輔助判斷，本身故障不該讓翻譯功能連帶整個掛掉。
"""
import logging
import os
import threading
import time

from sqlalchemy import Boolean, Column, MetaData, String, Table, create_engine, select
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)

_database_url = os.getenv("DATABASE_URL")
if _database_url and _database_url.startswith("postgres://"):
    _database_url = "postgresql://" + _database_url[len("postgres://"):]

_engine = None
if _database_url:
    _engine = create_engine(
        _database_url,
        pool_size=2, max_overflow=3, pool_timeout=5,
        pool_pre_ping=True, pool_recycle=1800,
    )

_metadata = MetaData()
# 對應 backend/adminapi/models.py 的 FeatureFlag。
_feature_flag_table = Table(
    "adminapi_featureflag",
    _metadata,
    Column("key", String(100)),
    Column("enabled", Boolean),
)

_TTL_SECONDS = 30
_lock = threading.Lock()
_cache: dict[str, bool] = {}
_last_fetch = 0.0


def _refresh_if_stale() -> None:
    global _last_fetch, _cache
    now = time.monotonic()
    if now - _last_fetch < _TTL_SECONDS:
        return
    with _lock:
        if time.monotonic() - _last_fetch < _TTL_SECONDS:
            return
        if _engine is None:
            _last_fetch = now
            return
        try:
            with _engine.connect() as conn:
                rows = conn.execute(select(_feature_flag_table.c.key, _feature_flag_table.c.enabled)).fetchall()
            _cache = {r.key: bool(r.enabled) for r in rows}
            _last_fetch = now
        except SQLAlchemyError:
            logger.warning("讀取 FeatureFlag 失敗，本次沿用舊快取（或預設全部啟用）", exc_info=True)
            _last_fetch = now  # 避免查詢持續失敗時每個請求都重試，仍照 TTL 節流


def is_enabled(key: str, default: bool = True) -> bool:
    """查無這個 key（尚未種子、表不存在、DB 連不上）一律 fail-open 回傳
    default——這個查詢只是輔助判斷，不該因為自己故障就讓呼叫端整個掛掉。"""
    _refresh_if_stale()
    return _cache.get(key, default)
