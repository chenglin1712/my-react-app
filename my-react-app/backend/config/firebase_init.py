"""Firebase Admin SDK 初始化，Django 與 FastAPI 共用。

原本 config/firebase_auth.py（Django）與 fastAPI/routes/auth.py（FastAPI）
各自維護一份幾乎相同的 _ensure_firebase，唯一差異是服務帳戶金鑰沒設定時
拋出的例外型別（Django 版拋 EnvironmentError、FastAPI 版拋 HTTPException）——
實際初始化 firebase_admin SDK 的邏輯完全一樣。這裡統一成一份，只拋最原始、
跟框架無關的 EnvironmentError，呼叫端各自接住轉成自己框架慣用的錯誤回應。
"""
import os
import threading

_firebase_initialized = False
# P5 辭典媒體自主化的 migrate_dictionary_media 指令用 asyncio.to_thread 讓多個
# worker（--concurrency）併發呼叫 upload_media_object，第一次呼叫時這些 worker
# 會在不同的 OS thread 上幾乎同時進到這支函式——原本「檢查 _firebase_initialized
# → 檢查 firebase_admin._apps → initialize_app()」這段沒有鎖保護，兩個 thread
# 都可能在 initialize_app() 真正執行、把 _apps 填上東西之前就先通過了檢查，
# 導致第二個 thread 呼叫 initialize_app() 時撞見「the default Firebase app
# already exists」例外（pilot 實測跑 word_img 時就撞見過一次）。改成雙重檢查
# 鎖定（跟 fastAPI/routes/keyed_cache.py 的 KeyedCache._lock_for 同一種模式），
# 只有第一個拿到鎖的 thread 真的執行初始化，其餘等鎖釋放後看到
# _firebase_initialized 已經是 True 就直接返回。
_init_lock = threading.Lock()


def ensure_firebase_initialized() -> None:
    global _firebase_initialized
    if _firebase_initialized:
        return
    with _init_lock:
        if _firebase_initialized:
            return
        sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
        if not sa_path:
            raise EnvironmentError(
                "FIREBASE_SERVICE_ACCOUNT_PATH 未設定，"
                "請在 .env 填入 Firebase 服務帳戶金鑰路徑。"
            )
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            cred = credentials.Certificate(sa_path)
            # storageBucket 沿用前端 firebase.js 已經在讀的 VITE_FIREBASE_STORAGE_BUCKET，
            # 不另外開一個後端專用變數——這是同一個 Firebase 專案的同一個 bucket，
            # 沒有 VITE_ 前綴會誤導人以為要重新申請一組值（跟 migrate_quiz_level12_to_db.py
            # 讀 VITE_CLOUDINARY_CLOUD_NAME 是同一個理由）。沒設定時仍可初始化，只有真的
            # 呼叫 storage.bucket() 且沒帶 bucket 名稱時才會出錯，不影響其他既有功能。
            options = {}
            storage_bucket = os.getenv("VITE_FIREBASE_STORAGE_BUCKET")
            if storage_bucket:
                options["storageBucket"] = storage_bucket
            firebase_admin.initialize_app(cred, options)
        _firebase_initialized = True
