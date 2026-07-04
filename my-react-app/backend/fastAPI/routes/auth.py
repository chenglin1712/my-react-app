"""
FastAPI 版本的 Firebase ID Token 驗證。

邏輯與 backend/AIModel/views.py 的 verify_firebase_token 一致（兩邊共用同一份根目錄
.env）：DJANGO_DEBUG=True 時跳過驗證（本機開發用），DJANGO_DEBUG=False（正式環境）
則要求帶有效的 Authorization: Bearer <Firebase ID Token>。
"""
import os

from fastapi import Header, HTTPException

_firebase_initialized = False


def _ensure_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return
    sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    if not sa_path:
        raise HTTPException(
            status_code=503,
            detail="FIREBASE_SERVICE_ACCOUNT_PATH 未設定，請在 .env 填入 Firebase 服務帳戶金鑰路徑。",
        )
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)
    _firebase_initialized = True


async def verify_firebase_token(authorization: str = Header(default=None)):
    """FastAPI 依賴注入：驗證 Authorization: Bearer <token>。

    掛在 include_router(..., dependencies=[Depends(verify_firebase_token)])，
    對整個 router 底下的所有端點生效，不需逐一修改每個函式簽名。
    """
    if os.getenv("DJANGO_DEBUG", "False") == "True":
        return {"uid": "dev-user"}

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="需要登入才能使用此功能")

    token = authorization[len("Bearer "):]
    _ensure_firebase()
    from firebase_admin import auth as firebase_auth

    try:
        return firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")
