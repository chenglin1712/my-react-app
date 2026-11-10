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


# ── P4 辭典管理新增：invalidate／clear／keys（給 /internal/cache/invalidate 用）──

def test_invalidate_removes_value_and_returns_true():
    cache = KeyedCache()
    cache.get_or_compute("tayal", lambda: "value")

    assert cache.invalidate("tayal") is True
    assert "tayal" not in cache
    assert cache.get("tayal") is None


def test_invalidate_missing_key_returns_false():
    cache = KeyedCache()
    assert cache.invalidate("missing") is False


def test_invalidated_key_recomputes_on_next_call():
    cache = KeyedCache()
    calls = []

    def compute():
        calls.append(1)
        return f"value-{len(calls)}"

    assert cache.get_or_compute("tayal", compute) == "value-1"
    cache.invalidate("tayal")
    assert cache.get_or_compute("tayal", compute) == "value-2"
    assert len(calls) == 2


def test_invalidate_does_not_break_double_checked_locking_for_other_keys():
    # invalidate() 刻意不刪除 _locks[key]；這裡確認清除一個 key 之後，
    # 其他 key 的雙重檢查鎖定（同一個 key 併發只算一次）依然正常運作。
    cache = KeyedCache()
    cache.get_or_compute("tayal", lambda: "tayal-value")
    cache.invalidate("tayal")

    calls = []
    start_barrier = threading.Barrier(5)

    def compute():
        calls.append(1)
        time.sleep(0.05)
        return "amis-value"

    def worker():
        start_barrier.wait()
        cache.get_or_compute("amis", compute)

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(calls) == 1


def test_clear_removes_all_values_and_returns_count():
    cache = KeyedCache()
    cache.get_or_compute("tayal", lambda: "A")
    cache.get_or_compute("amis", lambda: "B")

    assert cache.clear() == 2
    assert "tayal" not in cache
    assert "amis" not in cache


def test_keys_lists_currently_cached_keys():
    cache = KeyedCache()
    cache.get_or_compute("tayal", lambda: "A")
    cache.get_or_compute("amis", lambda: "B")

    assert set(cache.keys()) == {"tayal", "amis"}


def test_get_or_compute_reads_cached_value_with_a_single_lookup():
    """回歸測試（E4）：快取命中時不能是「先 in 再 []」兩個步驟。
    這個 dict 在被問 `in` 的瞬間把自己清空，模擬另一個執行緒剛好 invalidate／clear；
    舊寫法會在第二步 KeyError，單次 get() 不會碰到 `in`。"""
    class _ClearsWhenAskedContains(dict):
        def __contains__(self, key):
            self.clear()
            return True

    cache = KeyedCache()
    cache._values = _ClearsWhenAskedContains({"tayal": "cached"})

    assert cache.get_or_compute("tayal", lambda: "recomputed") == "cached"


def test_falsy_cached_values_are_returned_without_recomputing():
    # 單次 get() + 哨兵：False／0／""／[] 都是合法的快取值，不能被當成「沒有」。
    cache = KeyedCache()
    calls = []
    for key, value in (("a", False), ("b", 0), ("c", ""), ("d", [])):
        cache.get_or_compute(key, lambda v=value: v)
    for key in "abcd":
        assert cache.get_or_compute(key, lambda: calls.append(1) or "recomputed") != "recomputed"
    assert calls == []


def test_none_result_is_not_cached_and_is_recomputed_next_time():
    cache = KeyedCache()
    calls = []

    def compute():
        calls.append(1)
        return None

    assert cache.get_or_compute("k", compute) is None
    assert cache.get_or_compute("k", compute) is None
    assert len(calls) == 2


def test_clear_during_compute_does_not_let_the_stale_result_back_into_the_cache():
    """clear() 發生在 compute() 進行中：算完的舊結果不能被寫回快取（下一次要重新算）。"""
    cache = KeyedCache()
    calls = []

    def compute():
        calls.append(1)
        if len(calls) == 1:
            cache.clear()  # 模擬另一個執行緒在這個時間點失效整個快取
        return f"value-{len(calls)}"

    assert cache.get_or_compute("k", compute) == "value-1"  # 這次呼叫仍拿到剛算出的值
    assert "k" not in cache  # 但舊結果沒有被存起來
    assert cache.get_or_compute("k", compute) == "value-2"
    assert "k" in cache


def test_result_is_cached_when_no_clear_happens_during_compute():
    cache = KeyedCache()
    assert cache.get_or_compute("k", lambda: "v") == "v"
    assert cache.get_or_compute("k", lambda: "other") == "v"
