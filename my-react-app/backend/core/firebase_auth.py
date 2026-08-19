"""共用的 Django 端 Firebase ID Token 驗證。

原本 AIModel/views.py、CrosswordPuzzle/views.py 各自維護一份幾乎相同的
_ensure_firebase/verify_firebase_token，crawler app 完全沒有這層防護。
統一抽到這裡，三處都改成 import，避免同一段邏輯（含 AUTH_DEV_BYPASS 判斷）
散落多份、修一處忘了改另一處。

FastAPI 版本介面不同（Header 依賴注入），獨立實作於 backend/fastAPI/routes/auth.py，
但 SDK 初始化本身（ensure_firebase_initialized）已經抽到 config/firebase_init.py
共用，兩邊只有各自把「金鑰沒設定」的例外轉成自己框架慣用的錯誤回應這段不同。

原本放在 backend/config/ 底下，但這支檔案從頭到尾都是 Django-only（用
django.conf.settings／django.http.JsonResponse／request.META），跟
config/firebase_init.py 那層真正框架無關的 SDK 初始化性質不同——config/
定位是 Django/FastAPI 共用層，這支檔案放在那裡容易讓人誤以為兩邊都能用
（見 P4 review BE-9）。搬到 backend/core/（Django 專案層，AIModel／
CrosswordPuzzle／crawler／adminapi 這些 Django app 本來就已經依賴 core 的
其他東西，不會像搬進 adminapi/ 那樣製造出新的、跟 BE-8 同一類的隱性耦合）。
這次搬移沒有拆分任何邏輯，函式簽名與行為完全不變。
"""
import logging
import os

from django.conf import settings as django_settings
from django.http import JsonResponse

from config.firebase_init import ensure_firebase_initialized

logger = logging.getLogger(__name__)

# AUTH_DEV_BYPASS 模式下要假裝成哪個角色，預設給最高權限（owner）——本機開發
# 情境下開發者通常想直接看到完整後台介面，而不是先手動設定 Firebase custom
# claim 才能測。真的想測「某個角色被擋住」的情境，可另外設定這個環境變數成
# 較低權限的角色（例如 "editor"）。這個旗標只在 AUTH_DEV_BYPASS=True 時才有
# 意義，正式環境不會用到。
_DEV_BYPASS_ROLE = os.getenv("AUTH_DEV_BYPASS_ROLE", "owner")


