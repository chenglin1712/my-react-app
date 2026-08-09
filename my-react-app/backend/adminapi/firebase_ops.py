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


def upload_media_object(data, object_path, content_type):
    """把記憶體裡的 bytes 上傳到 Storage 的 object_path，設成公開可讀並回傳公開網址。

    給 migrate_dictionary_media 這支批次遷移指令用（P5 辭典媒體自主化）：呼叫端
    已經把來源檔案下載到記憶體、驗證過 SHA-256／大小／MIME 之後才呼叫這裡，這裡
    只負責上傳，不做任何內容驗證。吃 bytes 而不是本地檔案路徑是刻意的——這批
    檔案單檔上限抓 15MB（實測音檔 20~115KB、圖片約 1.2MB，遠低於上限），下載時
    反正整份都已經在記憶體（httpx 的 res.content），沒有必要多一趟寫暫存檔／
    讀回來，也少一個程式中斷時暫存檔沒清乾淨的失敗點。object_path 慣例上是
    內容的 SHA-256（呼叫端決定），內容本身不會變，所以 Cache-Control 可以放心
    設一年 + immutable，讓 Google 的 CDN 與瀏覽器長期快取，不用每次播放/顯示
    都回源。

    這是這個模組第一個「上傳」操作——之前只有 delete_storage_file_by_download_url
    這種「刪除」先例，上傳沿用同樣的延遲 import + ensure_firebase_initialized()
    慣例。跟前端既有的 Cloudinary 上傳（MediaUploadField.jsx）不同來源，這裡用
    Admin SDK 直接寫，不經任何免簽章 preset。

    刻意不呼叫 blob.make_public()：Firebase Console 新建的 bucket 預設開啟
    Uniform bucket-level access，這個模式下逐物件 ACL（make_public 的底層機制）
    會直接丟例外，公開讀取必須在 bucket 層級用 IAM 設一次（例如
    `gsutil iam ch allUsers:objectViewer gs://<bucket>`，Phase 0 設定時做，
    不是每次上傳都做）。這裡只管上傳，回傳的網址是否真的公開可讀，取決於那次
    bucket 層級設定有沒有做好。
    """
    ensure_firebase_initialized()
    bucket = get_storage_bucket()
    blob = bucket.blob(object_path)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.upload_from_string(data, content_type=content_type)
    return blob.public_url


def delete_storage_file_by_download_url(url, expected_path_prefix=None):
    """從 getDownloadURL() 回傳的下載網址反解出 Storage 物件路徑並刪除。

    前端存進 Firestore 的是下載網址（例如 pronunciationRecordingService.js
    的 storageUrl 欄位），不是物件路徑；Admin SDK 的 bucket.blob(path).delete()
    需要的是 `pronunciations/{tribe}/{word}/{filename}` 這種物件路徑，要從
    網址的 `/o/<url-encoded 路徑>` 片段解碼取出。

    這個網址欄位是使用者可控的（Firestore 的 recordings.create 規則只驗證
    uid 是本人，沒有限制 storageUrl 的內容）——如果不驗證就直接刪，惡意
    使用者可以建立一筆帶偽造 storageUrl 的錄音文件（指向同一個 bucket 裡
    任何其他物件），誘使之後的審核下架或帳號刪除流程刪掉不相關的檔案。
    這裡強制要求：(1) 網址主機必須是真正的 Firebase Storage 網域，
    (2) 網址裡的 bucket 名稱要跟目前設定的 bucket 完全一致，
    (3) 呼叫端可傳入 expected_path_prefix（例如 "pronunciations/tayal/"，
    用真正的路徑區段組出來，不是信任文件內部欄位），物件路徑必須落在這個
    prefix 底下才會真的執行刪除——任何一項檢查沒過就直接回 False，視同
    「刪不掉」，不會讓呼叫端誤以為刪除成功。

    回傳 True/False 而不是讓例外往外拋：呼叫端（帳號刪除、錄音下架）都是
    「盡量刪、刪不掉也要讓其他步驟繼續」的語意，網址格式不符預期或物件
    已經不存在都不該讓整個操作中斷在這一步。
    """
    from urllib.parse import unquote, urlparse

    try:
        parsed = urlparse(url)
    except ValueError:
        return False

    if parsed.scheme != "https" or parsed.netloc != "firebasestorage.googleapis.com":
        return False

    try:
        # 路徑形如 /v0/b/<bucket>/o/<url-encoded 物件路徑>
        before_object, encoded_object_path = parsed.path.split("/o/", 1)
        bucket_name = before_object.split("/b/", 1)[1]
        object_path = unquote(encoded_object_path)
    except (IndexError, ValueError):
        return False

    bucket = get_storage_bucket()
    if bucket_name != bucket.name:
        return False

    if expected_path_prefix is not None and not object_path.startswith(expected_path_prefix):
        return False

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


def create_firebase_user(email, password, display_name=None):
    """後台直接建立帳號用（P3.8）——跟前台 /register 的
    createUserWithEmailAndPassword 是同一個 Firebase 專案、同一種帳號，
    差別只在這裡是管理員代替使用者建立，不需要使用者自己在前台走一次
    註冊流程。email 重複時讓 firebase_admin.auth.EmailAlreadyExistsError
    原樣往外拋，呼叫端自行 catch 轉成 400。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    return firebase_auth.create_user(email=email, password=password, display_name=display_name)


def set_user_password(uid, new_password):
    """管理員代使用者設定新密碼——比停權/刪除更敏感（等於能無聲完整接管
    帳號），呼叫端要求輸入目標帳號 email 確認、且動作後一定要
    revoke_sessions，讓被改密碼的人手上的舊登入立刻失效。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    firebase_auth.update_user(uid, password=new_password)


def set_user_email(uid, new_email):
    """更新 Firebase Auth 的 email——呼叫端要記得同步更新 Firestore
    users/{uid} 文件的 email 欄位（前台註冊時兩邊各存一份，見
    userServive.jsx 的 registerWithImg），不然兩邊會不一致。email 重複時
    讓 EmailAlreadyExistsError 原樣往外拋，呼叫端自行 catch 轉成 400。"""
    ensure_firebase_initialized()
    from firebase_admin import auth as firebase_auth
    firebase_auth.update_user(uid, email=new_email)
