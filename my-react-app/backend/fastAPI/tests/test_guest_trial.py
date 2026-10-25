"""訪客翻譯試用額度（fastAPI/guest_trial.py）。

用記憶體 SQLite 取代 Postgres：計次用的是標準的 INSERT ... ON CONFLICT DO UPDATE ... WHERE ...
RETURNING，SQLite 與 Postgres 語意相同。真正的多連線並行競爭只能在 Postgres 上驗證，這裡驗證的是
規則本身（上限、回滾、重置、雜湊、退還）。
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

from fastAPI import guest_trial as G

SECRET = "unit-test-secret-" + "abcdefghijklmnopqrstuvwxyz0123456789"
GUEST_A = "guest-aaaaaaaaaaaaaaaaaaaa"
GUEST_B = "guest-bbbbbbbbbbbbbbbbbbbb"
IP_1 = "203.0.113.7"
IP_2 = "203.0.113.8"
NOON = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)  # 台灣 12:00


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    G._metadata.create_all(engine)
    monkeypatch.setattr(G, "_engine", engine)
    monkeypatch.setenv("GUEST_TRIAL_SECRET", SECRET)
    monkeypatch.delenv("GUEST_TRIAL_DAILY_LIMIT", raising=False)
    monkeypatch.delenv("GUEST_TRIAL_IP_DAILY_LIMIT", raising=False)
    monkeypatch.setattr(G, "_PURGE_PROBABILITY", 0)
    return engine


def test_browser_limit_is_ten_per_day_then_blocked(db):
    results = [G.consume(GUEST_A, IP_1, NOON) for _ in range(10)]
    assert all(r.allowed for r in results)
    assert [r.remaining for r in results] == list(range(9, -1, -1))

    blocked = G.consume(GUEST_A, IP_1, NOON)
    assert not blocked.allowed and blocked.reason == "browser" and blocked.remaining == 0


def test_other_browser_on_same_ip_is_not_affected(db):
    for _ in range(10):
        G.consume(GUEST_A, IP_1, NOON)
    assert G.consume(GUEST_B, IP_1, NOON).allowed


def test_ip_cap_blocks_and_does_not_consume_browser_quota(db, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_DAILY_LIMIT", "3")
    for guest in ("guest-1111111111111111", "guest-2222222222222222", "guest-3333333333333333"):
        assert G.consume(guest, IP_1, NOON).allowed

    blocked = G.consume(GUEST_B, IP_1, NOON)
    assert not blocked.allowed and blocked.reason == "ip"
    # 被 IP 上限擋下的請求不能先把這個瀏覽器的次數扣掉
    assert G.status(GUEST_B, NOON).remaining == 10
    # 換一個 IP 就沒事
    assert G.consume(GUEST_B, IP_2, NOON).allowed


def test_counter_resets_at_taipei_midnight(db):
    for _ in range(10):
        G.consume(GUEST_A, IP_1, NOON)
    assert not G.consume(GUEST_A, IP_1, NOON).allowed

    just_before = datetime(2026, 10, 14, 15, 59, tzinfo=timezone.utc)  # 台灣 23:59
    assert not G.consume(GUEST_A, IP_1, just_before).allowed
    just_after = datetime(2026, 10, 14, 16, 0, tzinfo=timezone.utc)  # 台灣 00:00（隔天）
    fresh = G.consume(GUEST_A, IP_1, just_after)
    assert fresh.allowed and fresh.remaining == 9


def test_reset_time_is_next_taipei_midnight():
    assert G.next_reset_at(G.taipei_today(NOON)) == "2026-10-15T00:00:00+08:00"


def test_only_hashes_are_stored_never_plain_ip_or_guest_id(db):
    G.consume(GUEST_A, IP_1, NOON)
    with db.connect() as conn:
        rows = conn.execute(select(G._usage_table)).fetchall()
    assert {r.scope for r in rows} == {"browser", "ip"}
    for r in rows:
        assert len(r.key_hash) == 64
        assert IP_1 not in r.key_hash and GUEST_A not in r.key_hash
    assert len({r.key_hash for r in rows}) == 2


def test_hash_depends_on_secret(db, monkeypatch):
    G.consume(GUEST_A, IP_1, NOON)
    monkeypatch.setenv("GUEST_TRIAL_SECRET", "another-secret-" + "z" * 40)
    # 密鑰換了，雜湊對不上舊資料，視為新的瀏覽器（這也是密鑰不可隨意更換的原因）
    assert G.status(GUEST_A, NOON).remaining == 10


def test_missing_or_weak_secret_disables_guest_trial(db, monkeypatch):
    for bad in ("", "short", "a" * 40):
        monkeypatch.setenv("GUEST_TRIAL_SECRET", bad)
        assert not G.is_ready()
        result = G.consume(GUEST_A, IP_1, NOON)
        assert not result.allowed and result.reason == "unavailable"


def test_no_database_disables_guest_trial(monkeypatch):
    monkeypatch.setattr(G, "_engine", None)
    monkeypatch.setenv("GUEST_TRIAL_SECRET", SECRET)
    assert G.consume(GUEST_A, IP_1, NOON).reason == "unavailable"


def test_refund_returns_the_reserved_quota_and_never_goes_negative(db):
    quota = G.consume(GUEST_A, IP_1, NOON)
    assert G.status(GUEST_A, NOON).remaining == 9
    G.refund(quota)
    assert G.status(GUEST_A, NOON).remaining == 10
    G.refund(quota)
    G.refund(quota)
    assert G.status(GUEST_A, NOON).remaining == 10
    with db.connect() as conn:
        assert all(r.count >= 0 for r in conn.execute(select(G._usage_table)).fetchall())


def test_refund_of_denied_quota_is_a_noop(db):
    denied = G.GuestQuota(False, "browser", 10, 0, "x")
    G.refund(denied)


def test_status_does_not_consume(db):
    for _ in range(3):
        assert G.status(GUEST_A, NOON).remaining == 10
    G.consume(GUEST_A, IP_1, NOON)
    assert G.status(GUEST_A, NOON).remaining == 9


def test_limits_are_configurable_through_environment(db, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_DAILY_LIMIT", "2")
    assert G.consume(GUEST_A, IP_1, NOON).allowed
    assert G.consume(GUEST_A, IP_1, NOON).allowed
    assert not G.consume(GUEST_A, IP_1, NOON).allowed
    monkeypatch.setenv("GUEST_TRIAL_DAILY_LIMIT", "not-a-number")
    assert G.browser_daily_limit() == 10


def test_purge_removes_only_expired_rows(db):
    G.consume(GUEST_A, IP_1, NOON - timedelta(days=5))
    G.consume(GUEST_B, IP_2, NOON)
    deleted = G.purge_older_than(now=NOON)
    assert deleted == 2
    with db.connect() as conn:
        remaining = conn.execute(select(G._usage_table)).fetchall()
    assert len(remaining) == 2 and all(r.day == G.taipei_today(NOON) for r in remaining)


@pytest.mark.parametrize("value,ok", [
    ("a" * 16, True), ("550e8400-e29b-41d4-a716-446655440000", True), ("a" * 64, True),
    ("a" * 15, False), ("a" * 65, False), ("has space in it....", False), ("<script>" + "a" * 20, False),
    ("", False), (None, False),
])
def test_guest_id_format(value, ok):
    assert G.is_valid_guest_id(value) is ok


def test_core_table_id_is_bigint_like_the_django_migration():
    from sqlalchemy import BigInteger
    assert isinstance(G._usage_table.c.id.type, BigInteger)


# ---------------------------------------------------------------- 網路代號與全站上限（S-01）

def test_ipv6_addresses_in_the_same_slash_64_share_one_bucket(db, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_DAILY_LIMIT", "1")
    assert G.consume(GUEST_A, "2001:db8:1:2:aaaa:bbbb:cccc:dddd", NOON).allowed
    other = G.consume(GUEST_B, "2001:db8:1:2:1111:2222:3333:4444", NOON)  # 同一個 /64，只換了後 64 位元
    assert not other.allowed and other.reason == "ip"
    assert G.consume(GUEST_B, "2001:db8:1:3::1", NOON).allowed             # 不同的 /64 是另一個網路


def test_ipv4_mapped_ipv6_counts_as_the_ipv4_address(db, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_IP_DAILY_LIMIT", "1")
    assert G.consume(GUEST_A, "203.0.113.9", NOON).allowed
    assert not G.consume(GUEST_B, "::ffff:203.0.113.9", NOON).allowed


def test_global_limit_zero_means_off_not_default(monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "0")
    assert G.global_daily_limit() == 0
    monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "-5")
    assert G.global_daily_limit() == 0
    monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "abc")
    assert G.global_daily_limit() == 0
    monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "300")
    assert G.global_daily_limit() == 300


def test_global_limit_rolls_back_the_browser_and_ip_counts(db, monkeypatch):
    monkeypatch.setenv("GUEST_TRIAL_GLOBAL_DAILY_LIMIT", "1")
    assert G.consume(GUEST_A, IP_1, NOON).allowed
    blocked = G.consume(GUEST_B, IP_2, NOON)
    assert not blocked.allowed and blocked.reason == "global"
    assert G.status(GUEST_B, NOON).remaining == 10
    with db.connect() as conn:
        scopes = sorted(row.scope for row in conn.execute(select(G._usage_table)))
    assert scopes == ["browser", "global", "ip"]  # 第二位訪客沒有留下任何一列


def test_token_roundtrip_and_expiry_boundary(db):
    token = G._build_token("guest-roundtrip-0123456789", NOON)
    parsed = G.verify_token(token.token, NOON + timedelta(days=29))
    assert parsed is not None and parsed.guest_id == "guest-roundtrip-0123456789"
    assert G.verify_token(token.token, NOON + G.TOKEN_TTL - timedelta(seconds=1)) is not None
    assert G.verify_token(token.token, NOON + G.TOKEN_TTL) is None   # 到期那一秒就失效


def test_token_is_rejected_when_the_secret_is_not_ready(db, monkeypatch):
    token = G._build_token(GUEST_A, NOON).token
    monkeypatch.setenv("GUEST_TRIAL_SECRET", "")
    assert G.verify_token(token, NOON) is None


def test_issuing_does_not_write_one_row_per_token(db):
    for _ in range(5):
        assert G.issue_token(IP_1, NOON).ok
    with db.connect() as conn:
        rows = conn.execute(select(G._usage_table)).fetchall()
    assert len(rows) == 1 and rows[0].scope == "issue" and rows[0].count == 5


def test_token_secret_set_but_too_short_disables_guest_trial_instead_of_falling_back(db, monkeypatch):
    assert G.is_ready()
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET", "short")
    assert not G.is_ready()
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET", "")           # 空字串＝沒設定，回到衍生金鑰
    assert G.is_ready()
    monkeypatch.setenv("GUEST_TRIAL_TOKEN_SECRET_PREVIOUS", "short")
    assert not G.is_ready()
