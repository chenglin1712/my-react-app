"""routes/quiz/rule_state_store.py：伺服器持有的規則熟練度狀態。

MemoryStore 與 FirestoreStore 共用同一套交易內邏輯（_apply_to_state），所以這裡用 MemoryStore 完整驗證
語意（nonce 去重、原子更新、毀損資料容錯、使用者與族語隔離）；FirestoreStore 另外用一個最小的假 client
驗證它確實走「交易內讀取 → 套用 → 寫回」，真正的 Firestore 交易行為見 test_rule_state_store_firestore.py
（需要 Firestore emulator，沒有就略過）。
"""
import threading

import pytest

from config import rule_skill_model as R
from fastAPI.routes.quiz import rule_state_store as S

A = R.rule_id("amis", "P", "pa")
B = R.rule_id("amis", "P", "ma")


def _bump(rid, correct=True):
    def mutate(state):
        before, after = R.apply_observation(state.skills, rid, correct)
        return {"before": before, "after": after}
    return mutate


class TestStateDocument:
    def test_round_trip(self):
        state = S.RuleState({A: {"p": 0.4, "n": 6, "c": 3, "v": "bkt-blend-1"}}, {f"{A}>{B}": 2},
                            {"n": 9, "c": 5}, 7, {"n1": 1_900_000_001, "n2": 1_900_000_002})
        back = S.state_from_doc(S.state_to_doc(state))
        assert back == state

    @pytest.mark.parametrize("doc", [None, 5, "x", [], {}])
    def test_missing_or_non_dict_documents_become_empty_state(self, doc):
        assert S.state_from_doc(doc) == S.RuleState()

    def test_corrupted_fields_are_dropped_not_fatal(self):
        doc = {"skills": {"junk": 1, A: {"p": 0.5, "n": 2, "c": 1}}, "confusions": "x", "revision": -3,
               "nonces": {"ok": 1_900_000_000, 7: 5, "": 5, "x" * 99: 5, "bad-expiry": "soon", "bool": True}}
        state = S.state_from_doc(doc)
        assert list(state.skills) == [A] and state.confusions == {} and state.revision == 0
        assert state.nonces == {"ok": 1_900_000_000}

    def test_the_old_list_format_of_nonces_is_ignored(self):
        assert S.state_from_doc({"nonces": ["a", "b"]}).nonces == {}

    def test_overall_is_sanitized(self):
        assert S.state_from_doc({"overall": {"n": 3, "c": 9}}).overall == {"n": 0, "c": 0}
        assert S.state_from_doc({"overall": "x"}).overall == {"n": 0, "c": 0}
        assert S.state_from_doc({"overall": {"n": 5, "c": 2}}).overall == {"n": 5, "c": 2}
        assert S.state_from_doc({}).overall == {"n": 0, "c": 0}

    def test_revision_must_be_a_non_negative_int(self):
        for bad in (True, 1.5, "3", None, -1):
            assert S.state_from_doc({"revision": bad}).revision == 0
        assert S.state_from_doc({"revision": 4}).revision == 4

    def test_loading_never_discards_a_stored_nonce(self):
        doc = {"nonces": {f"n{i}": 1_900_000_000 + i for i in range(S.MAX_NONCES + 30)}}
        assert len(S.state_from_doc(doc).nonces) == S.MAX_NONCES + 30

    def test_document_records_the_model_version(self):
        assert S.state_to_doc(S.RuleState())["modelVersion"] == R.MODEL_VERSION


