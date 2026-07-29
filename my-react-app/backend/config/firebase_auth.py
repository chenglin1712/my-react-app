"""共用的 Django 端 Firebase ID Token 驗證。

原本 AIModel/views.py、CrosswordPuzzle/views.py 各自維護一份幾乎相同的
_ensure_firebase/verify_firebase_token，crawler app 完全沒有這層防護。
統一抽到這裡，三處都改成 import，避免同一段邏輯（含 AUTH_DEV_BYPASS 判斷）
散落多份、修一處忘了改另一處。

FastAPI 版本介面不同（Header 依賴注入），獨立實作於 backend/fastAPI/routes/auth.py，
但 SDK 初始化本身（ensure_firebase_initialized）已經抽到 config/firebase_init.py
共用，兩邊只有各自把「金鑰沒設定」的例外轉成自己框架慣用的錯誤回應這段不同。
"""
import logging

from django.conf import settings as django_settings
from django.http import JsonResponse

from config.firebase_init import ensure_firebase_initialized

logger = logging.getLogger(__name__)


def verify_firebase_token(request):
    """驗證 Firebase ID Token。AUTH_DEV_BYPASS 模式下跳過驗證（僅限本機開發，見 settings.py）。

    回傳 (decoded_token, error_response)，error_response 非 None 時代表驗證失敗，
    呼叫端應直接把它當成 view 的回傳值。
    """
    if django_settings.AUTH_DEV_BYPASS:
        return {"uid": "dev-user"}, None

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
        decoded = firebase_auth.verify_id_token(token)
        return decoded, None
    except firebase_auth.InvalidIdTokenError:
        # 單一使用者 token 過期／被撤銷／格式不對，是每天都會發生的正常流量，
        # 不記錄也不送 Sentry，避免把告警灌爆。
        return None, JsonResponse({"detail": "身份驗證失敗，請重新登入"}, status=401)
    except Exception:
        # 落到這裡的是 InvalidIdTokenError 以外的例外（憑證抓取失敗、SDK 內部
        # 錯誤等），代表驗證機制本身可能已經整個掛掉，記錄下來讓 Sentry 能告警。
        logger.exception("Firebase ID Token 驗證發生非預期例外")
        return None, JsonResponse({"detail": "身份驗證失敗，請重新登入"}, status=401)
