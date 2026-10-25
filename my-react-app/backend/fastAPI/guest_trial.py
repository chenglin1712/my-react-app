"""訪客翻譯試用的額度控管（C-2）。

規則（使用者已定案）：
- 每個瀏覽器每日 10 次（所有族語合計），台灣時間午夜重置。
- 另設「隱形的高 IP 保險上限」，暫定每日 1000 次，只擋明顯濫用，上線後依流量調整。
- 已登入使用者完全不經過這裡。
- 不設全站總量上限（已接受的風險；最後防線是 translation_enabled 與 guest_translation_enabled 旗標，
  以及 LLM 供應商的預算警示）。

計次存在 Postgres（Django 的 adminapi_guesttranslationusage 表，見 adminapi/models/guest_trial.py），
不是記憶體：正式環境重啟、多 worker 都不會讓次數歸零。跟 usage_events.py、feature_flags.py 同一種
「FastAPI 用 SQLAlchemy Core 直接存取 Django migration 管理的表」作法，**表的欄位異動時這裡的 Table
定義要同步更新**。

隱私：只存 HMAC-SHA256 雜湊值（鍵為 GUEST_TRIAL_SECRET），不存明文 IP 或瀏覽器代號；沒有設定密鑰
（或太短）時整個訪客試用自動停用，不會退回用明文或無鹽雜湊。

失敗一律往「不放行」方向：沒有資料庫、查詢失敗、密鑰未設定都回 unavailable，訪客得到「暫時無法使用」，
因為這一關保護的是付費 LLM 呼叫，寧可擋掉也不要讓額度失控。
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import random
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import (
    BigInteger, Column, Date, DateTime, Integer, MetaData, String, Table, UniqueConstraint, create_engine, delete, select, update,
)
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)

# 台灣沒有日光節約時間，固定 +8 即可；不依賴 tzdata（Windows 預設沒有）。
_TAIPEI = timezone(timedelta(hours=8))

SCOPE_BROWSER = "browser"
SCOPE_IP = "ip"

_MIN_SECRET_LENGTH = 32
# 雜湊資料只對「當天」計次有用；多留幾天只是方便除錯與對帳，之後就刪掉。
RETENTION_DAYS = 3
_PURGE_PROBABILITY = 0.01

_GUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

_database_url = os.getenv("DATABASE_URL")
from config.db_url import sqlalchemy_url

_database_url = sqlalchemy_url(_database_url)

_engine = None
if _database_url:
    _engine = create_engine(
        _database_url,
        pool_size=2, max_overflow=3, pool_timeout=5,
        pool_pre_ping=True, pool_recycle=1800,
    )

_metadata = MetaData()
# 對應 backend/adminapi/models/guest_trial.py + migrations/0019_guesttranslationusage.py。
_usage_table = Table(
    "adminapi_guesttranslationusage",
    _metadata,
    Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True),
    Column("day", Date),
    Column("scope", String(8)),
    Column("key_hash", String(64)),
    Column("count", Integer),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    # 與 Django 的 UniqueConstraint(uniq_guest_trial_day_scope_key) 相同；ON CONFLICT 靠它判斷衝突。
    # 正式環境的表由 Django migration 建立，這裡的定義只用在查詢與測試。
    UniqueConstraint("day", "scope", "key_hash", name="uniq_guest_trial_day_scope_key"),
)


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def browser_daily_limit() -> int:
    return _int_env("GUEST_TRIAL_DAILY_LIMIT", 10)


def ip_daily_limit() -> int:
    return _int_env("GUEST_TRIAL_IP_DAILY_LIMIT", 1000)


def _secret() -> str:
    return os.getenv("GUEST_TRIAL_SECRET", "")


def is_ready() -> bool:
    """資料庫與密鑰都就緒才開放訪客試用。"""
    if _engine is None:
        return False
    secret = _secret()
    if len(secret) < _MIN_SECRET_LENGTH or len(set(secret)) < 8:
        return False
    return True


def is_valid_guest_id(value: str | None) -> bool:
    return bool(value) and _GUEST_ID_PATTERN.match(value) is not None


def taipei_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(_TAIPEI).date()


def next_reset_at(today: date) -> str:
    """下一個台灣午夜（ISO 8601，含 +08:00），給前端顯示「幾點重置」。"""
    midnight = datetime(today.year, today.month, today.day, tzinfo=_TAIPEI) + timedelta(days=1)
    return midnight.isoformat()


def _hash(scope: str, value: str) -> str:
    return hmac.new(_secret().encode("utf-8"), f"{scope}:{value}".encode("utf-8"), hashlib.sha256).hexdigest()


@dataclass
class GuestQuota:
    allowed: bool
    # 不允許時的原因：browser（這個瀏覽器今天用完）、ip（這個網路今天用完）、unavailable（服務暫時無法使用）
    reason: str | None
    limit: int
    remaining: int
    resets_at: str
    day: date | None = None
    # 每一筆預留實際扣到的雜湊鍵，退還時用同一組，不必再重算
    browser_hash: str = ""
    ip_hash: str = ""


def _bump(conn, day: date, scope: str, key_hash: str, limit: int, now: datetime) -> int | None:
    """原子地把這個鍵今天的次數 +1；已達上限時不寫入並回傳 None。

    INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit RETURNING count：
    判斷與遞增在同一個語句裡完成，兩個同時送出的請求不會雙雙看到「還有 1 次」而都放行。
    """
    if limit <= 0:
        return None
    insert = postgresql.insert if conn.dialect.name == "postgresql" else sqlite.insert
    stmt = insert(_usage_table).values(
        day=day, scope=scope, key_hash=key_hash, count=1, created_at=now, updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[_usage_table.c.day, _usage_table.c.scope, _usage_table.c.key_hash],
        set_={"count": _usage_table.c.count + 1, "updated_at": now},
        where=_usage_table.c.count < limit,
    ).returning(_usage_table.c.count)
    row = conn.execute(stmt).first()
    return row[0] if row else None


def consume(guest_id: str, client_ip: str, now: datetime | None = None) -> GuestQuota:
    """替一次翻譯請求預留額度。瀏覽器與 IP 兩筆在同一個交易裡：任一筆超限就整筆回滾，
    不會出現「瀏覽器次數被扣了、但請求其實被 IP 上限擋下」的情況。"""
    now = now or datetime.now(timezone.utc)
    day = taipei_today(now)
    limit = browser_daily_limit()
    resets_at = next_reset_at(day)

    if not is_ready():
        return GuestQuota(False, "unavailable", limit, 0, resets_at, day)

    browser_hash = _hash(SCOPE_BROWSER, guest_id)
    ip_hash = _hash(SCOPE_IP, client_ip or "unknown")
    try:
        with _engine.connect() as conn:
            trans = conn.begin()
            used = _bump(conn, day, SCOPE_BROWSER, browser_hash, limit, now)
            if used is None:
                trans.rollback()
                return GuestQuota(False, SCOPE_BROWSER, limit, 0, resets_at, day)
            if _bump(conn, day, SCOPE_IP, ip_hash, ip_daily_limit(), now) is None:
                trans.rollback()
                return GuestQuota(False, SCOPE_IP, limit, 0, resets_at, day)
            trans.commit()
    except SQLAlchemyError:
        logger.warning("訪客試用額度寫入失敗，本次不放行", exc_info=True)
        return GuestQuota(False, "unavailable", limit, 0, resets_at, day)

    _maybe_purge(day)
    return GuestQuota(True, None, limit, max(limit - used, 0), resets_at, day, browser_hash, ip_hash)


def refund(quota: GuestQuota) -> None:
    """翻譯確定沒有呼叫付費 LLM 就失敗時（不支援的族語、缺金鑰等），把剛預留的額度還給使用者。
    LLM 可能已經計費的失敗不要呼叫這個函式。
    best-effort：退還失敗只記 log，寧可少還也不要讓請求回應出錯。"""
    if not quota.allowed or quota.day is None or _engine is None:
        return
    try:
        with _engine.begin() as conn:
            for scope, key_hash in ((SCOPE_BROWSER, quota.browser_hash), (SCOPE_IP, quota.ip_hash)):
                conn.execute(
                    update(_usage_table)
                    .where(
                        _usage_table.c.day == quota.day,
                        _usage_table.c.scope == scope,
                        _usage_table.c.key_hash == key_hash,
                        _usage_table.c.count > 0,
                    )
                    .values(count=_usage_table.c.count - 1)
                )
    except SQLAlchemyError:
        logger.warning("訪客試用額度退還失敗", exc_info=True)


def status(guest_id: str, now: datetime | None = None) -> GuestQuota:
    """查詢這個瀏覽器今天還剩幾次（不扣次數）。IP 保險上限不對外揭露，查詢時看不到它。"""
    now = now or datetime.now(timezone.utc)
    day = taipei_today(now)
    limit = browser_daily_limit()
    resets_at = next_reset_at(day)
    if not is_ready():
        return GuestQuota(False, "unavailable", limit, 0, resets_at, day)
    try:
        with _engine.connect() as conn:
            used = conn.execute(
                select(_usage_table.c.count).where(
                    _usage_table.c.day == day,
                    _usage_table.c.scope == SCOPE_BROWSER,
                    _usage_table.c.key_hash == _hash(SCOPE_BROWSER, guest_id),
                )
            ).scalar()
    except SQLAlchemyError:
        logger.warning("查詢訪客試用額度失敗", exc_info=True)
        return GuestQuota(False, "unavailable", limit, 0, resets_at, day)
    remaining = max(limit - (used or 0), 0)
    return GuestQuota(remaining > 0, None if remaining > 0 else SCOPE_BROWSER, limit, remaining, resets_at, day)


def purge_older_than(days: int = RETENTION_DAYS, now: datetime | None = None) -> int:
    """刪除超過保存天數的計次資料，回傳刪除筆數。管理指令與機會式清理共用。"""
    if _engine is None:
        return 0
    cutoff = taipei_today(now) - timedelta(days=days)
    with _engine.begin() as conn:
        return conn.execute(delete(_usage_table).where(_usage_table.c.day < cutoff)).rowcount or 0


def _maybe_purge(today: date) -> None:
    if random.random() >= _PURGE_PROBABILITY:
        return
    try:
        purge_older_than(now=datetime.combine(today, datetime.min.time(), tzinfo=_TAIPEI))
    except SQLAlchemyError:
        logger.warning("清理過期的訪客試用資料失敗", exc_info=True)
