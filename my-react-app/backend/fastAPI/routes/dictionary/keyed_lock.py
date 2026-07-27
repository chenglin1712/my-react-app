import threading
from typing import Any, Dict


class _KeyedLock:
    """依 key 各自一把鎖，取代「所有 key 共用同一把鎖」。search.py／grammar.py 幾個
    快取原本都是一個 dict 配一把 threading.Lock()，同一把鎖保護所有族語／章節 key——
    冷啟動時若同時有兩個不同族語（或不同章節）的請求進來，即使彼此完全獨立，後面
    那個也得先排隊等前一個查完、放鎖才能開始查自己的，白白拖長冷啟動時間。改成
    依 key 各自一把鎖，不同 key 可以並行各自查各自的，只有同一個 key 的重複
    請求才需要互相等待（純效能調整，不影響正確性——原本的雙重檢查鎖定寫法
    不變）。"""
    def __init__(self):
        self._locks: Dict[Any, threading.Lock] = {}
        self._meta_lock = threading.Lock()

    def get(self, key) -> threading.Lock:
        if key not in self._locks:
            with self._meta_lock:
                if key not in self._locks:
                    self._locks[key] = threading.Lock()
        return self._locks[key]
