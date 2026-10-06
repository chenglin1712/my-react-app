"""詞素學習的研究事件（routes/quiz/research_events.py、config/quiz_research.py）與同意／摘要端點。

用記憶體內 SQLite 跑真正的 SQLAlchemy Core 讀寫（不是 mock），驗證：
- 預設不記錄：沒設定鹽、沒資料庫、沒同意、同意版本過期都不寫；
- 事件只存假名，不存 uid、詞形、句子；時間只到整點；
- 同一題（nonce）重送只記一次；
- 撤回同意會刪除該假名的全部事件，再同意可以重新記錄；
- 任何資料庫錯誤都不丟例外（記錄）、也不假裝同意成功（同意端點回 503）。
"""
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, insert, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool

from config import quiz_research as QR
from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.quiz import flags
from fastAPI.routes.quiz import research_events as E
from fastAPI.routes.quiz import rule_state_store

SALT = "unit-test-salt-0123456789-abcdefghijklmnopqrstuvwxyz"
UID = "alice-uid"


@pytest.fixture
def engine(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    E._metadata.create_all(eng)
    monkeypatch.setattr(E, "_engine", eng)
    monkeypatch.setenv(QR.SALT_ENV, SALT)
    return eng


def _event(nonce="n1", **overrides):
    event = {"nonce": nonce, "tribe": "amis", "question_type": "sentence-fill", "target_rule_id": "v1|amis|P|ma||0",
             "selected_rule_id": "", "diagnosis_status": "correct", "error_type": "", "correct": True, "probe": True,
             "seconds_bucket": 1, "p_before": 0.35, "p_after": 0.6, "pred_skill": 0.4, "pred_ability": 0.55,
             "ability_before": 0.5, "model_version": "bkt-blend-1", "kit_version": "kv1", "selection_policy": "baseline"}
    event.update(overrides)
    return event


def _rows(engine, table):
    with engine.connect() as conn:
        return conn.execute(select(table)).mappings().all()


class TestQuizResearchHelpers:
    def test_pseudonym_is_deterministic_and_does_not_contain_the_uid(self):
        a = QR.pseudonym("alice", SALT)
        assert a == QR.pseudonym("alice", SALT) and len(a) == 32 and "alice" not in a
        assert all(c in "0123456789abcdef" for c in a)

    def test_different_users_and_different_salts_give_different_pseudonyms(self):
        assert QR.pseudonym("alice", SALT) != QR.pseudonym("bob", SALT)
        assert QR.pseudonym("alice", SALT) != QR.pseudonym("alice", SALT + "x")

    @pytest.mark.parametrize("uid,salt", [("", SALT), ("alice", None), ("alice", ""), ("alice", "short")])
    def test_missing_uid_or_weak_salt_gives_no_pseudonym(self, uid, salt, monkeypatch):
        monkeypatch.delenv(QR.SALT_ENV, raising=False)
        assert QR.pseudonym(uid, salt) is None

    @pytest.mark.parametrize("weak", ["a" * 40, "ab" * 20, "abcdefghi" + "a" * 30, "x" * 31, "abcdefghij" + "a" * 21])
    def test_weak_salts_are_refused(self, weak, monkeypatch):
        assert QR.pseudonym("alice", weak) is None
        monkeypatch.setenv(QR.SALT_ENV, weak)
        assert QR.salt() is None and QR.pseudonym("alice") is None

    def test_salt_policy_boundary(self):
        assert QR.pseudonym("alice", "abcdefghij" + "a" * 22) is not None            # 剛好 32 字元、10 種字元

    def test_salt_comes_from_the_environment_and_must_be_long_enough(self, monkeypatch):
        monkeypatch.setenv(QR.SALT_ENV, "short")
        assert QR.salt() is None and QR.pseudonym("alice") is None
        monkeypatch.setenv(QR.SALT_ENV, SALT)
        assert QR.salt() == SALT and QR.pseudonym("alice") == QR.pseudonym("alice", SALT)

    @pytest.mark.parametrize("seconds,bucket", [(0, 0), (2.99, 0), (3, 1), (5.9, 1), (6, 2), (9.9, 2), (10, 3),
                                                (19.9, 3), (20, 4), (39.9, 4), (40, 5), (9999, 5)])
    def test_seconds_buckets(self, seconds, bucket):
        assert QR.seconds_bucket(seconds) == bucket

    @pytest.mark.parametrize("bad", [None, "x", -5, float("nan")])
    def test_garbage_seconds_fall_in_the_first_bucket(self, bad):
        assert QR.seconds_bucket(bad) == 0

    def test_hour_bucket(self):
        moment = datetime(2026, 10, 6, 13, 47, 59, 123456, tzinfo=timezone.utc)
        assert QR.hour_bucket(moment) == datetime(2026, 10, 6, 13, 0, 0, tzinfo=timezone.utc)


class TestAvailability:
    def test_unavailable_without_database(self, monkeypatch):
        monkeypatch.setattr(E, "_engine", None)
        monkeypatch.setenv(QR.SALT_ENV, SALT)
        assert E.available() is False and E.pseudonym_for(UID) is None
        assert E.consent_state(UID) == {"available": False, "granted": False, "version": QR.CONSENT_VERSION}
        assert E.record_skill_event(UID, _event()) is False
        with pytest.raises(E.ResearchUnavailable):
            E.set_consent(UID, True)

    def test_unavailable_without_salt(self, engine, monkeypatch):
        monkeypatch.delenv(QR.SALT_ENV)
        assert E.available() is False
        assert E.consent_state(UID)["available"] is False
        with pytest.raises(E.ResearchUnavailable):
            E.set_consent(UID, True)
        assert E.record_skill_event(UID, _event()) is False

    def test_available_with_database_and_salt(self, engine):
        assert E.available() is True and E.consent_state(UID) == {"available": True, "granted": False, "version": QR.CONSENT_VERSION}

    def test_anonymous_user_is_unavailable(self, engine):
        assert E.consent_state("")["available"] is False


class TestConsent:
    def test_grant_then_state(self, engine):
        state = E.set_consent(UID, True)
        assert state["granted"] is True and state["available"] is True
        (row,) = _rows(engine, E._consent)
        assert row["pseudonym"] == E.pseudonym_for(UID) and row["consent_version"] == QR.CONSENT_VERSION
        assert row["revoked_at"] is None and UID not in str(dict(row))

    def test_granting_twice_keeps_one_row(self, engine):
        E.set_consent(UID, True)
        E.set_consent(UID, True)
        assert len(_rows(engine, E._consent)) == 1

    def test_revoke_marks_the_row_and_deletes_the_events(self, engine):
        E.set_consent(UID, True)
        assert E.record_skill_event(UID, _event("n1")) and E.record_skill_event(UID, _event("n2"))
        other = "bob-uid"
        E.set_consent(other, True)
        E.record_skill_event(other, _event("n3"))
        state = E.set_consent(UID, False)
        assert state["granted"] is False
        events = _rows(engine, E._events)
        assert [e["pseudonym"] for e in events] == [E.pseudonym_for(other)]          # 只刪這個人的
        mine = next(r for r in _rows(engine, E._consent) if r["pseudonym"] == E.pseudonym_for(UID))
        assert mine["revoked_at"] is not None                                        # 紀錄保留，證明曾同意與撤回時間

    def test_regrant_after_revoke_works_and_clears_revocation(self, engine):
        E.set_consent(UID, True)
        E.set_consent(UID, False)
        assert E.set_consent(UID, True)["granted"] is True
        assert E.record_skill_event(UID, _event("n9")) is True
        assert _rows(engine, E._consent)[0]["revoked_at"] is None

    def test_revoking_without_ever_consenting_is_a_harmless_noop(self, engine):
        assert E.set_consent(UID, False)["granted"] is False
        assert _rows(engine, E._consent) == []

    def test_an_outdated_consent_version_does_not_count(self, engine):
        E.set_consent(UID, True)
        with engine.begin() as conn:
            conn.execute(E._consent.update().values(consent_version="2020-old"))
        assert E.consent_state(UID)["granted"] is False
        assert E.record_skill_event(UID, _event()) is False

    def test_lookup_failure_means_no_consent(self, engine):
        E.set_consent(UID, True)
        with patch.object(E, "_engine") as broken:
            broken.connect.side_effect = OperationalError("x", {}, Exception("db down"))
            assert E.has_consent(E.pseudonym_for(UID)) is False
            assert E.consent_state(UID)["granted"] is False

    def test_database_error_on_update_is_reported_not_swallowed(self, engine):
        with patch.object(E, "_engine") as broken:
            broken.begin.side_effect = OperationalError("x", {}, Exception("db down"))
            with pytest.raises(E.ResearchUnavailable):
                E.set_consent(UID, True)

    def test_a_concurrent_first_grant_falls_back_to_update(self, engine):
        # 兩個請求同時第一次同意：第二個的 INSERT 撞到唯一鍵，要改走更新而不是失敗
        pseud = E.pseudonym_for(UID)
        real_update = E.update
        calls = {"n": 0}

        def racing_update(*args, **kwargs):
            stmt = real_update(*args, **kwargs)
            calls["n"] += 1
            if calls["n"] == 1:                              # 第一次 UPDATE 前，另一個請求剛好已插入
                with engine.begin() as other:
                    other.execute(insert(E._consent).values(
                        pseudonym=pseud, consent_version="2020-old", granted_at=datetime.now(timezone.utc)))
            return stmt
        with patch.object(E, "update", racing_update):
            state = E.set_consent(UID, True)
        assert state["granted"] is True and len(_rows(engine, E._consent)) == 1


class TestRecordEvent:
    def test_without_consent_nothing_is_written(self, engine):
        assert E.record_skill_event(UID, _event()) is False
        assert _rows(engine, E._events) == []

    def test_event_stores_only_pseudonymous_minimal_data(self, engine):
        E.set_consent(UID, True)
        assert E.record_skill_event(UID, _event()) is True
        (row,) = _rows(engine, E._events)
        assert row["pseudonym"] == E.pseudonym_for(UID)
        assert row["consent_version"] == QR.CONSENT_VERSION
        flat = " ".join(str(v) for v in dict(row).values())
        assert UID not in flat
        occurred = row["occurred_at"]
        assert (occurred.minute, occurred.second, occurred.microsecond) == (0, 0, 0)
        assert row["pred_skill"] == 0.4 and row["target_rule_id"] == "v1|amis|P|ma||0" and row["correct"] is True

    def test_the_same_question_is_recorded_once(self, engine):
        E.set_consent(UID, True)
        assert E.record_skill_event(UID, _event("same")) is True
        assert E.record_skill_event(UID, _event("same")) is False
        assert len(_rows(engine, E._events)) == 1

    def test_the_same_nonce_from_different_users_is_independent(self, engine):
        for uid in ("alice", "bob"):
            E.set_consent(uid, True)
            assert E.record_skill_event(uid, _event("same")) is True
        assert len(_rows(engine, E._events)) == 2

    def test_events_after_revocation_are_not_recorded(self, engine):
        E.set_consent(UID, True)
        E.set_consent(UID, False)
        assert E.record_skill_event(UID, _event()) is False and _rows(engine, E._events) == []

    def test_unknown_or_missing_fields_are_rejected(self, engine):
        E.set_consent(UID, True)
        assert E.record_skill_event(UID, _event(uid="leak")) is False                 # 不允許帶 uid 之類的欄位
        assert E.record_skill_event(UID, _event(pseudonym="forged")) is False         # 假名只能由這個模組填
        incomplete = _event()
        del incomplete["tribe"]
        assert E.record_skill_event(UID, incomplete) is False
        assert _rows(engine, E._events) == []

    def test_a_rejected_event_is_logged_as_a_programming_error(self, engine):
        E.set_consent(UID, True)
        with patch.object(E, "logger") as log:
            assert E.record_skill_event(UID, _event(uid="leak")) is False
        assert log.error.called and "wrong fields" in log.error.call_args.args[0]

    def test_nullable_prediction_fields_may_be_absent(self, engine):
        E.set_consent(UID, True)
        minimal = {k: v for k, v in _event().items() if k not in ("p_before", "p_after", "pred_skill", "pred_ability", "ability_before")}
        assert E.record_skill_event(UID, minimal) is True
        assert _rows(engine, E._events)[0]["pred_skill"] is None

    def test_database_failure_is_swallowed(self, engine):
        E.set_consent(UID, True)
        with patch.object(E, "_engine") as broken:
            broken.connect.return_value.__enter__.return_value.execute.side_effect = OperationalError("x", {}, Exception("down"))
            broken.begin.side_effect = OperationalError("x", {}, Exception("down"))
            assert E.record_skill_event(UID, _event()) is False

    def test_row_count_matches_successful_calls(self, engine):
        E.set_consent(UID, True)
        results = [E.record_skill_event(UID, _event(f"n{i % 3}")) for i in range(7)]
        assert results.count(True) == 3
        with engine.connect() as conn:
            assert conn.execute(select(func.count()).select_from(E._events)).scalar() == 3


@pytest.fixture
def client():
    def _fake_db():
        yield None

    async def _fake_auth():
        return {"uid": UID}

    app.dependency_overrides[get_db] = _fake_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _flags(**on):
    return patch.object(flags.feature_flags, "is_enabled", side_effect=lambda key, default=True: on.get(key, False))


class TestConsentEndpoints:
    def test_get_reports_state_and_whether_the_feature_is_open(self, client, engine):
        with _flags(**{flags.DIAGNOSIS: True, flags.EVENTS: True}):
            body = client.get("/api/v1/quiz/research_consent").json()
        assert body == {"available": True, "granted": False, "version": QR.CONSENT_VERSION, "enabled": True}
        with _flags():
            assert client.get("/api/v1/quiz/research_consent").json()["enabled"] is False

    def test_put_grants_and_revokes(self, client, engine):
        with _flags(**{flags.DIAGNOSIS: True, flags.EVENTS: True}):
            assert client.put("/api/v1/quiz/research_consent", json={"granted": True}).json()["granted"] is True
            E.record_skill_event(UID, _event())
            assert client.put("/api/v1/quiz/research_consent", json={"granted": False}).json()["granted"] is False
        assert _rows(engine, E._events) == []

    def test_put_is_503_when_logging_is_not_configured(self, client, monkeypatch):
        monkeypatch.setattr(E, "_engine", None)
        resp = client.put("/api/v1/quiz/research_consent", json={"granted": True})
        assert resp.status_code == 503 and "無法使用" in resp.json()["detail"]

    def test_put_rejects_a_non_boolean(self, client, engine):
        assert client.put("/api/v1/quiz/research_consent", json={"granted": "yes please"}).status_code == 422
        assert client.put("/api/v1/quiz/research_consent", json={}).status_code == 422

    def test_get_when_unconfigured_is_a_clean_unavailable(self, client, monkeypatch):
        monkeypatch.setattr(E, "_engine", None)
        assert client.get("/api/v1/quiz/research_consent").json()["available"] is False


class TestRuleSummaryEndpoint:
    def _store(self):
        store = rule_state_store.MemoryStore()
        rule = "v1|amis|P|ma||0"
        for i in range(6):
            store.apply(UID, "amis", f"n{i}", lambda st, c=(i == 0): __import__("config.rule_skill_model", fromlist=["x"]).apply_observation(st.skills, rule, c))
        rule_state_store.set_store_for_tests(store)
        return store

    def test_summary_lists_weak_rules_when_the_flag_is_on(self, client):
        self._store()
        try:
            with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True}):
                body = client.get("/api/v1/quiz/rule_summary?tribe=amis").json()
        finally:
            rule_state_store.set_store_for_tests(None)
        assert body["available"] is True and body["observedRules"] == 1
        assert body["weakest"][0]["label"] == "ma-" and body["weakest"][0]["n"] == 6

    def test_flag_off_is_unavailable(self, client):
        self._store()
        try:
            with _flags():
                assert client.get("/api/v1/quiz/rule_summary?tribe=amis").json() == {"available": False}
        finally:
            rule_state_store.set_store_for_tests(None)

    def test_no_store_is_unavailable(self, client):
        with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True}), \
             patch.object(rule_state_store, "get_store", return_value=None):
            assert client.get("/api/v1/quiz/rule_summary?tribe=amis").json() == {"available": False}

    def test_store_failure_is_unavailable_not_a_500(self, client):
        class Broken:
            def load(self, uid, tribe):
                raise rule_state_store.StoreError("down")
        rule_state_store.set_store_for_tests(Broken())
        try:
            with _flags(**{flags.DIAGNOSIS: True, flags.SKILL_UPDATE: True}):
                resp = client.get("/api/v1/quiz/rule_summary?tribe=amis")
        finally:
            rule_state_store.set_store_for_tests(None)
        assert resp.status_code == 200 and resp.json() == {"available": False}

    def test_unknown_tribe_is_a_400(self, client):
        assert client.get("/api/v1/quiz/rule_summary?tribe=klingon").status_code == 400


