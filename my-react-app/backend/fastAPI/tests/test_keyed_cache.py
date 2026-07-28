"""測試 fastAPI/routes/keyed_cache.py 的 KeyedCache：取代原本 quiz.py／listening.py／
sentence.py（單一全域 threading.Lock()，不同 key 也會互相排隊）與
dictionary/search.py／grammar.py（各自的 _KeyedLock + dict，鎖粒度雖然對但要
自己管理雙重檢查鎖定）的共用 get-or-compute 快取實作。
"""
import threading
import time

from fastAPI.routes.keyed_cache import KeyedCache


def test_computes_once_per_key():
    cache = KeyedCache()
    calls = []

    def compute():
        calls.append(1)
        return "value"

    assert cache.get_or_compute("tayal", compute) == "value"
    assert cache.get_or_compute("tayal", compute) == "value"
    assert len(calls) == 1


def test_different_keys_computed_independently():
    cache = KeyedCache()

    assert cache.get_or_compute("tayal", lambda: "A") == "A"
    assert cache.get_or_compute("amis", lambda: "B") == "B"
    assert cache.get("tayal") == "A"
    assert cache.get("amis") == "B"


def test_none_result_is_not_cached():
    # _load_grammar 對不存在的部落回傳 None 時原本就不會寫入快取，
    # 讓下一次呼叫可以重新嘗試，而不是把「查無資料」永久當成結果存起來。
    cache = KeyedCache()
    calls = []

    def compute():
        calls.append(1)
        return None

    assert cache.get_or_compute("missing", compute) is None
    assert cache.get_or_compute("missing", compute) is None
    assert len(calls) == 2
    assert "missing" not in cache


def test_get_without_compute_returns_default_when_absent():
    cache = KeyedCache()
    assert cache.get("tayal") is None
    assert cache.get("tayal", "fallback") == "fallback"


def test_concurrent_calls_to_same_key_compute_once():
    cache = KeyedCache()
    calls = []
    start_barrier = threading.Barrier(5)

    def compute():
        calls.append(1)
        time.sleep(0.05)
        return "value"

    def worker():
        start_barrier.wait()
        cache.get_or_compute("tayal", compute)

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(calls) == 1


def test_different_keys_do_not_block_each_other():
    cache = KeyedCache()
    tayal_started = threading.Event()
    release_tayal = threading.Event()

    def slow_compute_for_tayal():
        tayal_started.set()
        release_tayal.wait(timeout=2)
        return "tayal-value"

    tayal_thread = threading.Thread(
        target=lambda: cache.get_or_compute("tayal", slow_compute_for_tayal)
    )
    tayal_thread.start()
    assert tayal_started.wait(timeout=2)

    # tayal 的 compute 還卡在 release_tayal.wait() 沒放鎖，amis 應該不受影響，
    # 能立刻算出自己的值，不用排隊等 tayal 算完。
    assert cache.get_or_compute("amis", lambda: "amis-value") == "amis-value"

    release_tayal.set()
    tayal_thread.join(timeout=2)
    assert cache.get("tayal") == "tayal-value"
