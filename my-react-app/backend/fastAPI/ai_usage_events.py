"""FastAPI 端的 AI 用量寫入（翻譯功能呼叫 Anthropic 時）。

對應 backend/adminapi/models/ai_usage.py 的 `AiUsageLog` 與
migrations/0028_ai_usage_log.py，機制比照 usage_events.py：用 SQLAlchemy Core
對一個扁平表做單筆 INSERT，不 import Django。**那張表的欄位一旦異動，這裡手動
組的 `Table` 定義要同步更新**，兩邊沒有共用的 schema 定義來源。

`record_ai_usage()` 是 fire-and-forget：任何失敗只記 log，絕不讓翻譯請求失敗或變慢。
透過 config.llm.set_usage_recorder 在 FastAPI 啟動時註冊（見 main.py）。
"""
import logging
from datetime import datetime, timezone as dt_timezone

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, insert

from .usage_events import _engine

logger = logging.getLogger(__name__)

_metadata = MetaData()
_ai_usage_table = Table(
    "adminapi_aiusagelog",
    _metadata,
    Column("created_at", DateTime(timezone=True)),
    Column("feature", String(20)),
    Column("uid", String(128)),
    Column("model", String(80)),
    Column("status", String(20)),
    Column("request_id", String(80)),
    Column("input_tokens", Integer),
    Column("output_tokens", Integer),
    Column("cache_read_tokens", Integer),
    Column("cache_write_tokens", Integer),
    Column("latency_ms", Integer),
    Column("prompt_version", String(16)),     # 翻譯沒有助手提示詞版本，固定寫空字串（欄位是 NOT NULL）
)


def record_ai_usage(entry: dict) -> None:
    """寫入一筆 AI 用量。DATABASE_URL 沒設定（_engine 為 None）時靜默跳過。"""
    if _engine is None:
        return
    try:
        with _engine.begin() as conn:
            conn.execute(
                insert(_ai_usage_table).values(
                    created_at=datetime.now(dt_timezone.utc),
                    feature=entry["feature"][:20],
                    uid=(entry.get("uid") or "")[:128],
                    model=(entry.get("model") or "")[:80],
                    status=entry["status"][:20],
                    request_id=(entry.get("request_id") or "")[:80],
                    input_tokens=entry.get("input_tokens") or 0,
                    output_tokens=entry.get("output_tokens") or 0,
                    cache_read_tokens=entry.get("cache_read_tokens") or 0,
                    cache_write_tokens=entry.get("cache_write_tokens") or 0,
                    latency_ms=entry.get("latency_ms") or 0,
                    prompt_version=(entry.get("prompt_version") or "")[:16],
                )
            )
    except Exception:
        # 保守起見連非 SQLAlchemy 例外也一併吞掉——用量紀錄不能拖垮翻譯。
        logger.warning("AI 用量記錄失敗（不影響主要功能）：feature=%s", entry.get("feature"), exc_info=True)
