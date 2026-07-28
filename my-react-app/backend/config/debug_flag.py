"""DJANGO_DEBUG 環境變數判斷單一資料來源。

原本 core/settings.py、config/auth_flags.py、dictionary_db/connect.py、
fastAPI/main.py、fastAPI/routes/dictionary/audio_proxy.py 各自重複寫
`os.getenv("DJANGO_DEBUG", "False") == "True"`。auth_dev_bypass() 那一段
「要不要略過驗證」的互鎖邏輯已經集中在 config/auth_flags.py，但單純判斷
「現在是不是 debug 模式」這件事本身沒有一併集中，這裡補上。

命名沿用 DJANGO_DEBUG（即使是 FastAPI 端在讀）：這個旗標從一開始就是
兩服務共用同一份根目錄 .env 的設計，改名只會讓兩邊要多維護一個對應關係。
"""
import os


def is_debug() -> bool:
    return os.getenv("DJANGO_DEBUG", "False") == "True"
