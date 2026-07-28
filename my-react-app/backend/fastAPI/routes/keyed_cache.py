"""依 key 做 get-or-compute 的行程內快取，全部靠 db 撈資料的路由共用同一套實作。

在這個檔案出現以前，quiz.py／listening.py／sentence.py／dictionary/search.py／
dictionary/grammar.py 各自重寫了一次「dict + Lock + 雙重檢查鎖定」：
- listening.py／sentence.py 用單一全域 threading.Lock() 保護整個 dict——
  不同族語的請求即使彼此完全獨立，也得排隊等前一個算完才能開始算自己的。
- dictionary/search.py／grammar.py 用 dictionary/keyed_lock.py 的 _KeyedLock，
  依 key 各自一把鎖，不同 key 可以並行各自算各自的。

同一份程式碼被複製 5 次，鎖粒度還不一致，改一次雙重檢查鎖定的寫法（例如要修
一個 race condition）得記得同步改 5 個地方。這裡把「依 key 各自一把鎖 + 雙重
檢查鎖定 + 算過的結果存起來」統一成一個型別，取代 _KeyedLock 與各檔案自己的
dict/Lock 宣告。
"""
import threading
from typing import Callable, Dict, Generic, Hashable, Optional, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class KeyedCache(Generic[K, V]):
    def __init__(self):
        self._values: Dict[K, V] = {}
        self._locks: Dict[K, threading.Lock] = {}
        self._meta_lock = threading.Lock()

    def _lock_for(self, key: K) -> threading.Lock:
        if key not in self._locks:
            with self._meta_lock:
                if key not in self._locks:
                    self._locks[key] = threading.Lock()
        return self._locks[key]

    def __contains__(self, key: K) -> bool:
        return key in self._values

    def get(self, key: K, default: Optional[V] = None) -> Optional[V]:
        """單純查看目前是否已經算過，不觸發計算（不需要鎖）。"""
        return self._values.get(key, default)

    def get_or_compute(self, key: K, compute: Callable[[], V]) -> V:
        """key 已經算過就直接回傳；否則用該 key 專屬的鎖算一次、存起來、回傳。
        compute() 回傳 None 時不會被存進快取（代表「這次沒算出東西」，例如
        查無資料，讓下一次呼叫可以重新嘗試，而不是把 None 永久當成快取結果）。"""
        if key in self._values:
            return self._values[key]
        with self._lock_for(key):
            if key in self._values:
                return self._values[key]
            value = compute()
            if value is not None:
                self._values[key] = value
            return value
