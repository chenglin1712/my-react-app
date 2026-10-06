"""FirestoreStore 對真正的 Firestore（emulator）的交易行為：原子更新、nonce 去重、並發不遺失更新。

沒有 emulator 時整個檔案略過（一般的 pytest 不會失敗）。執行方式（在專案根目錄）：

    firebase emulators:exec --only firestore --project yuanyu-app-rules-test \
        "python -m pytest backend/fastAPI/tests/test_rule_state_store_firestore.py -q"

emulators:exec 會自動設定 FIRESTORE_EMULATOR_HOST；這裡用匿名憑證直接建立 google-cloud-firestore
client（不經過 firebase_admin 的憑證初始化），交易與重試邏輯跟正式環境走同一段程式。
"""
import os
import threading
import uuid

import pytest

from config import rule_skill_model as R
from fastAPI.routes.quiz import rule_state_store as S

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="需要 Firestore emulator")

A = R.rule_id("amis", "P", "pa")


@pytest.fixture
def store():
    from google.auth.credentials import AnonymousCredentials
    from google.cloud import firestore

    client = firestore.Client(project="yuanyu-app-rules-test", credentials=AnonymousCredentials())
    yield S.FirestoreStore(client), f"user-{uuid.uuid4().hex[:10]}"


def _bump(rid=A, correct=True):
    def mutate(state):
        before, after = R.apply_observation(state.skills, rid, correct)
        return {"before": before, "after": after}
    return mutate


def test_apply_then_load_round_trips(store):
    s, uid = store
    applied, result = s.apply(uid, "amis", "n1", _bump())
    assert applied is True and result["after"] > result["before"]
    state = s.load(uid, "amis")
    assert state.skills[A]["n"] == 1 and state.revision == 1 and list(state.nonces) == ["n1"]


def test_duplicate_nonce_is_applied_once(store):
    s, uid = store
    s.apply(uid, "amis", "n1", _bump())
    applied, _ = s.apply(uid, "amis", "n1", _bump())
    assert applied is False and s.load(uid, "amis").skills[A]["n"] == 1


def test_users_and_tribes_have_separate_documents(store):
    s, uid = store
    s.apply(uid, "amis", "n1", _bump())
    assert s.load(uid, "tayal").skills == {} and s.load(uid + "x", "amis").skills == {}


def test_failed_mutator_writes_nothing(store):
    s, uid = store

    def boom(state):
        state.skills[A] = {"p": 0.5, "n": 1, "c": 1, "v": "x"}
        raise RuntimeError("boom")
    with pytest.raises(S.StoreError):
        s.apply(uid, "amis", "n1", boom)
    assert s.load(uid, "amis") == S.RuleState()


def _run_threads(target, count):
    errors = []

    def wrapped(i):
        try:
            target(i)
        except Exception as exc:                      # 收集起來，由測試統一判斷
            errors.append(exc)

    threads = [threading.Thread(target=wrapped, args=(i,)) for i in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_concurrent_updates_from_two_devices_are_not_lost(store):
    # 模擬同一位使用者兩個分頁／裝置同時作答：兩筆更新都必須留下（修好前端整份覆寫的 lost update）
    s, uid = store
    errors = _run_threads(lambda i: s.apply(uid, "amis", f"n{i}", _bump()), 2)
    assert errors == []
    state = s.load(uid, "amis")
    assert state.skills[A]["n"] == 2 and state.revision == 2


def test_a_burst_of_concurrent_updates_is_either_applied_or_reported_never_silently_lost(store):
    s, uid = store
    results = []
    errors = _run_threads(lambda i: results.append(s.apply(uid, "amis", f"n{i}", _bump())[0]), 6)
    state = s.load(uid, "amis")
    # 每個成功的呼叫恰好留下一次更新；爭用太激烈時 Firestore 會中止交易（emulator 實測 6~8 個同時寫同一份
    # 文件就可能全部放棄），那會以 StoreError 回報、呼叫端視為這次沒有更新，絕不會「回報成功卻沒有留下」。
    # 同一位使用者作答是依序送出的，實務上只有多分頁／多裝置才會同時寫。
    assert all(isinstance(e, S.StoreError) for e in errors)
    assert state.skills.get(A, {}).get("n", 0) == results.count(True) == state.revision


def test_concurrent_duplicates_never_apply_more_than_once(store):
    s, uid = store
    results = []
    errors = _run_threads(lambda i: results.append(s.apply(uid, "amis", "same", _bump())[0]), 4)
    assert all(isinstance(e, S.StoreError) for e in errors)
    assert results.count(True) <= 1
    assert s.load(uid, "amis").skills.get(A, {}).get("n", 0) == results.count(True)
