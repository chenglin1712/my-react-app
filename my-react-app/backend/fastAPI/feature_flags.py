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
例外：會花錢的旗標改用 is_enabled_paid()（稽核 BE4-16）——旗標資料超過 10 分鐘沒能成功更新（或啟動後
還沒成功讀過一次）就視為關閉。所以連旗標表都讀不到（例如沒跑 migration）的環境，翻譯會被關閉。
"""
import logging
import os
import threading
import time

from sqlalchemy import Boolean, Column, MetaData, String, Table, create_engine, select
from sqlalchemy.exc import SQLAlchemyError

from . import background_refresh

logger = logging.getLogger(__name__)

_database_url = os.getenv("DATABASE_URL")
from config.db_url import sqlalchemy_url

_database_url = sqlalchemy_url(_database_url)

_engine = None
if _database_url:
    _engine = create_engine(
        _database_url,
        pool_size=2, max_overflow=3, pool_timeout=5,
        pool_pre_ping=True, pool_recycle=1800,
        # 稽核 BE4-06：資料庫連不上時最多等 3 秒就放棄，不要卡到作業系統預設的逾時
        connect_args={"connect_timeout": 3} if not _database_url.startswith("sqlite") else {},
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
_last_success = 0.0  # 最後一次「成功讀到旗標表」的時間；0 代表從未成功


def _fetch_flags() -> None:
    """真正去讀資料庫、更新快取。背景模式下在背景執行緒跑，不在事件迴圈上。"""
    global _last_fetch, _last_success, _cache
    try:
        with _engine.connect() as conn:
            rows = conn.execute(select(_feature_flag_table.c.key, _feature_flag_table.c.enabled)).fetchall()
        _cache = {r.key: bool(r.enabled) for r in rows}
        _last_fetch = _last_success = time.monotonic()
    except SQLAlchemyError:
        logger.warning("讀取 FeatureFlag 失敗，本次沿用舊快取（或預設全部啟用）", exc_info=True)
        _last_fetch = time.monotonic()  # 避免查詢持續失敗時每個請求都重試，仍照 TTL 節流


def _refresh_if_stale() -> None:
    global _last_fetch
    now = time.monotonic()
    if now - _last_fetch < _TTL_SECONDS:
        return
    with _lock:
        if time.monotonic() - _last_fetch < _TTL_SECONDS:
            return
        if _engine is None:
            _last_fetch = now
            return
        if background_refresh.is_enabled():
            # 稽核 BE4-06：請求路徑不等資料庫。先認領這一輪（其他請求就不會再啟動），實際讀取丟到背景，
            # 這個請求用目前的快取值回應。
            _last_fetch = time.monotonic()
            background_refresh.spawn("feature_flags", _fetch_flags)
            return
        _fetch_flags()



def preload() -> None:
    """服務啟動時同步讀一次旗標表（在背景預熱執行緒呼叫，不在事件迴圈上）。沒有資料庫時什麼都不做。"""
    if _engine is not None:
        _fetch_flags()


def is_enabled(key: str, default: bool = True) -> bool:
    """查無這個 key（尚未種子、表不存在、DB 連不上）一律 fail-open 回傳
    default——這個查詢只是輔助判斷，不該因為自己故障就讓呼叫端整個掛掉。"""
    _refresh_if_stale()
    return _cache.get(key, default)


# 會花錢的旗標（例如 translation_enabled）容許的最長陳舊時間。比訪客旗標（2 分鐘）寬鬆，因為這類旗標
# 關閉的代價是整個功能不能用，但仍要有上限，否則資料庫異常期間「預算超過、旗標已被關閉」會讀不到而繼續花錢。
_PAID_MAX_AGE_SECONDS = 600
_last_paid_stale_log = 0.0


def is_enabled_paid(key: str, default: bool = True) -> bool:
    """給「開啟代表花錢」的旗標用（稽核 BE4-16）。平常等同 is_enabled()；但旗標資料超過 10 分鐘沒能成功更新
    時改回傳 False，並記 ERROR（至少相隔 5 分鐘一次）。服務剛啟動、還沒成功讀過旗標表時也視為關閉
    （第一次呼叫會觸發載入，通常幾十毫秒內就好）：資料庫裡的「已被預算保護關閉」不能因為重啟而在空窗期被忽略。
    沒有設定資料庫（本機開發）時不適用，照 is_enabled()。"""
    global _last_paid_stale_log
    _refresh_if_stale()
    if _engine is not None:
        if _last_success == 0.0:
            return False
        age = time.monotonic() - _last_success
        if age > _PAID_MAX_AGE_SECONDS:
            now = time.monotonic()
            if now - _last_paid_stale_log > 300:
                _last_paid_stale_log = now
                logger.error("FeatureFlag 已 %d 秒沒能成功更新，付費功能旗標 %s 暫時視為關閉", int(age), key)
            return False
    return is_enabled(key, default)


# 旗標資料超過這個秒數沒有成功更新，就不再相信快取裡的「開啟」。
_FAIL_CLOSED_MAX_AGE_SECONDS = 120


def is_enabled_fail_closed(key: str) -> bool:
    """給「開啟代表放行付費或對外風險」的旗標用（例如訪客試用）：查不到這個 key、從未成功讀過旗標表、
    或旗標表已經超過 2 分鐘沒能成功更新，一律視為關閉。一般的 is_enabled() 為了不讓輔助判斷的故障
    拖垮功能會沿用舊快取，不適合這種用途。營運方在資料庫異常期間需要能確定訪客入口是關著的。"""
    _refresh_if_stale()
    if _last_success == 0.0 or time.monotonic() - _last_success > _FAIL_CLOSED_MAX_AGE_SECONDS:
        return False
    return _cache.get(key, False)
