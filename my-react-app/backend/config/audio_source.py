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

_DEFAULT_ILRDF_AUDIO_API = "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"


def get_ilrdf_audio_api() -> str:
    return os.getenv("AUDIO_FILE_URL") or _DEFAULT_ILRDF_AUDIO_API
