"""經學習者同意後，記錄假名化的詞素作答事件（旗標 quiz_rule_event_logging），用來事後評估
「規則熟練度」是否比單一能力值更能預測下一題對錯。

隱私與資料原則（細節見 config/quiz_research.py 與 adminapi/models/quiz_research.py）：
- 預設不記錄；必須同時滿足：旗標開啟、有設定假名用的鹽、這位使用者有「目前版本」的同意紀錄；
- 同意狀態存在 Postgres（跟事件同一個資料庫），伺服器端查詢，前端無法偽造；查詢失敗一律當成沒同意；
- 事件只存假名、規則 ID、診斷類別、模型預測值，不存 uid、詞形、句子，時間只到整點；
- 撤回同意會在同一個交易裡刪除該假名的全部事件；
- 寫入是 fire-and-forget：任何失敗只記 log，絕不影響作答。

跟 usage_events.py 一樣直接用 SQLAlchemy Core 讀寫 Django migration 管理的表，**欄位一旦異動，這裡手動組的
Table 定義要同步更新**（adminapi/models/quiz_research.py）。
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone as dt_timezone

from sqlalchemy import (BigInteger, Boolean, Column, DateTime, Float, Integer, MetaData, SmallInteger, String, Table,
                        UniqueConstraint, create_engine, delete, insert, select, update)
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from config import quiz_research as QR

logger = logging.getLogger(__name__)

_database_url = os.getenv("DATABASE_URL")
if _database_url and _database_url.startswith("postgres://"):
    _database_url = "postgresql://" + _database_url[len("postgres://"):]

# DATABASE_URL 沒設定（本機開發沒接 Postgres）時 _engine 是 None：整個研究記錄功能不可用。
_engine = None
if _database_url:
    _engine = create_engine(_database_url, pool_size=2, max_overflow=3, pool_timeout=5,
                            pool_pre_ping=True, pool_recycle=1800)

_metadata = MetaData()
# Django 的 BigAutoField 在 Postgres 是 bigint；SQLite（測試）只有 INTEGER PRIMARY KEY 才會自動編號。
_ID = BigInteger().with_variant(Integer, "sqlite")
_consent = Table(
    "adminapi_quizresearchconsent", _metadata,
    Column("id", _ID, primary_key=True),
    Column("pseudonym", String(64), nullable=False, unique=True),
    Column("consent_version", String(40), nullable=False),
    Column("granted_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True), nullable=True),
)
_events = Table(
    "adminapi_quizskillevent", _metadata,
    Column("id", _ID, primary_key=True),
    Column("pseudonym", String(64), nullable=False),
    Column("nonce", String(40), nullable=False),
    Column("occurred_at", DateTime(timezone=True), nullable=False),
    Column("tribe", String(20), nullable=False),
    Column("question_type", String(20), nullable=False),
    Column("target_rule_id", String(200), nullable=False),
    Column("selected_rule_id", String(200), nullable=False),
    Column("diagnosis_status", String(20), nullable=False),
    Column("error_type", String(20), nullable=False),
    Column("correct", Boolean, nullable=False),
    Column("probe", Boolean, nullable=False),
    Column("seconds_bucket", SmallInteger, nullable=False),
    Column("p_before", Float, nullable=True),
    Column("p_after", Float, nullable=True),
    Column("pred_skill", Float, nullable=True),
    Column("pred_ability", Float, nullable=True),
    Column("ability_before", Float, nullable=True),
    Column("model_version", String(32), nullable=False),
    Column("kit_version", String(40), nullable=False),
    Column("selection_policy", String(40), nullable=False),
    Column("consent_version", String(40), nullable=False),
    UniqueConstraint("pseudonym", "nonce"),
)
_AUTO = {"id", "pseudonym", "occurred_at", "consent_version"}      # 由這個模組自己填，呼叫端不能給
EVENT_COLUMNS = frozenset(c.name for c in _events.columns) - _AUTO
REQUIRED_EVENT_COLUMNS = frozenset(c.name for c in _events.columns if not c.nullable and not c.primary_key) - _AUTO


class ResearchUnavailable(Exception):
    """沒有資料庫連線或沒有設定假名用的鹽：研究記錄功能不可用。"""


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def available() -> bool:
    return _engine is not None and QR.salt() is not None


def pseudonym_for(uid: str) -> str | None:
    return QR.pseudonym(uid) if _engine is not None else None


def consent_state(uid: str) -> dict:
    """{"available": 功能是否可用, "granted": 目前版本的同意是否有效, "version": 目前同意說明的版本}。
    讀取失敗視為沒有同意（fail-closed）。"""
    state = {"available": available(), "granted": False, "version": QR.CONSENT_VERSION}
    pseud = pseudonym_for(uid)
    if pseud is None:
        state["available"] = False
        return state
    state["granted"] = has_consent(pseud)
    return state


def has_consent(pseud: str) -> bool:
    if _engine is None or not pseud:
        return False
    try:
        with _engine.connect() as conn:
            row = conn.execute(select(_consent.c.consent_version, _consent.c.revoked_at)
                               .where(_consent.c.pseudonym == pseud)).first()
    except Exception:
        logger.warning("quiz research consent lookup failed (treated as no consent)", exc_info=True)
        return False
    return bool(row) and row.revoked_at is None and row.consent_version == QR.CONSENT_VERSION


def set_consent(uid: str, granted: bool) -> dict:
    """同意或撤回。撤回會在同一個交易裡刪除該假名的全部事件。功能不可用或資料庫出錯時丟
    ResearchUnavailable（呼叫端回 503），不假裝成功。"""
    pseud = pseudonym_for(uid)
    if _engine is None or pseud is None:
        raise ResearchUnavailable("research logging is not configured")
    try:
        with _engine.begin() as conn:
            if granted:
                _upsert_grant(conn, pseud)
            else:
                conn.execute(update(_consent).where(_consent.c.pseudonym == pseud).values(revoked_at=_now()))
                conn.execute(delete(_events).where(_events.c.pseudonym == pseud))
    except SQLAlchemyError as exc:
        logger.warning("quiz research consent update failed", exc_info=True)
        raise ResearchUnavailable("database error") from exc
    return consent_state(uid)


def _upsert_grant(conn, pseud: str) -> None:
    values = dict(consent_version=QR.CONSENT_VERSION, granted_at=_now(), revoked_at=None)
    result = conn.execute(update(_consent).where(_consent.c.pseudonym == pseud).values(**values))
    if result.rowcount:
        return
    try:
        with conn.begin_nested():
            conn.execute(insert(_consent).values(pseudonym=pseud, **values))
    except IntegrityError:                     # 同時有另一個請求剛好建立了同一筆：改成更新
        conn.execute(update(_consent).where(_consent.c.pseudonym == pseud).values(**values))


def record_skill_event(uid: str, event: dict) -> bool:
    """記錄一筆事件；只有在有同意、設定完整時才寫入。成功寫入回傳 True；同一題重送（nonce 重複）、
    沒同意、功能不可用、任何錯誤都回傳 False，不丟例外。

    同意檢查與寫入在【同一個交易】裡，並用 SELECT … FOR UPDATE 鎖住這位使用者的同意列：撤回（也會更新同一列、
    再刪事件）會等這個交易結束，或是看到撤回之後才檢查——不會出現「使用者已撤回並看到資料被刪除，卻有事件在撤回
    之後才寫入」的交錯。（SQLite 沒有列鎖，測試只能驗證語句帶有 FOR UPDATE；真正的鎖行為要在 Postgres 驗證。）"""
    try:
        pseud = pseudonym_for(uid)
        if _engine is None or pseud is None:
            return False
        unknown, missing = set(event) - EVENT_COLUMNS, REQUIRED_EVENT_COLUMNS - set(event)
        if unknown or missing:
            logger.error("quiz research event has wrong fields: unexpected=%s missing=%s", sorted(unknown), sorted(missing))
            return False
        with _engine.begin() as conn:
            row = conn.execute(select(_consent.c.consent_version, _consent.c.revoked_at)
                               .where(_consent.c.pseudonym == pseud).with_for_update()).first()
            if not (row and row.revoked_at is None and row.consent_version == QR.CONSENT_VERSION):
                return False
            conn.execute(insert(_events).values(
                pseudonym=pseud, occurred_at=QR.hour_bucket(_now()), consent_version=QR.CONSENT_VERSION, **event))
        return True
    except IntegrityError:
        return False
    except Exception:
        logger.warning("quiz research event recording failed (ignored)", exc_info=True)
        return False
