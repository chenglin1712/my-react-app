"""P3 使用者與審核共用的 Firebase Admin SDK 操作包裝層。

集中包裝這批功能會用到、專案裡先前完全沒有先例的 Firebase Admin SDK 操作
（list_users／revoke_refresh_tokens／delete_user／Firestore Admin SDK／
Storage Admin SDK——目前唯一的先例 set_staff_role.py 管理指令只用過
set_custom_user_claims）。延用 ensure_firebase_initialized() + 延遲 import
的既有慣例，讓沒有設定 FIREBASE_SERVICE_ACCOUNT_PATH 的環境（例如跑不需要
Firebase 的測試）單純 import 這個模組不會出錯，只有真的呼叫到才會要求金鑰
存在，呼叫端測試時可以直接 patch 這裡的個別函式，不需要真的連 Firebase。
"""
from config.firebase_init import ensure_firebase_initialized

_firestore_client = None
_storage_bucket = None


def list_all_firebase_users():
    """回傳 Firebase Auth 全部使用者的 UserRecord list（分頁疊代到底）。

    使用者列表頁（§P3.2）刻意不建 Firestore 影子索引表，每次開列表都即時
    全量拉取——這支函式就是那個「全量拉取」的實作，篩選/分頁交給呼叫端在
    記憶體裡做（比照 Announcement.tribes 篩選的既有做法）。
    """
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth

    users = []
    page = firebase_auth.list_users()
    while page:
        users.extend(page.users)
        page = page.get_next_page()
    return users


def get_firebase_user(uid):
    """回傳單一使用者的 UserRecord；查無此人時讓 firebase_admin.auth.UserNotFoundError
    原樣往外拋，呼叫端自行 catch 轉成 404（跟 set_staff_role.py 對
    UserNotFoundError 的處理方式一致，不在這裡吞掉）。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    return firebase_auth.get_user(uid)


def get_firestore_client():
    """Firestore Admin SDK client，模組層快取一次初始化的結果。"""
    global _firestore_client
    ensure_firebase_initialized()
    if _firestore_client is None:
        from firebase_admin import firestore
        _firestore_client = firestore.client()
    return _firestore_client


def get_storage_bucket():
    """Storage Admin SDK bucket，給刪除發音錄音檔用。"""
    global _storage_bucket
    ensure_firebase_initialized()
    if _storage_bucket is None:
        from firebase_admin import storage
        _storage_bucket = storage.bucket()
    return _storage_bucket


def delete_storage_file_by_download_url(url):
    """從 getDownloadURL() 回傳的下載網址反解出 Storage 物件路徑並刪除。

    前端存進 Firestore 的是下載網址（例如 pronunciationRecordingService.js
    的 storageUrl 欄位），不是物件路徑；Admin SDK 的 bucket.blob(path).delete()
    需要的是 `pronunciations/{tribe}/{word}/{filename}` 這種物件路徑，要從
    網址的 `/o/<url-encoded 路徑>` 片段解碼取出。

    回傳 True/False 而不是讓例外往外拋：呼叫端（帳號刪除、錄音下架）都是
    「盡量刪、刪不掉也要讓其他步驟繼續」的語意，網址格式不符預期或物件
    已經不存在都不該讓整個操作中斷在這一步。
    """
    from urllib.parse import unquote, urlparse
    try:
        path = urlparse(url).path
        object_path = unquote(path.split("/o/", 1)[1])
    except IndexError:
        return False

    bucket = get_storage_bucket()
    try:
        bucket.blob(object_path).delete()
    except Exception:
        return False
    return True


def set_user_role(uid, role):
    """merge custom claims 的 role 欄位；role=None 代表拔掉這個 key（收回角色，
    降回一般使用者）。跟 set_staff_role.py 管理指令同一種 merge 語意：保留
    這個帳號既有的其他 custom claims，不整包覆蓋。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth

    user = firebase_auth.get_user(uid)
    claims = dict(user.custom_claims or {})
    if role is None:
        claims.pop("role", None)
    else:
        claims["role"] = role
    firebase_auth.set_custom_user_claims(uid, claims)


def revoke_sessions(uid):
    """撤銷這個帳號手上所有 refresh token——下一次請求都必須重新登入才能拿到
    新 token。角色異動／停權都要呼叫，避免舊 token 在最長 1 小時的有效期內
    繼續帶著舊權限生效（見規劃文件風險項「角色 claim 的傳播延遲」）。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    firebase_auth.revoke_refresh_tokens(uid)


def set_user_disabled(uid, disabled):
    """停權／解除停權。停權狀態的唯一真相就是 Firebase Auth 內建的 disabled
    欄位，Firestore users/{uid} 不另外存一份（見 P3 規劃的既有決策）。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    firebase_auth.update_user(uid, disabled=disabled)


def delete_firebase_user(uid):
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    firebase_auth.delete_user(uid)