class TestApplyToState:
    NOW = 1_900_000_000

    def test_when_full_of_unexpired_nonces_a_new_update_is_refused_and_nothing_is_evicted(self):
        full = {f"n{i}": self.NOW + 100 + i for i in range(S.MAX_NONCES)}
        state = S.RuleState(nonces=dict(full), revision=3)
        called = []
        with pytest.raises(S.StoreFull):
            S._apply_to_state(state, "fresh", lambda st: called.append(1), self.NOW + 7200, self.NOW)
        assert called == [] and state.nonces == full and state.revision == 3

    def test_a_full_store_still_recognises_replays_of_every_remembered_nonce(self):
        full = {f"n{i}": self.NOW + 100 + i for i in range(S.MAX_NONCES)}
        state = S.RuleState(nonces=dict(full))
        for nonce in ("n0", f"n{S.MAX_NONCES - 1}"):
            assert S._apply_to_state(state, nonce, lambda st: 1 / 0, self.NOW + 7200, self.NOW) == (False, None)

    def test_capacity_frees_up_as_nonces_expire(self):
        state = S.RuleState(nonces={f"n{i}": self.NOW + 1 + i for i in range(S.MAX_NONCES)})
        with pytest.raises(S.StoreFull):
            S._apply_to_state(state, "fresh", lambda st: None, self.NOW + 7200, self.NOW)
        applied, _ = S._apply_to_state(state, "fresh", lambda st: None, self.NOW + 7200, self.NOW + 2)   # n0、n1 已到期
        assert applied is True and "n0" not in state.nonces and "fresh" in state.nonces

    def test_a_duplicate_changes_nothing(self):
        state = S.RuleState(nonces={"a": self.NOW + 50}, revision=4)
        assert S._apply_to_state(state, "a", lambda st: 1 / 0, self.NOW + 50, self.NOW) == (False, None)
        assert state.revision == 4 and state.nonces == {"a": self.NOW + 50}

    def test_a_nonce_cannot_be_replayed_while_its_token_is_still_valid_even_after_many_others(self):
        # 回歸測試：舊版只留「最近 200 筆」，塞滿 200 個別的 nonce 就能把還沒到期的舊 nonce 擠掉再重放
        state = S.RuleState()
        S._apply_to_state(state, "victim", lambda st: None, self.NOW + 7200, self.NOW)
        for i in range(250):
            S._apply_to_state(state, f"filler{i}", lambda st: None, self.NOW + 7200, self.NOW)
        assert S._apply_to_state(state, "victim", lambda st: 1 / 0, self.NOW + 7200, self.NOW) == (False, None)

    def test_expired_nonces_are_pruned(self):
        state = S.RuleState(nonces={"old": self.NOW - 1, "edge": self.NOW, "live": self.NOW + 1})
        S._apply_to_state(state, "new", lambda st: None, self.NOW + 10, self.NOW)
        assert set(state.nonces) == {"live", "new"}                 # 到期時間 <= 現在就清掉（token 到期後本身就驗證不過）

    def test_default_retention_covers_the_token_lifetime(self):
        from fastAPI.routes.quiz import diagnosis
        assert S.NONCE_RETENTION_SECONDS > diagnosis.TOKEN_TTL_SECONDS
        state = S.RuleState()
        S._apply_to_state(state, "n", lambda st: None, None, self.NOW)
        assert state.nonces["n"] == self.NOW + S.NONCE_RETENTION_SECONDS

    @pytest.mark.parametrize("bad", ["soon", 1.5, True])
    def test_a_non_integer_expiry_is_refused(self, bad):
        with pytest.raises(S.StoreError):
            S._apply_to_state(S.RuleState(), "n", lambda st: None, bad, self.NOW)