def verify_firebase_token(request):
    """驗證 Firebase ID Token。AUTH_DEV_BYPASS 模式下跳過驗證（僅限本機開發，見 settings.py）。

    回傳 (decoded_token, error_response)，error_response 非 None 時代表驗證失敗，
    呼叫端應直接把它當成 view 的回傳值。
    """
    if django_settings.AUTH_DEV_BYPASS:
        return {"uid": "dev-user", "role": _DEV_BYPASS_ROLE}, None

    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Bearer "):
        return None, JsonResponse({"detail": "需要登入才能使用此功能"}, status=401)
    token = auth_header[7:]

    # ensure_firebase_initialized() 的例外獨立成一個 try/except：先前這行跟下面
    # 的 import 綁在同一個 try 裡，若丟出的不是 EnvironmentError（例如服務帳戶
    # 金鑰檔案損毀、格式錯誤會丟 ValueError），import 永遠不會執行到，緊接著的
    # `except firebase_auth.InvalidIdTokenError` 子句在比對當下就會因為
    # firebase_auth 這個名字還沒被賦值而丟出 UnboundLocalError，且不會被後面的
    # `except Exception` 接住（比對 except 子句時發生的例外不會回頭試下一個
    # except），導致這條共用邏輯掛在的所有需登入端點都跟著壞掉。
    try:
        ensure_firebase_initialized()
    except EnvironmentError as e:
        # 服務帳戶金鑰沒設定，代表這個部署的驗證機制根本沒接上，記下來讓 Sentry
        # 能告警——原本這裡完全沒有 log，全站需登入端點會靜默回應，看起來像是
        # 使用者沒登入，而不是系統設定有問題。
        logger.error("Firebase 服務帳戶未設定，需登入端點將回應 503：%s", e)
        return None, JsonResponse({"detail": str(e)}, status=503)
    except Exception:
        # 憑證檔案存在但損毀／格式錯誤等其他初始化失敗，同樣代表驗證機制掛掉，
        # 記錄下來讓 Sentry 能告警，並乾淨地回 503，而不是讓例外一路往外拋。
        logger.exception("Firebase 初始化發生非預期例外")
        return None, JsonResponse({"detail": "身份驗證服務暫時無法使用，請稍後再試"}, status=503)

    from firebase_admin import auth as firebase_auth
    try:
        # check_revoked=True：預設的 verify_id_token() 只驗簽章與效期，不查
        # refresh token 是否已被撤銷、帳號是否已被停權。少了這個旗標，管理員
        # 執行「強制登出」、停權帳號、或收回某人的 owner/admin 角色之後，對方
        # 手上舊 token 在到期前（最長約 1 小時）仍會通過這裡的驗證，且 token
        # 內殘留的舊 role claim 一樣能通過後面的 require_role() 檢查——等於
        # 停權/收權完全沒有立即生效（獨立審查找到的問題）。多付出的成本是
        # Admin SDK 每次驗證都要多查一次使用者的 tokensValidAfterTime/disabled
        # 狀態，換來的是撤銷/停權即時生效，這條路徑掛在所有需登入端點上，
        # 這個代價是值得付的。
        decoded = firebase_auth.verify_id_token(token, check_revoked=True)
        return decoded, None
    except (firebase_auth.InvalidIdTokenError, firebase_auth.UserDisabledError):
        # 單一使用者 token 過期／被撤銷／格式不對／帳號已被停權，是每天都會
        # 發生的正常流量，不記錄也不送 Sentry，避免把告警灌爆。
        # UserDisabledError 不是 InvalidIdTokenError 的子類別（兩者是各自獨立
        # 繼承自 InvalidArgumentError），必須明確列出來，否則帳號被停權後產生
        # 的 401 會落到下面的 except Exception，被誤記成「非預期例外」。
        return None, JsonResponse({"detail": "身份驗證失敗，請重新登入"}, status=401)
    except Exception:
        # 落到這裡的是上面兩種以外的例外（憑證抓取失敗、SDK 內部錯誤等），
        # 代表驗證機制本身可能已經整個掛掉，記錄下來讓 Sentry 能告警。
        logger.exception("Firebase ID Token 驗證發生非預期例外")
        return None, JsonResponse({"detail": "身份驗證失敗，請重新登入"}, status=401)


def try_verify_firebase_token(request):
    """盡力解出 uid，不阻擋請求——給允許匿名的公開端點（例如 P5 的使用事件
    記錄 POST /adminapi/public/events/）用。跟 verify_firebase_token 的差異：
    沒帶 token、token 過期/無效、Firebase 尚未設定，一律回傳 None 而不是
    401/503——呼叫端本身就允許匿名，未登入訪客的行為也是分析目標，不能
    因為沒登入就整個請求被擋下來。

    回傳 uid 字串，解不出來時回傳 None。
    """
    if django_settings.AUTH_DEV_BYPASS:
        return "dev-user"

    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]

    try:
        ensure_firebase_initialized()
    except Exception:
        return None

    from firebase_admin import auth as firebase_auth
    try:
        decoded = firebase_auth.verify_id_token(token)
        return decoded.get("uid")
    except Exception:
        return None


def require_role(request, allowed_roles):
    """驗證 Firebase ID Token，並檢查角色是否在 allowed_roles 內（後台管理系統用）。

    先呼叫 verify_firebase_token 驗證登入狀態；沒登入／token 無效時直接把
    verify_firebase_token 原本的錯誤（401/503）原樣傳回去。登入成功但角色
    不在允許清單內，回傳統一格式的 403——不區分「完全沒有後台角色」跟
    「角色不夠高」，避免一般使用者從錯誤訊息內容反推出後台角色分級的存在。

    回傳 (decoded_token, error_response)，用法與 verify_firebase_token 相同：
    error_response 非 None 時代表被擋下，呼叫端應直接把它當成 view 的回傳值。

    allowed_roles 建議傳 config/roles.py 裡定義好的角色群組常數
    （例如 ACCOUNT_MANAGERS、CONTENT_APPROVERS），而不是在呼叫端各自寫死
    一份角色字串清單，避免多處清單互相漂移。
    """
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return None, err_resp

    if decoded.get("role") not in allowed_roles:
        return None, JsonResponse({"detail": "沒有權限執行此操作"}, status=403)

    return decoded, None
