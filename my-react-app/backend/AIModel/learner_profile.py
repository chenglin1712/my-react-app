"""AI 助手用的學習者摘要：由伺服器依已驗證的 uid 從 Firestore 讀取（路線圖 #20）。

原本摘要由前端組好再傳（user_stats），後端只檢查型別與長度，使用者可以隨意竄改。
現在前端不再傳，這裡用 Admin SDK 讀三處資料，算法與原本前端一致：
  - users/{uid}.user_errors          {詞: 答錯次數}   → 最常錯的詞、答錯總數
  - users/{uid}.quiz_model.type_stats {題型: {n, e}}    → 答對數 = 總作答 - 總錯誤
  - userSituation（userId == uid）.level                → 程度；這份由後端寫入，前端不能改

誠實的限制：users/{uid} 這份文件本人在 Firestore 規則下可以自己寫，所以 user_errors 與
type_stats 對「有心人自己改自己的資料」並非完全可信；它們只影響他自己的對話，這裡把每個詞
清成單行、限制長度與數量後才放進 prompt，並標示為參考資料。要完全可信，要把這些統計搬到
只有後端能寫的文件（像 users/{uid}/quizRuleState）。

讀取失敗（沒設定 Firestore、網路、權限）一律回傳 None，呼叫端退回通用回答，不報錯。
"""
import logging
import re
import threading
import time

logger = logging.getLogger(__name__)

_TOP_ERRORS = 3
_MAX_WORD_LEN = 50
_MAX_LEVEL_LEN = 50
_CACHE_TTL = 60          # 秒：同一個人連續聊天不必每句都讀 Firestore
_FAILURE_TTL = 15        # 讀取失敗也短暫記住，Firestore 出問題時不會每句都等逾時
_CACHE_MAX = 500

_cache: dict = {}        # {uid: (到期時間, profile 或 None)}
_cache_lock = threading.Lock()

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f  ]+")


def _client():
    from config.firebase_init import ensure_firebase_initialized

    ensure_firebase_initialized()
    from firebase_admin import firestore

    return firestore.client()


def _count(value) -> int:
    """Firestore 裡的舊資料可能是 null、字串或負數，一律當成 0。"""
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _one_line(text, limit: int) -> str:
    return _CONTROL_CHARS.sub(" ", str(text)).strip()[:limit]


def build_profile(user_doc, level) -> dict:
    """純函式：把 Firestore 文件內容整理成摘要，方便單獨測試。"""
    user_doc = user_doc if isinstance(user_doc, dict) else {}
    errors = user_doc.get("user_errors")
    errors = errors if isinstance(errors, dict) else {}
    counts = {w: _count(c) for w, c in errors.items() if isinstance(w, str)}
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:_TOP_ERRORS]
    common_errors = [f"{_one_line(w, _MAX_WORD_LEN)}（答錯{c}次）" for w, c in ranked if c > 0 and _one_line(w, _MAX_WORD_LEN)]

    quiz_model = user_doc.get("quiz_model")
    type_stats = quiz_model.get("type_stats") if isinstance(quiz_model, dict) else None
    type_stats = type_stats if isinstance(type_stats, dict) else {}
    attempts = sum(_count(s.get("n")) for s in type_stats.values() if isinstance(s, dict))
    type_errors = sum(_count(s.get("e")) for s in type_stats.values() if isinstance(s, dict))

    clean_level = _one_line(level, _MAX_LEVEL_LEN) if isinstance(level, str) else ""
    return {
        "level": clean_level or "beginner",
        "correct": max(attempts - type_errors, 0),
        "incorrect": sum(counts.values()),
        "common_errors": common_errors,
    }


def _read_profile(uid: str) -> dict:
    db = _client()
    user_snapshot = db.collection("users").document(uid).get()
    user_doc = user_snapshot.to_dict() if user_snapshot.exists else {}

    from google.cloud.firestore_v1.base_query import FieldFilter

    level = None
    for doc in db.collection("userSituation").where(filter=FieldFilter("userId", "==", uid)).limit(1).stream():
        level = (doc.to_dict() or {}).get("level")
    return build_profile(user_doc, level)


def load_profile(uid: str, now: float | None = None):
    """回傳學習者摘要 dict；沒有 uid 或讀取失敗回傳 None（呼叫端退回通用回答）。"""
    if not uid:
        return None
    now = time.monotonic() if now is None else now
    with _cache_lock:
        hit = _cache.get(uid)
        if hit and hit[0] > now:
            return hit[1]

    try:
        profile = _read_profile(uid)
        ttl = _CACHE_TTL
    except Exception as exc:  # 沒設定 Firestore、網路、權限：都只是少了個人化，不能讓聊天壞掉
        logger.warning("[AIModel] 讀取學習者資料失敗，改用通用回答：%s: %s", type(exc).__name__, exc)
        profile, ttl = None, _FAILURE_TTL

    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[uid] = (now + ttl, profile)
    return profile


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
