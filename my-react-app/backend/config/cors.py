"""允許的跨來源清單（ALLOWED_ORIGINS），Django 與 FastAPI 共用。

兩邊原本各自寫了一份一模一樣的邏輯：讀 .env 的 ALLOWED_ORIGINS（逗號分隔）、
本機開發預設放行 Vite 的 5173（localhost／127.0.0.1 兩種寫法），用
`os.getenv(key) or default` 而非 `os.getenv(key, default)`——後者的 default
只有在 key 完全沒出現在環境變數裡才生效，.env.example 留空字串當範本一樣算
「有出現」，會變成空白名單擋掉所有跨來源請求。
"""
import logging
import os

from config.debug_flag import is_debug

_DEFAULT_DEV_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def get_allowed_origins() -> list:
    raw = os.getenv("ALLOWED_ORIGINS") or _DEFAULT_DEV_ORIGINS
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    # 稽核 BE4-17：萬用字元 "*" 會讓任何網站都能從瀏覽器呼叫 API。非除錯環境一律拒絕，
    # 其餘來源照常生效，並大聲記錄，讓人看得到設定錯了。
    if "*" in origins and not is_debug():
        logging.getLogger(__name__).error(
            "ALLOWED_ORIGINS 含有萬用字元 '*'，正式環境已忽略；請改列出實際的網站來源"
        )
        origins = [o for o in origins if o != "*"]
    return origins
