"""WP-8 追加：後台畫面「顯示操作者／提案者姓名」用的共用批次姓名查詢。

使用者的顯示名稱存在 Firestore `users/{uid}.name`（與 user_service._merge_user 一致），
不在 Django 資料庫裡。儀表板最近操作、辭典提案的建立者／送審者都只存 uid，畫面上要顯示
姓名就得回 Firestore 查——這裡集中處理三件事：

1. 批次：一次 get_all() 查完整批 uid（只取 name 欄位，不把 email 等個資讀回來），
   不在迴圈裡逐筆打 Firebase（避免 N+1）。
2. 快取：查到的姓名放 Django cache NAME_TTL_SECONDS 秒，查無此人放較短的 MISSING_TTL_SECONDS；
   姓名只是輔助顯示，容許短暫過期。
3. 失敗退回：Firebase 未設定、逾時或任何錯誤都回空字串，且 FAILURE_BACKOFF_SECONDS 秒內
   不再嘗試（不然 Firebase 掛掉時每個請求都要白等逾時）。姓名查詢失敗絕不能讓主要請求失敗。
"""
import logging

from django.core.cache import cache

from . import firebase_ops

logger = logging.getLogger(__name__)

NAME_TTL_SECONDS = 600
MISSING_TTL_SECONDS = 120
FAILURE_BACKOFF_SECONDS = 60
LOOKUP_TIMEOUT_SECONDS = 3.0
MAX_BATCH = 100

_CACHE_PREFIX = "adminapi:user_name:"
# WP-8 追加：退避旗標原本是 _CACHE_PREFIX + "__backoff__"，跟「uid 為 __backoff__ 的姓名快取」同一把鍵，
# 兩者會互相覆蓋。改用不同的前綴（user_name_lookup 不是 user_name: 開頭），任何 uid 都組不出這把鍵。
_BACKOFF_KEY = "adminapi:user_name_lookup:backoff"
# 系統帳號與佔位值不是真的 Firestore 使用者，不必查
_NON_USER_UIDS = {"", "anon", "system"}
# Firebase Auth 的 uid 上限 128 字元（Firestore 文件 id 本身上限 1500 bytes，uid 更嚴）
_MAX_UID_LENGTH = 128


def _is_lookupable(uid):
    """WP-8 追加：只查「可能是合法 Firestore 文件 id 的 uid」。

    Firestore 文件 id 規則：不能含斜線（會變成子集合路徑）、不能只是「.」或「..」、
    不能符合 __.*__（保留給系統）。不合法的 id 送進 get_all 會讓整批查詢丟例外，
    進而觸發退避、連帶其他正常 uid 也顯示不出姓名，所以先在這裡排除。
    另外排除空白與控制字元：它們不是 Firebase 產生的 uid，而且當快取鍵會讓 memcached 出錯。
    """
    if not isinstance(uid, str) or uid in _NON_USER_UIDS:
        return False
    if len(uid) > _MAX_UID_LENGTH or "/" in uid or uid in (".", ".."):
        return False
    if len(uid) >= 4 and uid.startswith("__") and uid.endswith("__"):
        return False
    return not any(ch.isspace() or not ch.isprintable() for ch in uid)


def _fetch_names(uids):
    """實際打 Firestore 的部分（測試會 patch 這支）。回傳 {uid: name}，查無文件的 uid 對應空字串。"""
    client = firebase_ops.get_firestore_client()
    refs = [client.collection("users").document(uid) for uid in uids]
    found = {uid: "" for uid in uids}
    for snap in client.get_all(refs, field_paths=["name"], retry=None, timeout=LOOKUP_TIMEOUT_SECONDS):
        if snap.exists:
            name = (snap.to_dict() or {}).get("name")
            found[snap.id] = name.strip() if isinstance(name, str) else ""
    return found


def lookup_user_names(uids):
    """回傳 {uid: 顯示名稱}，涵蓋傳入的每個 uid；查不到或查詢失敗時對應空字串。"""
    wanted = list(dict.fromkeys(uid for uid in uids if isinstance(uid, str)))
    result = {uid: "" for uid in wanted}
    candidates = [uid for uid in wanted if _is_lookupable(uid)][:MAX_BATCH]
    if not candidates:
        return result

    try:
        cached = cache.get_many([_CACHE_PREFIX + uid for uid in candidates])
    except Exception:
        logger.warning("讀取使用者姓名快取失敗，改為直接查詢", exc_info=True)
        cached = {}
    misses = []
    for uid in candidates:
        value = cached.get(_CACHE_PREFIX + uid)
        if value is None:
            misses.append(uid)
        else:
            result[uid] = value
    if not misses:
        return result

    try:
        if cache.get(_BACKOFF_KEY):
            return result
    except Exception:
        pass

    try:
        fetched = _fetch_names(misses)
    except Exception:
        logger.warning("批次查詢使用者姓名失敗，%s 秒內改為只顯示 uid", FAILURE_BACKOFF_SECONDS, exc_info=True)
        try:
            cache.set(_BACKOFF_KEY, True, FAILURE_BACKOFF_SECONDS)
        except Exception:
            pass
        return result

    found = {uid: name for uid, name in fetched.items() if uid in result and name}
    missing = [uid for uid in misses if uid not in found]
    result.update(found)
    try:
        if found:
            cache.set_many({_CACHE_PREFIX + uid: name for uid, name in found.items()}, NAME_TTL_SECONDS)
        if missing:
            cache.set_many({_CACHE_PREFIX + uid: "" for uid in missing}, MISSING_TTL_SECONDS)
    except Exception:
        logger.warning("寫入使用者姓名快取失敗", exc_info=True)
    return result


def forget_user_name(uid):
    """後台改了姓名後立刻讓快取失效，不必等 TTL。"""
    try:
        cache.delete(_CACHE_PREFIX + uid)
    except Exception:
        logger.warning("清除使用者姓名快取失敗", exc_info=True)


def lookup_user_name(uid):
    return lookup_user_names([uid]).get(uid, "") if uid else ""
