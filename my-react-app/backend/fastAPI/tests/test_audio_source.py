"""測試 config/audio_source.py：原本 ILRDF 音檔下載網址被寫成三種形式
（dictionary/audio_proxy.py 正式路徑用寫死常數、同檔案除錯路徑跟 quiz.py
改讀環境變數 VITE_AUDIO_FILE_URL），改名為 AUDIO_FILE_URL 並統一成一處讀取。
"""
from config.audio_source import get_ilrdf_audio_api


def test_falls_back_to_known_default_when_unset(monkeypatch):
    monkeypatch.delenv("AUDIO_FILE_URL", raising=False)
    assert get_ilrdf_audio_api() == "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"


def test_falls_back_to_default_when_env_var_blank(monkeypatch):
    # .env.example 留空當範本時，os.getenv(key, default) 的 default 不會生效
    # （key 有出現、只是值是空字串），這裡用 `or` 確保空字串一樣退回預設值，
    # 跟 ALLOWED_ORIGINS/CSRF_TRUSTED_ORIGINS 同一套防呆邏輯。
    monkeypatch.setenv("AUDIO_FILE_URL", "")
    assert get_ilrdf_audio_api() == "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"


def test_uses_env_var_when_set(monkeypatch):
    monkeypatch.setenv("AUDIO_FILE_URL", "https://example.invalid/custom/")
    assert get_ilrdf_audio_api() == "https://example.invalid/custom/"