class TestConsentLockingAndSchema:
    def test_the_event_insert_locks_the_consent_row_and_rechecks_consent_in_the_same_transaction(self, engine):
        # SQLite 沒有列鎖，這裡只能驗證送出的語句：同意檢查必須是 SELECT … FOR UPDATE，
        # 而且跟 INSERT 在同一個連線（同一個交易）裡。真正的鎖行為要在 Postgres 驗證。
        from sqlalchemy.dialects import postgresql
        E.set_consent(UID, True)
        statements = []
        real_begin = E._engine.begin

        class SpyConn:
            def __init__(self, conn):
                self.conn = conn

            def execute(self, stmt, *a, **k):
                statements.append((id(self.conn), stmt))
                return self.conn.execute(stmt, *a, **k)

        class Ctx:
            def __enter__(self):
                self.cm = real_begin()
                return SpyConn(self.cm.__enter__())

            def __exit__(self, *exc):
                return self.cm.__exit__(*exc)

        with patch.object(E._engine, "begin", lambda: Ctx()):
            assert E.record_skill_event(UID, _event("lock1")) is True
        kinds = [str(stmt.compile(dialect=postgresql.dialect())) for _, stmt in statements]
        assert "FOR UPDATE" in kinds[0] and kinds[0].startswith("SELECT") and "adminapi_quizresearchconsent" in kinds[0]
        assert kinds[1].startswith("INSERT INTO adminapi_quizskillevent")
        assert len({conn for conn, _ in statements}) == 1

    def test_a_revoked_consent_seen_inside_the_insert_transaction_blocks_the_write(self, engine):
        E.set_consent(UID, True)
        with engine.begin() as conn:
            conn.execute(E._consent.update().values(revoked_at=datetime.now(timezone.utc)))
        assert E.record_skill_event(UID, _event("late")) is False
        assert _rows(engine, E._events) == []

    def test_id_columns_are_bigint_on_postgres_like_the_django_models(self):
        from sqlalchemy import BigInteger
        from sqlalchemy.dialects import postgresql, sqlite
        for table in (E._consent, E._events):
            column = table.c.id
            assert isinstance(column.type.dialect_impl(postgresql.dialect()), type(BigInteger().dialect_impl(postgresql.dialect())))
            assert column.type.compile(dialect=postgresql.dialect()) == "BIGINT"
            assert column.type.compile(dialect=sqlite.dialect()) == "INTEGER"       # SQLite 才會自動編號
