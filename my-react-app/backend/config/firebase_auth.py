"""共用的 Django 端 Firebase ID Token 驗證。

原本 AIModel/views.py、CrosswordPuzzle/views.py 各自維護一份幾乎相同的
_ensure_firebase/verify_firebase_token，crawler app 完全沒有這層防護。
統一抽到這裡，三處都改成 import，避免同一段邏輯（含 AUTH_DEV_BYPASS 判斷）
散落多份、修一處忘了改另一處。

FastAPI 版本邏輯相同但介面不同（Header 依賴注入），維持獨立實作於
backend/fastAPI/routes/auth.py。
"""
import os

from django.conf import settings as django_settings
from django.http import JsonResponse

_firebase_initialized = False


def _ensure_firebase():
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
    try:
        _ensure_firebase()
        from firebase_admin import auth as firebase_auth
        decoded = firebase_auth.verify_id_token(token)
        return decoded, None
    except EnvironmentError as e:
        return None, JsonResponse({"detail": str(e)}, status=503)
    except Exception:
        return None, JsonResponse({"detail": "身份驗證失敗，請重新登入"}, status=401)