class TestMemoryStore:
    def test_apply_creates_state_and_bumps_revision(self):
        store = S.MemoryStore()
        applied, result = store.apply("u", "amis", "n1", _bump(A))
        assert applied is True and result["after"] > result["before"]
        state = store.load("u", "amis")
        assert state.revision == 1 and list(state.nonces) == ["n1"] and state.skills[A]["n"] == 1

    def test_duplicate_nonce_is_not_applied_and_does_not_call_the_mutator(self):
        store = S.MemoryStore()
        store.apply("u", "amis", "n1", _bump(A))
        called = []
        applied, result = store.apply("u", "amis", "n1", lambda st: called.append(1))
        assert (applied, result, called) == (False, None, [])
        assert store.load("u", "amis").skills[A]["n"] == 1 and store.load("u", "amis").revision == 1

    def test_a_nonce_stays_consumed_for_its_whole_lifetime_even_when_the_store_is_flooded(self):
        # 回歸測試：塞滿別的 nonce 不能把還沒到期的舊 nonce 擠掉再重放（Codex 第三輪指出的路徑）
        store = S.MemoryStore()
        far = int(__import__("time").time()) + 7200
        store.apply("u", "amis", "victim", _bump(A), far)
        accepted = 0
        for i in range(S.MAX_NONCES + 50):
            try:
                accepted += store.apply("u", "amis", f"n{i}", _bump(B), far + 1 + i)[0]
            except S.StoreFull:
                pass
        assert accepted == S.MAX_NONCES - 1                       # 滿了之後的更新都被拒絕
        assert store.apply("u", "amis", "victim", _bump(A), far) == (False, None)
        assert store.load("u", "amis").skills[A]["n"] == 1

    def test_an_expired_nonce_can_be_reused_because_its_token_is_dead_anyway(self):
        store = S.MemoryStore()
        past = int(__import__("time").time()) - 10
        assert store.apply("u", "amis", "n", _bump(A), past)[0] is True
        assert store.apply("u", "amis", "n", _bump(A), past)[0] is True

    def test_failed_mutator_leaves_the_state_untouched(self):
        store = S.MemoryStore()
        store.apply("u", "amis", "n1", _bump(A))

        def boom(state):
            state.skills.clear()
            raise RuntimeError("boom")
        with pytest.raises(RuntimeError):
            store.apply("u", "amis", "n2", boom)
        state = store.load("u", "amis")
        assert state.skills[A]["n"] == 1 and "n2" not in state.nonces and state.revision == 1

    def test_load_returns_a_copy(self):
        store = S.MemoryStore()
        store.apply("u", "amis", "n1", _bump(A))
        snapshot = store.load("u", "amis")
        snapshot.skills.clear()
        assert store.load("u", "amis").skills

    def test_users_and_tribes_are_isolated(self):
        store = S.MemoryStore()
        store.apply("alice", "amis", "n1", _bump(A))
        assert store.load("bob", "amis").skills == {} and store.load("alice", "tayal").skills == {}

    def test_delete_removes_only_that_users_documents(self):
        store = S.MemoryStore()
        store.apply("alice", "amis", "n1", _bump(A))
        store.apply("alice", "tayal", "n2", _bump(A))
        store.apply("bob", "amis", "n3", _bump(A))
        store.delete("alice")
        assert store.load("alice", "amis").skills == {} and store.load("alice", "tayal").skills == {}
        assert store.load("bob", "amis").skills

    @pytest.mark.parametrize("uid,tribe", [("", "amis"), ("a/b", "amis"), ("u", "klingon"), ("x" * 129, "amis")])
    def test_invalid_keys_are_refused(self, uid, tribe):
        store = S.MemoryStore()
        with pytest.raises(S.StoreError):
            store.load(uid, tribe)
        with pytest.raises(S.StoreError):
            store.apply(uid, tribe, "n", _bump(A))

    @pytest.mark.parametrize("nonce", ["", "x" * 41])
    def test_invalid_nonce_is_refused(self, nonce):
        with pytest.raises(S.StoreError):
            S.MemoryStore().apply("u", "amis", nonce, _bump(A))

    def test_concurrent_updates_are_never_lost(self):
        store = S.MemoryStore()
        threads = [threading.Thread(target=lambda i=i: store.apply("u", "amis", f"n{i}", _bump(A))) for i in range(40)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        state = store.load("u", "amis")
        assert state.skills[A]["n"] == 40 and state.revision == 40

    def test_concurrent_duplicates_apply_exactly_once(self):
        store = S.MemoryStore()
        results = []
        threads = [threading.Thread(target=lambda: results.append(store.apply("u", "amis", "same", _bump(A))[0])) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert results.count(True) == 1 and store.load("u", "amis").skills[A]["n"] == 1


class _FakeSnapshot:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class _FakeRef:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def collection(self, name):
        return _FakeCollection(self.db, self.path + (name,))

    def get(self, transaction=None):
        self.db.reads.append(("txn" if transaction is not None else "plain", self.path))
        return _FakeSnapshot(self.db.docs.get(self.path))


class _FakeCollection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, doc_id):
        return _FakeRef(self.db, self.path + (doc_id,))


class _FakeTransaction:
    def __init__(self, db):
        self.db = db

    def set(self, ref, data):
        self.db.writes += 1
        self.db.docs[ref.path] = data


class _FakeDb:
    def __init__(self):
        self.docs, self.reads, self.writes = {}, [], 0

    def collection(self, name):
        return _FakeCollection(self, (name,))

    def transaction(self, **kwargs):
        self.transaction_options = kwargs
        return _FakeTransaction(self)


class TestFirestoreStoreAdapter:
    """假 client 沒有真的交易隔離，只驗證路徑、讀寫順序與錯誤處理；交易語意在 emulator 測試驗證。"""

    @pytest.fixture(autouse=True)
    def _transactional_passthrough(self, monkeypatch):
        import google.cloud.firestore as gcf
        monkeypatch.setattr(gcf, "transactional", lambda fn: fn)

    def test_document_lives_under_the_user_and_tribe(self):
        db = _FakeDb()
        store = S.FirestoreStore(db)
        store.apply("alice", "amis", "n1", _bump(A))
        assert ("users", "alice", "quizRuleState", "amis") in db.docs
        assert db.docs[("users", "alice", "quizRuleState", "amis")]["skills"][A]["n"] == 1

    def test_transactions_are_limited_to_a_few_attempts(self):
        db = _FakeDb()
        S.FirestoreStore(db).apply("alice", "amis", "n1", _bump(A))
        assert db.transaction_options == {"max_attempts": S.MAX_TRANSACTION_ATTEMPTS}

    def test_apply_reads_inside_the_transaction_and_load_reads_plainly(self):
        db = _FakeDb()
        store = S.FirestoreStore(db)
        store.apply("alice", "amis", "n1", _bump(A))
        store.load("alice", "amis")
        assert [kind for kind, _ in db.reads] == ["txn", "plain"]

    def test_duplicate_nonce_writes_nothing(self):
        db = _FakeDb()
        store = S.FirestoreStore(db)
        store.apply("alice", "amis", "n1", _bump(A))
        snapshot = dict(db.docs)
        writes_before = db.writes
        applied, _ = store.apply("alice", "amis", "n1", _bump(A))
        assert applied is False and db.docs == snapshot and db.writes == writes_before

    def test_load_of_missing_document_is_empty_state(self):
        assert S.FirestoreStore(_FakeDb()).load("alice", "amis") == S.RuleState()

    def test_client_errors_become_store_errors(self):
        class Broken(_FakeDb):
            def collection(self, name):
                raise RuntimeError("network")
        store = S.FirestoreStore(Broken())
        with pytest.raises(S.StoreError):
            store.load("alice", "amis")
        with pytest.raises(S.StoreError):
            store.apply("alice", "amis", "n1", _bump(A))

    def test_invalid_keys_are_refused_before_touching_firestore(self):
        class Exploding(_FakeDb):
            def collection(self, name):
                raise AssertionError("must not be called")
        with pytest.raises(S.StoreError):
            S.FirestoreStore(Exploding()).load("a/b", "amis")


class TestGetStore:
    def test_override_wins_and_can_be_cleared(self):
        marker = object()
        S.set_store_for_tests(marker)
        try:
            assert S.get_store() is marker
        finally:
            S.set_store_for_tests(None)

    def test_unconfigured_firebase_means_no_store(self, monkeypatch):
        monkeypatch.setattr(S, "_firestore_store", None)
        monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_PATH", raising=False)
        import config.firebase_init as fi
        monkeypatch.setattr(fi, "_firebase_initialized", False)
        assert S.get_store() is None

    def test_configured_firebase_gives_a_cached_firestore_store(self, monkeypatch):
        monkeypatch.setattr(S, "_firestore_store", None)
        import config.firebase_init as fi
        monkeypatch.setattr(fi, "ensure_firebase_initialized", lambda: None)
        first = S.get_store()
        assert isinstance(first, S.FirestoreStore) and S.get_store() is first
        monkeypatch.setattr(S, "_firestore_store", None)


class TestSummarize:
    def test_summary_lists_weak_rules_and_confusions(self):
        state = S.RuleState({A: {"p": 0.3, "n": 8, "c": 2, "v": "v"}, B: {"p": 0.9, "n": 10, "c": 9, "v": "v"}},
                            {f"{A}>{B}": 3})
        out = S.summarize(state)
        assert out["observedRules"] == 2 and [r["rule"] for r in out["weakest"]] == [A]
        assert out["confusions"][0]["count"] == 3 and out["minObservations"] == R.MIN_OBS_FOR_ESTIMATE
        assert out["modelVersion"] == R.MODEL_VERSION

    def test_empty_state(self):
        out = S.summarize(S.RuleState())
        assert out["observedRules"] == 0 and out["weakest"] == [] and out["confusions"] == []
