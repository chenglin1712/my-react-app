"""使用者管理端點的輸入驗證與 Firebase 錯誤訊息整理（稽核 BE2a-12／13、BE1-05）。"""
import logging

from django.http import JsonResponse

logger = logging.getLogger(__name__)

# 與 firestore.rules 的 userFieldsValid 一致，後台寫入的值前台本人之後也改得動
NAME_MAX = 100
IDENTITY_MAX = 100
AVATAR_URL_MAX = 8192
EMAIL_MAX = 254
PASSWORD_MAX = 128


def text_field(data, key, label, *, max_len, default=""):
    """取出字串欄位：沒帶或 null 用 default；不是字串或太長回 400。回傳 (已 strip 的值, 錯誤回應)。"""
    raw = data.get(key)
    if raw is None:
        return default, None
    if not isinstance(raw, str):
        return None, JsonResponse({"detail": f"{label}格式錯誤"}, status=400)
    value = raw.strip()
    if len(value) > max_len:
        return None, JsonResponse({"detail": f"{label}不可超過 {max_len} 個字元"}, status=400)
    return value, None


def mask_email(value):
    """稽核紀錄只留遮罩後的 email（a***@example.com），刪除帳號之後紀錄裡不會留下完整個資。"""
    if not isinstance(value, str) or "@" not in value:
        return value
    local, _, domain = value.partition("@")
    return f"{local[:1]}***@{domain}"


_FIREBASE_MESSAGES = {
    "INVALID_EMAIL": "email 格式不正確",
    "WEAK_PASSWORD": "密碼強度不足",
    "ALREADY_EXISTS": "這個 email 已經被使用",
    "EMAIL_ALREADY_EXISTS": "這個 email 已經被使用",
    "INVALID_ARGUMENT": "輸入的資料格式不正確",
}


def firebase_error_message(exc) -> str:
    """把 Firebase Admin SDK 的例外轉成固定的中文訊息；完整例外只寫伺服器日誌，不回給前端。"""
    logger.warning("Firebase 拒絕了操作：%s", type(exc).__name__, exc_info=exc)
    if isinstance(exc, ValueError):
        return "輸入的資料格式不正確（請檢查 email 與密碼）"
    code = str(getattr(exc, "code", "") or "").upper()
    return _FIREBASE_MESSAGES.get(code, "Firebase 拒絕了這個操作，請檢查輸入後再試")
