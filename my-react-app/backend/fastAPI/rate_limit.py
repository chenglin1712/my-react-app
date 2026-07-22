"""共用的 slowapi Limiter。獨立成一個模組，讓 main.py 和各 route 檔案
（vision.py、dictionary.py）都能匯入同一個 limiter 實例，
避免 main.py 匯入 routes、routes 又要匯入 main.py 造成 circular import。

限流計數存放位置：沒設定 REDIS_URL 時用 slowapi 預設的記憶體計數，單一 process
內有效，多 worker 部署時每個 worker 各自計數，實際上限會是「設定值 × worker 數」。
設定 REDIS_URL 後改用 Redis 存放，所有 worker 共用同一份計數，門檻才會如實生效。
跟 Django 端（core/settings.py 的 CACHES）讀同一個環境變數，設定一次同時對兩個
服務生效（先前只有 Django 端接了 REDIS_URL，FastAPI 這邊被漏掉）。
"""
import os

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def rate_limit_key(request: Request) -> str:
    """優先依已登入使用者的 Firebase uid 限速（由 auth.verify_firebase_token 存進
    request.state.user），沒有的話（例如尚未跑過該 dependency）才退回用 IP。"""
    user = getattr(request.state, "user", None)
    if user and user.get("uid"):
        return f"uid:{user['uid']}"
    return get_remote_address(request)


# config_filename 指到不存在的檔案：slowapi 預設會在目前工作目錄找 .env 並用系統預設
# 編碼（Windows 上是 cp1252）讀取來抓它自己的設定（RATELIMIT_ENABLED 等，我們沒用到）。
# 這個專案根目錄的 .env 含非 ASCII 內容，會讓 slowapi 在讀檔時直接以
# UnicodeDecodeError 掛掉。指到不存在的檔名讓它略過讀取（Starlette Config 對不存在
# 的 env_file 只會 warn，不會噴例外）。
limiter = Limiter(
    key_func=rate_limit_key,
    config_filename="__slowapi_no_dotenv__",
    storage_uri=os.getenv("REDIS_URL"),  # 未設定時是 None，slowapi 退回預設的記憶體儲存
)
