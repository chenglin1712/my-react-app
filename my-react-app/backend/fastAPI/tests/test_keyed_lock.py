"""測試 fastAPI/routes/dictionary/keyed_lock.py 的 _KeyedLock：原本 5 個部落（跟 3 個文法
快取）都共用同一把 threading.Lock()，冷啟動時不同部落的請求會不必要地互相排隊。
改成依 key 各自一把鎖，這裡驗證同一個 key 每次拿到同一把鎖（真的能互斥同一個
key 的重複請求），不同 key 拿到不同鎖（彼此不會互相排隊）。
"""
from fastAPI.routes.dictionary import _KeyedLock


def test_same_key_returns_same_lock_instance():
    locks = _KeyedLock()
    assert locks.get("tayal") is locks.get("tayal")


def test_different_keys_return_different_lock_instances():
    locks = _KeyedLock()
    assert locks.get("tayal") is not locks.get("amis")


def test_lock_actually_locks():
    locks = _KeyedLock()
    lock = locks.get("tayal")
    assert lock.acquire(blocking=False) is True
    # 同一個 key 再拿一次鎖，鎖已經被上面那次拿走，應該拿不到。
    assert locks.get("tayal").acquire(blocking=False) is False
    lock.release()


def test_different_keys_do_not_block_each_other():
    locks = _KeyedLock()
    tayal_lock = locks.get("tayal")
    assert tayal_lock.acquire(blocking=False) is True
    try:
        # 另一個部落的鎖沒被佔用，不受 tayal_lock 影響。
        amis_lock = locks.get("amis")
        assert amis_lock.acquire(blocking=False) is True
        amis_lock.release()
    finally:
        tayal_lock.release()
