"""
FastAPI 版本的 Firebase ID Token 驗證。

邏輯與 backend/AIModel/views.py 的 verify_firebase_token 一致：AUTH_DEV_BYPASS=True
（且 DJANGO_DEBUG=True）時跳過驗證（僅限本機開發），否則要求帶有效的
Authorization: Bearer <Firebase ID Token>。故意跟 DJANGO_DEBUG 分開成獨立旗標，
避免正式環境誤設 DEBUG=True 就連帶讓認證形同虛設。

互鎖判斷邏輯與 Django 端共用（見 config/auth_flags.py）。兩服務預設共用同一份根目錄
.env 的 AUTH_DEV_BYPASS；本機開發若想讓 FastAPI 走真實驗證、只繞過 Django（或反過來），
可以額外設定 FASTAPI_AUTH_DEV_BYPASS，設定時優先於共用的 AUTH_DEV_BYPASS 生效。
"""
import asyncio
import logging
import os

from fastapi import Header, HTTPException, Request

from config.auth_flags import auth_dev_bypass

logger = logging.getLogger(__name__)

_firebase_initialized = False


def _auth_dev_bypass() -> bool:
    return auth_dev_bypass("FASTAPI_AUTH_DEV_BYPASS")


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


async def verify_firebase_token(request: Request, authorization: str = Header(default=None)):
    """FastAPI 依賴注入：驗證 Authorization: Bearer <token>。

    掛在 include_router(..., dependencies=[Depends(verify_firebase_token)])，
    對整個 router 底下的所有端點生效，不需逐一修改每個函式簽名。

    順便把解出來的使用者資料存進 request.state.user，讓 slowapi 的
    key_func（main.py 的 _rate_limit_key）可以依 uid 做每用戶速率限制，
    不必再解一次 token。
    """
    if _auth_dev_bypass():
        user = {"uid": "dev-user"}
        request.state.user = user
        return user

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="需要登入才能使用此功能")

    token = authorization[len("Bearer "):]
    _ensure_firebase()
    from firebase_admin import auth as firebase_auth

    try:
        # verify_id_token 是同步呼叫，快取的公鑰過期那一刻會發生阻塞式網路請求
        # （向 Google 重新抓憑證）。這個依賴掛在幾乎所有路由上，跟 dictionary.py
        # 冷快取那個問題同類但影響範圍更廣、單次影響更小——丟到執行緒池執行，
        # 避免卡住 event loop。
        user = await asyncio.to_thread(firebase_auth.verify_id_token, token)
    except firebase_auth.InvalidIdTokenError:
        # 單一使用者 token 過期／被撤銷／格式不對，是每天都會發生的正常流量，
        # 不記錄也不送 Sentry，避免把告警灌爆。
        raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")
    except Exception:
        # 落到這裡的是 InvalidIdTokenError 以外的例外（憑證抓取失敗、SDK 內部
        # 錯誤等），代表驗證機制本身可能已經整個掛掉，記錄下來讓 Sentry 能告警——
        # 原本這裡完全沒有 log，Firebase 驗證若整個掛掉，全站需登入端點會靜默
        # 401，看起來像是使用者沒登入，而不是系統故障。
        logger.exception("Firebase ID Token 驗證發生非預期例外")
        raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")

    request.state.user = user
    return user
