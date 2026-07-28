"""AUTH_DEV_BYPASS／DEBUG 互鎖邏輯單一資料來源。

原本 Django（core/settings.py）與 FastAPI（fastAPI/routes/auth.py 的
_auth_dev_bypass）各自獨立實作同一段「是否略過 Firebase token 驗證」的判斷，
兩邊分開改容易漏改一邊，也各自沒有直接對這段邏輯寫測試（都是間接被其他測試
覆蓋到）。抽成這裡的 auth_dev_bypass()，兩邊都改成呼叫這個函式，也讓這段邏輯
本身可以直接被單獨測試（見 config/tests.py）。

DEBUG 與 AUTH_DEV_BYPASS 故意分開兩個環境變數：DEBUG 只應該控制錯誤訊息詳細度／
SQL echo 這類「除錯資訊」，不該同時是「要不要驗證身份」的開關——否則正式環境若
誤把 DJANGO_DEBUG 設成 True，會在完全沒人注意到的情況下讓全站認證形同虛設。
要略過驗證必須另外明確設定旗標，且僅在 DEBUG 也是 True 時才生效（雙重確認，
避免正式環境誤設 AUTH_DEV_BYPASS=True 卻忘記同時把 DEBUG 打開）。
"""
import os

from config.debug_flag import is_debug


def auth_dev_bypass(flag_env: str = "AUTH_DEV_BYPASS") -> bool:
    """flag_env 讓呼叫端指定要讀哪個環境變數。Django／FastAPI 預設共用同一份根目錄
    .env，共用 AUTH_DEV_BYPASS 這個旗標，本機開發沒辦法只繞過其中一個服務的驗證。
    呼叫端可以額外指定自己專屬的旗標（例如 FastAPI 傳入 "FASTAPI_AUTH_DEV_BYPASS"），
    該旗標有明確設定時優先生效，沒有設定則沿用共用的 AUTH_DEV_BYPASS，維持原本
    「兩服務共用一份設定」的預設行為不變。
    """
    if not is_debug():
        return False
    if flag_env != "AUTH_DEV_BYPASS":
        override = os.getenv(flag_env)
        if override is not None:
            return override == "True"
    return os.getenv("AUTH_DEV_BYPASS", "False") == "True"
