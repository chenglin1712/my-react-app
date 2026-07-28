"""測試 config/cors.py：原本 Django（core/settings.py）與 FastAPI（fastAPI/main.py）
各自寫了一份一模一樣的 ALLOWED_ORIGINS 讀取邏輯（同樣的預設值、同樣的
`os.getenv(key) or default` 防呆、同樣的逗號分隔+strip），這裡統一成一處讀取。
"""
from config.cors import get_allowed_origins


def test_falls_back_to_known_default_when_unset(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert get_allowed_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_falls_back_to_default_when_env_var_blank(monkeypatch):
    # .env.example 留空當範本時，os.getenv(key, default) 的 default 不會生效
    # （key 有出現、只是值是空字串），這裡用 `or` 確保空字串一樣退回預設值。
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    assert get_allowed_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_uses_env_var_when_set(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example.com, https://foo.example.com")
    assert get_allowed_origins() == ["https://example.com", "https://foo.example.com"]
