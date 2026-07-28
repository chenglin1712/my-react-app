"""Firebase Admin SDK 初始化，Django 與 FastAPI 共用。

原本 config/firebase_auth.py（Django）與 fastAPI/routes/auth.py（FastAPI）
各自維護一份幾乎相同的 _ensure_firebase，唯一差異是服務帳戶金鑰沒設定時
拋出的例外型別（Django 版拋 EnvironmentError、FastAPI 版拋 HTTPException）——
實際初始化 firebase_admin SDK 的邏輯完全一樣。這裡統一成一份，只拋最原始、
跟框架無關的 EnvironmentError，呼叫端各自接住轉成自己框架慣用的錯誤回應。
"""
import os

_firebase_initialized = False


def ensure_firebase_initialized() -> None:
    global _firebase_initialized
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
        firebase_admin.initialize_app(cred)
    _firebase_initialized = True
