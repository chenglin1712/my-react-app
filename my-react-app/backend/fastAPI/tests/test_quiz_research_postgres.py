"""研究事件在【真正的 PostgreSQL】上的鎖與型別行為：撤回與事件寫入同時發生時，撤回之後不會有事件殘留。

SQLite 沒有列鎖，test_quiz_research.py 只能驗證送出的語句帶有 SELECT … FOR UPDATE；這個檔案才驗證鎖真的有效。
沒設定 QUIZ_TEST_POSTGRES_URL 就整個略過。**注意：開發環境沒有 PostgreSQL，這個檔案尚未實際執行過**，
打開 quiz_rule_event_logging 旗標之前必須先跑過一次。

執行方式（用【測試專用、可以隨意清空】的資料庫，絕對不要指向正式或共用資料庫）：

    # 1) 對測試資料庫建立 Django 管理的資料表
    DATABASE_URL=postgresql://user:pw@localhost/quiz_test python backend/manage.py migrate
    # 2) 跑這個測試
    QUIZ_TEST_POSTGRES_URL=postgresql://user:pw@localhost/quiz_test QUIZ_RESEARCH_SALT=<至少 32 字元> \
        python -m pytest backend/fastAPI/tests/test_quiz_research_postgres.py -q

測試會清空 adminapi_quizresearchconsent 與 adminapi_quizskillevent 兩張表。
"""
import os
import threading
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, delete, func, select, text, update

from fastAPI.routes.quiz import research_events as E
from fastAPI.tests.test_quiz_research import UID, _event

URL = os.getenv("QUIZ_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not URL, reason="需要 QUIZ_TEST_POSTGRES_URL（測試專用的 PostgreSQL）")


def _looks_like_a_scratch_database(url: str) -> bool:
    """這個測試會清空兩張表，所以只接受資料庫名稱含 test／scratch 的 URL，避免誤指到正式或共用資料庫。"""
    name = (url or "").rsplit("/", 1)[-1].split("?", 1)[0].lower()
    return url.startswith("postgres") and ("test" in name or "scratch" in name)


def _joined(*threads, timeout=15):
    for t in threads:
        t.join(timeout)
        assert not t.is_alive(), "執行緒沒有在時限內結束（可能死鎖或鎖沒釋放）"


@pytest.fixture
def pg(monkeypatch):
    if not _looks_like_a_scratch_database(URL):
        pytest.fail("QUIZ_TEST_POSTGRES_URL 的資料庫名稱必須含 test 或 scratch（這個測試會清空兩張表）")
    engine = create_engine(URL)
    monkeypatch.setattr(E, "_engine", engine)
    with engine.begin() as conn:
        conn.execute(delete(E._events))
        conn.execute(delete(E._consent))
    yield engine
    engine.dispose()


def _count(engine):
    with engine.connect() as conn:
        return conn.execute(select(func.count()).select_from(E._events)).scalar()


def test_a_normal_event_round_trips_and_ids_are_bigint(pg):
    E.set_consent(UID, True)
    assert E.record_skill_event(UID, _event("pg1")) is True
    assert _count(pg) == 1
    with pg.connect() as conn:
        rows = conn.execute(text(
            "SELECT table_name, data_type FROM information_schema.columns WHERE column_name = 'id' "
            "AND table_name IN ('adminapi_quizskillevent', 'adminapi_quizresearchconsent')")).all()
    assert len(rows) == 2 and {data_type for _, data_type in rows} == {"bigint"}     # 跟 Django 的 BigAutoField 一致


def test_a_revoke_in_progress_blocks_a_concurrent_event_and_nothing_survives(pg):
    E.set_consent(UID, True)
    pseud = E.pseudonym_for(UID)
    started, proceed = threading.Event(), threading.Event()

    def revoker():
        with pg.begin() as conn:
            conn.execute(update(E._consent).where(E._consent.c.pseudonym == pseud).values(revoked_at=datetime.now(timezone.utc)))
            conn.execute(delete(E._events).where(E._events.c.pseudonym == pseud))
            started.set()
            proceed.wait(10)                        # 撤回的交易還沒 commit，同意列被鎖住

    thread = threading.Thread(target=revoker)
    thread.start()
    assert started.wait(5)
    result = []
    writer = threading.Thread(target=lambda: result.append(E.record_skill_event(UID, _event("race"))))
    writer.start()
    time.sleep(0.5)
    assert result == []                             # 事件寫入被 FOR UPDATE 擋住，還在等
    proceed.set()
    _joined(thread, writer)
    assert result == [False]                        # 撤回 commit 後重新檢查：已撤回，不寫入
    assert _count(pg) == 0


def test_a_concurrent_event_started_before_the_revoke_is_deleted_by_it(pg):
    E.set_consent(UID, True)
    pseud = E.pseudonym_for(UID)
    inserted, proceed = threading.Event(), threading.Event()

    def writer():
        with pg.begin() as conn:
            row = conn.execute(select(E._consent.c.revoked_at).where(E._consent.c.pseudonym == pseud).with_for_update()).first()
            assert row.revoked_at is None
            conn.execute(E._events.insert().values(
                pseudonym=pseud, occurred_at=datetime.now(timezone.utc), consent_version=E.QR.CONSENT_VERSION, **_event("early")))
            inserted.set()
            proceed.wait(10)                        # 寫入的交易還沒 commit，同意列被鎖住

    thread = threading.Thread(target=writer)
    thread.start()
    assert inserted.wait(5)
    revoked = []
    revoker = threading.Thread(target=lambda: revoked.append(E.set_consent(UID, False)))
    revoker.start()
    time.sleep(0.5)
    assert revoked == []                            # 撤回的 UPDATE 在等寫入交易放掉鎖
    proceed.set()
    _joined(thread, revoker)
    assert revoked and revoked[0]["granted"] is False
    assert _count(pg) == 0                          # 撤回在寫入之後執行，刪掉了那筆事件


def test_an_event_waiting_on_a_grant_sees_the_new_consent_and_is_recorded(pg):
    E.set_consent(UID, True)
    E.set_consent(UID, False)                       # 先撤回，之後再同意
    pseud = E.pseudonym_for(UID)
    started, proceed = threading.Event(), threading.Event()

    def regrant():
        with pg.begin() as conn:
            conn.execute(update(E._consent).where(E._consent.c.pseudonym == pseud).values(
                revoked_at=None, consent_version=E.QR.CONSENT_VERSION, granted_at=datetime.now(timezone.utc)))
            started.set()
            proceed.wait(10)

    thread = threading.Thread(target=regrant)
    thread.start()
    assert started.wait(5)
    result = []
    writer = threading.Thread(target=lambda: result.append(E.record_skill_event(UID, _event("after-grant"))))
    writer.start()
    time.sleep(0.5)
    assert result == []                             # 等重新同意的交易 commit
    proceed.set()
    _joined(thread, writer)
    assert result == [True] and _count(pg) == 1


def test_without_any_consent_row_nothing_is_recorded_and_nothing_blocks(pg):
    assert E.record_skill_event(UID, _event("none")) is False
    assert _count(pg) == 0


def test_the_connection_uses_read_committed(pg):
    with pg.connect() as conn:
        assert conn.execute(text("SHOW transaction_isolation")).scalar() == "read committed"   # 上面的鎖語意以此為前提


def test_duplicate_nonce_is_rejected_by_the_unique_constraint(pg):
    E.set_consent(UID, True)
    assert E.record_skill_event(UID, _event("dup")) is True
    assert E.record_skill_event(UID, _event("dup")) is False
    assert _count(pg) == 1
