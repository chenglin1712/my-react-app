"""Django ↔ FastAPI 內部端點（/internal/*）共用的設定檢查（稽核 DEP-7）。

兩個服務靠共用密鑰 INTERNAL_API_SECRET 互相呼叫。這裡集中兩條規則，Django 的呼叫端、啟動檢查與
FastAPI 的密鑰驗證都用同一份，避免各自寫一個略有差異的版本：
1. 密鑰至少 MIN_SECRET_LENGTH 字元。只檢查「非空」的話，`1234` 也算設定好了，而這個密鑰是唯一擋住
   「任何人都能叫 FastAPI 清快取／重新預熱」的東西。產生方式：python -c "import secrets; print(secrets.token_urlsafe(48))"
2. Django 呼叫 FastAPI 的位址（FASTAPI_INTERNAL_BASE_URL）若是 http，主機必須是本機（loopback）。
   密鑰放在 X-Internal-Secret 標頭裡，http 加上非本機位址就是把它明文送過網路；要跨主機請用 https。
"""
import ipaddress
from urllib.parse import urlparse

MIN_SECRET_LENGTH = 32


def secret_problem(secret):
    """回傳密鑰不合格的原因；沒設定（空字串／None）不算不合格——代表「這個功能沒開」，由呼叫端自行處理。"""
    if not secret:
        return None
    if len(secret) < MIN_SECRET_LENGTH:
        return f"INTERNAL_API_SECRET 太短（{len(secret)} 字元），至少需要 {MIN_SECRET_LENGTH} 字元"
    return None


def _is_loopback_host(hostname):
    if not hostname:
        return False
    if hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def base_url_problem(url):
    """回傳位址不合格的原因，合格回傳 None。只接受 https，或主機為本機的 http。"""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        parsed.port  # 埠號不合法時這裡會丟 ValueError
    except ValueError:
        return f"FASTAPI_INTERNAL_BASE_URL 格式不正確：{url!r}"
    if parsed.username or parsed.password:
        return "FASTAPI_INTERNAL_BASE_URL 不可以夾帶帳號密碼"
    if parsed.scheme == "https" and hostname:
        return None
    if parsed.scheme == "http" and _is_loopback_host(hostname):
        return None
    if parsed.scheme == "http":
        return (
            f"FASTAPI_INTERNAL_BASE_URL 是非本機的 http 位址（{hostname}），密鑰會以明文傳輸；"
            "請改用 https，或指向 127.0.0.1／localhost"
        )
    return f"FASTAPI_INTERNAL_BASE_URL 必須是 https，或本機的 http：{url!r}"


def configuration_problems(env):
    """啟動時一次檢查兩項設定，回傳問題清單（空清單＝沒問題）。env 是 os.environ 或同形的 dict。"""
    problems = []
    secret_issue = secret_problem(env.get("INTERNAL_API_SECRET", ""))
    if secret_issue:
        problems.append(secret_issue)
    url = env.get("FASTAPI_INTERNAL_BASE_URL", "")
    if url:
        url_issue = base_url_problem(url)
        if url_issue:
            problems.append(url_issue)
    return problems
