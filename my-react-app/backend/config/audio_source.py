"""ILRDF 音檔下載 API 網址單一資料來源。

原本這個網址被寫成三種形式：dictionary/audio_proxy.py 的正式路徑
（proxy_audio）用寫死的 Python 常數 ILRDF_AUDIO_API；同一個檔案的除錯路徑
（debug_audio）跟 quiz.py 的語音比對功能（fetch_audio_from_id）卻改讀環境
變數。三者目前剛好是同一個值，但網址一旦更換，只改了環境變數的話，
寫死常數那條路徑（也就是全站辭典發音播放實際在走的路徑）會安靜地繼續打
舊網址。這裡統一成一個地方讀取，環境變數沒設定時退回目前這個已知可用的
網址（維持 proxy_audio 原本「不設定也能動」的行為，不強制要求設定）。

環境變數改名為 AUDIO_FILE_URL（拿掉 VITE_ 前綴）：這是後端專用設定，
從未被前端讀取過，VITE_ 前綴只會誤導人以為 Vite 會把它打包進前端 bundle
（跟 CLOUD_API_KEY 當初改名是同一個理由）。
"""
import os
import re
from urllib.parse import quote

_DEFAULT_ILRDF_AUDIO_API = "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"


def get_ilrdf_audio_api() -> str:
    return os.getenv("AUDIO_FILE_URL") or _DEFAULT_ILRDF_AUDIO_API


# file_id／audio_id 會被接在 ILRDF 下載網址後面。沒有格式限制時，登入使用者可以放進斜線、?、#、%2e%2e，
# 讓伺服器對固定主機發出路徑或查詢字串不同的 GET（稽核 FIL-1）。三個入口（辭典音檔代理、除錯端點、
# 發音比對）共用同一個規則。
AUDIO_ID_PATTERN = r"^[A-Za-z0-9._-]+$"
AUDIO_ID_MAX_LENGTH = 128
_AUDIO_ID_RE = re.compile(AUDIO_ID_PATTERN)


def is_valid_audio_id(audio_id: object) -> bool:
    """只允許英數、底線、連字號與點；拒絕 "." 與 ".."（接在目錄網址後會變成路徑遍歷）。
    用 fullmatch 比對：`$` 會放過結尾的換行字元。
    """
    return (
        isinstance(audio_id, str)
        and 0 < len(audio_id) <= AUDIO_ID_MAX_LENGTH
        and _AUDIO_ID_RE.fullmatch(audio_id) is not None
        and audio_id not in (".", "..")
    )


def build_ilrdf_audio_url(audio_id: str) -> str:
    """組出 ILRDF 的下載網址。先驗證格式，再用 quote 編碼（雙重保險：即使規則日後放寬，
    也不會讓特殊字元改變路徑結構）。格式不合法丟 ValueError，呼叫端不應該走到這裡。"""
    if not is_valid_audio_id(audio_id):
        raise ValueError("音檔代號格式不合法")
    return get_ilrdf_audio_api() + quote(audio_id, safe="")
