"""訪客翻譯試用的額度控管（C-2）。

規則（使用者已定案）：
- 每個瀏覽器每日 10 次（所有族語合計），台灣時間午夜重置。瀏覽器身分是後端核發並簽章的訪客憑證
  （見下方「訪客憑證」）；憑證不是可靠的身分，清除瀏覽器資料就能再領一張，所以核發本身另有每網路每日上限。
- 另設「隱形的高 IP 保險上限」，暫定每日 1000 次，只擋明顯濫用，上線後依流量調整。IPv6 以 /64 為一個網路。
- 已登入使用者完全不經過這裡。
- 全站總量上限預設不啟用（原決定；最後防線是 translation_enabled 與 guest_translation_enabled 旗標，
  以及 LLM 供應商的預算警示）。要控制訪客翻譯的最高花費時，設 GUEST_TRIAL_GLOBAL_DAILY_LIMIT。
- 換 IP 的攻擊者（代理池）擋不住：這套機制只能提高成本，不是防止濫用的保證。

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
import ipaddress
import logging
import os
import random
import re
import secrets
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
SCOPE_GLOBAL = "global"   # 全站每日總量（選用，預設關閉）
SCOPE_ISSUE = "issue"     # 每個網路每日核發的訪客憑證張數
# usage 表的 scope 欄位只有 8 個字元，新增名稱不可超過。

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


def issue_daily_limit() -> int:
    """每個網路每天最多核發幾張新的訪客憑證。學校、公司共用同一個對外 IP 時，一整班的學生都從同一個 IP 領，
    所以不能設得太低；這個值只限制「新身分」的產生速度，真正的次數上限仍是上面兩個。"""
    return _int_env("GUEST_TRIAL_IP_ISSUE_DAILY_LIMIT", 50)


def global_daily_limit() -> int:
    """全站每天訪客翻譯的總次數上限。0 代表不啟用（維持「不設全站總量上限」的原決定）。
    不能用 _int_env：它把 0 與負數都換回預設值，會讓「0＝關閉」變成「用預設值」。"""
    try:
        value = int(os.getenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "0"))
    except ValueError:
        return 0
    return max(value, 0)


def _secret() -> str:
    return os.getenv("GUEST_TRIAL_SECRET", "")


_warned_short_secrets: set[str] = set()


def is_ready() -> bool:
    """資料庫與密鑰都就緒才開放訪客試用。"""
    if _engine is None:
        return False
    secret = _secret()
    if len(secret) < _MIN_SECRET_LENGTH or len(set(secret)) < 8:
        return False
    # 訪客憑證的簽章密鑰「有設定但太短」不能默默退回用 GUEST_TRIAL_SECRET 衍生：營運人員會以為已經換成獨立密鑰。
    # 直接視為未就緒（訪客試用停用），並記一次錯誤讓人看得到。完全沒設定才使用衍生的預設。
    for name in ("GUEST_TRIAL_TOKEN_SECRET", "GUEST_TRIAL_TOKEN_SECRET_PREVIOUS"):
        value = os.getenv(name, "")
        if value and len(value) < _MIN_SECRET_LENGTH:
            if name not in _warned_short_secrets:
                _warned_short_secrets.add(name)
                logger.error("%s 已設定但少於 %d 個字元，訪客試用停用；請改成夠長的值，或整個移除這個設定", name, _MIN_SECRET_LENGTH)
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


def _ip_key(client_ip: str | None) -> str:
    """計次用的網路代號。IPv6 一張網卡常拿到整段 /64，裝置還會定期換隱私位址，直接用完整位址計次，
    換一個位址就是新額度；所以 IPv6 以 /64 前綴為單位。IPv4 對映的 IPv6 位址還原成 IPv4。
    解析不出來的字串原樣使用（只會讓它自成一個計次單位）。"""
    if not client_ip:
        return "unknown"
    try:
        address = ipaddress.ip_address(client_ip)
    except ValueError:
        return client_ip
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


# ---------------------------------------------------------------- 訪客憑證
#
# 憑證由伺服器核發並簽章：g1.<訪客代號>.<到期的 unix 秒>.<簽章前 32 個 hex 字元>。
# 前端不能再自己產生代號——自造的字串驗不過簽章。這是「受控核發的匿名憑證」，不是可靠的每瀏覽器身分：
# 清除瀏覽器資料或換瀏覽器都能再領一張，所以核發本身另有每網路每日上限，最終還是靠 IP 與（選用的）全站上限。
# 簽章金鑰與計次用的雜湊金鑰分開：輪替簽章金鑰只會讓舊憑證失效，不會讓當天所有人的額度重置。
TOKEN_VERSION = "g1"
TOKEN_TTL = timedelta(days=30)
_MAX_TOKEN_LENGTH = 160
_TOKEN_SIG_LENGTH = 32
_TOKEN_SIG_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_TOKEN_EXP_PATTERN = re.compile(r"^[0-9]{1,12}$")


@dataclass
class GuestToken:
    ok: bool
    token: str = ""
    expires_at: str = ""
    # 失敗原因：issue_cap（這個網路今天領太多張）、unavailable（服務暫時無法使用）
    reason: str | None = None


@dataclass
class ParsedToken:
    guest_id: str
    expires_at: int


def _signing_keys() -> list[bytes]:
    """目前使用的簽章金鑰在前，驗證時才依序嘗試；GUEST_TRIAL_TOKEN_SECRET_PREVIOUS 只用來驗證舊憑證。
    沒有另外設定 GUEST_TRIAL_TOKEN_SECRET 時，由 GUEST_TRIAL_SECRET 以固定標籤衍生，與計次用的雜湊分開。"""
    keys: list[bytes] = []
    current = os.getenv("GUEST_TRIAL_TOKEN_SECRET", "")
    if len(current) >= _MIN_SECRET_LENGTH:
        keys.append(hmac.new(current.encode("utf-8"), b"guest-token-signing", hashlib.sha256).digest())
    else:
        keys.append(hmac.new(_secret().encode("utf-8"), b"guest-token-signing", hashlib.sha256).digest())
    previous = os.getenv("GUEST_TRIAL_TOKEN_SECRET_PREVIOUS", "")
    if len(previous) >= _MIN_SECRET_LENGTH:
        keys.append(hmac.new(previous.encode("utf-8"), b"guest-token-signing", hashlib.sha256).digest())
    return keys


def _sign(key: bytes, payload: str) -> str:
    return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()[:_TOKEN_SIG_LENGTH]


def _build_token(guest_id: str, now: datetime) -> GuestToken:
    expires = now + TOKEN_TTL
    payload = f"{TOKEN_VERSION}.{guest_id}.{int(expires.timestamp())}"
    return GuestToken(True, f"{payload}.{_sign(_signing_keys()[0], payload)}", expires.isoformat())


def verify_token(token: str | None, now: datetime | None = None) -> ParsedToken | None:
    """驗證格式、簽章與到期；任何一項不符回 None。簽章用 compare_digest 比對。"""
    if not token or len(token) > _MAX_TOKEN_LENGTH or not is_ready():
        return None
    parts = token.split(".")
    if len(parts) != 4:
        return None
    version, guest_id, exp, signature = parts
    if version != TOKEN_VERSION or not is_valid_guest_id(guest_id):
        return None
    if not _TOKEN_EXP_PATTERN.match(exp) or not _TOKEN_SIG_PATTERN.match(signature):
        return None
    payload = f"{version}.{guest_id}.{exp}"
    if not any(hmac.compare_digest(signature, _sign(key, payload)) for key in _signing_keys()):
        return None
    now = now or datetime.now(timezone.utc)
    if int(exp) <= int(now.timestamp()):
        return None
    return ParsedToken(guest_id, int(exp))


def issue_token(client_ip: str, now: datetime | None = None, renew: ParsedToken | None = None) -> GuestToken:
    """核發訪客憑證。renew 是一張仍有效的舊憑證時，沿用同一個訪客代號重簽、不計入核發次數
    （否則快到期就換新代號，等於當天額度重置）。全新核發才會扣這個網路今天的核發額度。
    核發不為每一張憑證寫一列資料：憑證本身是無狀態的，只多一列「這個網路今天領了幾張」。"""
    now = now or datetime.now(timezone.utc)
    if not is_ready():
        return GuestToken(False, reason="unavailable")
    if renew is not None:
        return _build_token(renew.guest_id, now)

    day = taipei_today(now)
    try:
        with _engine.begin() as conn:
            issued = _bump(conn, day, SCOPE_ISSUE, _hash(SCOPE_ISSUE, _ip_key(client_ip)), issue_daily_limit(), now)
    except SQLAlchemyError:
        logger.warning("訪客憑證核發額度寫入失敗，本次不核發", exc_info=True)
        return GuestToken(False, reason="unavailable")
    if issued is None:
        return GuestToken(False, reason="issue_cap")

    _maybe_purge(day)
    return _build_token(secrets.token_urlsafe(16), now)


@dataclass
class GuestQuota:
    allowed: bool
    # 不允許時的原因：browser（這個瀏覽器今天用完）、ip（這個網路今天用完）、global（全站今天的名額用完）、
    # unavailable（服務暫時無法使用）
    reason: str | None
    limit: int
    remaining: int
    resets_at: str
    day: date | None = None
    # 每一筆預留實際扣到的雜湊鍵，退還時用同一組，不必再重算
    browser_hash: str = ""
    ip_hash: str = ""
    global_hash: str = ""   # 沒有啟用全站上限時是空字串


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
    ip_hash = _hash(SCOPE_IP, _ip_key(client_ip))
    global_limit = global_daily_limit()
    global_hash = _hash(SCOPE_GLOBAL, "all") if global_limit > 0 else ""
    try:
        with _engine.connect() as conn:
            trans = conn.begin()
            # 固定的鎖定順序：瀏覽器 → 網路 → 全站，任一筆超限就整筆回滾
            used = _bump(conn, day, SCOPE_BROWSER, browser_hash, limit, now)
            if used is None:
                trans.rollback()
                return GuestQuota(False, SCOPE_BROWSER, limit, 0, resets_at, day)
            if _bump(conn, day, SCOPE_IP, ip_hash, ip_daily_limit(), now) is None:
                trans.rollback()
                return GuestQuota(False, SCOPE_IP, limit, 0, resets_at, day)
            if global_hash and _bump(conn, day, SCOPE_GLOBAL, global_hash, global_limit, now) is None:
                trans.rollback()
                return GuestQuota(False, SCOPE_GLOBAL, limit, 0, resets_at, day)
            trans.commit()
    except SQLAlchemyError:
        logger.warning("訪客試用額度寫入失敗，本次不放行", exc_info=True)
        return GuestQuota(False, "unavailable", limit, 0, resets_at, day)

    _maybe_purge(day)
    return GuestQuota(True, None, limit, max(limit - used, 0), resets_at, day, browser_hash, ip_hash, global_hash)


def refund(quota: GuestQuota) -> None:
    """翻譯確定沒有呼叫付費 LLM 就失敗時（不支援的族語、缺金鑰等），把剛預留的額度還給使用者。
    LLM 可能已經計費的失敗不要呼叫這個函式。
    best-effort：退還失敗只記 log，寧可少還也不要讓請求回應出錯。"""
    if not quota.allowed or quota.day is None or _engine is None:
        return
    try:
        with _engine.begin() as conn:
            scopes = [(SCOPE_BROWSER, quota.browser_hash), (SCOPE_IP, quota.ip_hash)]
            if quota.global_hash:
                scopes.append((SCOPE_GLOBAL, quota.global_hash))
            for scope, key_hash in scopes:
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
