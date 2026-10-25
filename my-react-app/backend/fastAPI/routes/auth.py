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

from fastapi import Header, HTTPException, Request

from config.auth_flags import auth_dev_bypass
from config.firebase_init import ensure_firebase_initialized
from fastAPI import feature_flags, guest_trial

logger = logging.getLogger(__name__)


def _auth_dev_bypass() -> bool:
    return auth_dev_bypass("FASTAPI_AUTH_DEV_BYPASS")


async def verify_firebase_token(request: Request, authorization: str = Header(default=None)):
    """FastAPI 依賴注入：驗證 Authorization: Bearer <token>。

    掛在 include_router(..., dependencies=[Depends(verify_firebase_token)])，
    對整個 router 底下的所有端點生效，不需逐一修改每個函式簽名。

    順便把解出來的使用者資料存進 request.state.user，讓 slowapi 的
    key_func（main.py 的 _rate_limit_key）可以依 uid 做每位使用者速率限制，
    不必再解一次 token。
    """
    if _auth_dev_bypass():
        user = {"uid": "dev-user"}
        request.state.user = user
        return user

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="需要登入才能使用此功能")

    token = authorization[len("Bearer "):]
    try:
        ensure_firebase_initialized()
    except EnvironmentError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        # 憑證檔案存在但損毀／格式錯誤等其他初始化失敗，同樣代表驗證機制掛掉，
        # 記錄下來讓 Sentry 能告警，並乾淨地回 503，而不是讓例外未經處理地往外拋
        # （Django 端 core/firebase_auth.py 同一種情境曾經因為 import 順序問題
        # 直接變成 UnboundLocalError，這裡雖然不會崩潰，但同樣該給乾淨的 503）。
        logger.exception("Firebase 初始化發生非預期例外")
        raise HTTPException(status_code=503, detail="身份驗證服務暫時無法使用，請稍後再試")
    from firebase_admin import auth as firebase_auth

    try:
        # verify_id_token 是同步呼叫，快取的公鑰過期那一刻會發生阻塞式網路請求
        # （向 Google 重新抓憑證）。這個依賴掛在幾乎所有路由上，跟 dictionary.py
        # 冷快取那個問題同類但影響範圍更廣、單次影響更小——丟到執行緒池執行，
        # 避免卡住 event loop。
        #
        # check_revoked=True：跟 Django 端 core/firebase_auth.py 同一個修正、
        # 同一個理由——預設的 verify_id_token() 不查 refresh token 撤銷時間或
        # 帳號停權狀態，少了這個旗標，強制登出/停權/收回角色之後，對方手上
        # 舊 token 在到期前仍能通過驗證（獨立審查找到的問題）。
        user = await asyncio.to_thread(firebase_auth.verify_id_token, token, check_revoked=True)
    except (firebase_auth.InvalidIdTokenError, firebase_auth.UserDisabledError):
        # 單一使用者 token 過期／被撤銷／格式不對／帳號已被停權，是每天都會
        # 發生的正常流量，不記錄也不送 Sentry，避免把告警灌爆。
        # UserDisabledError 不是 InvalidIdTokenError 的子類別（各自獨立繼承自
        # InvalidArgumentError），必須明確列出來，否則會落到下面被誤記成
        # 非預期例外。
        raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")
    except Exception:
        # 落到這裡的是上面兩種以外的例外（憑證抓取失敗、SDK 內部錯誤等），
        # 代表驗證機制本身可能已經整個掛掉，記錄下來讓 Sentry 能告警——原本
        # 這裡完全沒有 log，Firebase 驗證若整個掛掉，全站需登入端點會靜默
        # 401，看起來像是使用者沒登入，而不是系統故障。
        logger.exception("Firebase ID Token 驗證發生非預期例外")
        raise HTTPException(status_code=401, detail="身份驗證失敗，請重新登入")

    request.state.user = user
    return user


GUEST_FLAG_KEY = "guest_translation_enabled"
GUEST_TOKEN_INVALID_CODE = "guest_token_invalid"


class GuestTokenError(HTTPException):
    """訪客憑證缺少、格式錯誤、簽章不符或已過期。專屬的子類別讓 main.py 能回傳帶機器可讀 code 的 401，
    前端看到這個 code 才會向後端換領新憑證並重試一次（其他 401 不處理，避免誤判登入失敗）。"""

    def __init__(self):
        super().__init__(status_code=401, detail="訪客憑證無效或已過期，請重新整理頁面")


async def verify_firebase_token_or_guest(
    request: Request,
    authorization: str = Header(default=None),
    x_guest_token: str = Header(default=None),
):
    """翻譯 router 專用：已登入走原本的驗證；完全沒帶登入憑證的請求，在訪客試用開放時
    以「訪客」身分通過（C-2）。

    - 帶了 Authorization 就一律照原本驗證，失敗回 401，**不會降級成訪客**——否則 token 過期的
      已登入使用者會悄悄變成吃訪客額度，看起來像額度變少。
    - 訪客必須帶 X-Guest-Token：由伺服器核發並簽章的憑證（見 guest_trial.issue_token）。前端自己產生的代號
      不再被接受；憑證缺少、簽章不符、格式錯誤或過期都回 401（code=guest_token_invalid）。
    - 訪客試用要同時滿足：旗標 guest_translation_enabled 開啟（查不到、或旗標表超過 2 分鐘沒能更新，視為關閉）、
      資料庫與 GUEST_TRIAL_SECRET 就緒。任一不滿足都回沒有 code 的 401，行為與 C-2 之前完全相同，
      前端也不會因此一直重試。
    - 訪客的 request.state.user 沒有 uid，所以 rate_limit_key 會退回用 IP 做每分鐘限流。
    """
    if authorization or _auth_dev_bypass():
        return await verify_firebase_token(request, authorization)

    if not feature_flags.is_enabled_fail_closed(GUEST_FLAG_KEY) or not guest_trial.is_ready():
        raise HTTPException(status_code=401, detail="需要登入才能使用此功能")

    parsed = guest_trial.verify_token(x_guest_token)
    if parsed is None:
        raise GuestTokenError()

    user = {"uid": "", "guest": True, "guest_id": parsed.guest_id}
    request.state.user = user
    return user
