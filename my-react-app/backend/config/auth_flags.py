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
import ipaddress
import os
import shlex

from config.debug_flag import is_debug

_LOOPBACK_NAMES = frozenset({"localhost"})


def _is_loopback_host(host: str) -> bool:
    host = host.strip().strip("[]").lower()
    if host in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _bind_hosts_from_argv(argv):
    """從啟動指令列取出會對外監聽的位址：runserver 的位址參數、gunicorn 的 --bind／-b。
    runserver 只給埠號（或省略位址）時是預設的 127.0.0.1，不算。"""
    hosts = []
    args = list(argv or [])
    # gunicorn 也會讀 GUNICORN_CMD_ARGS 環境變數裡的參數（例如 --bind）
    try:
        args += shlex.split(os.getenv("GUNICORN_CMD_ARGS", ""), posix=True)
    except ValueError:
        pass                                          # 引號沒配對：gunicorn 自己也解析不了，這裡不另外處理
    for index, arg in enumerate(args):
        value = None
        if arg in ("--bind", "-b") and index + 1 < len(args):
            value = args[index + 1]
        elif arg.startswith("--bind="):
            value = arg.split("=", 1)[1]
        elif arg == "runserver":
            following = [a for a in args[index + 1:] if not a.startswith("-")]
            value = following[0] if following else None
        if not value:
            continue
        host = value.rsplit(":", 1)[0] if ":" in value and not value.endswith("]") else value
        if value.isdigit() or not host:
            continue                                  # 只有埠號：預設綁 127.0.0.1
        hosts.append(host)
    return hosts


def dev_bypass_exposure_problem(allowed_hosts, argv=None, allow_nonloopback_bind: bool = False):
    """AUTH_DEV_BYPASS 生效時，Django 會把每個請求都當成 owner。目前能保持安全，只因為它同時需要
    DJANGO_DEBUG=True；這裡再加一道啟動斷言（稽核 MSC-3）：只要設定顯示這個服務可能被本機以外的人連到，
    就拒絕啟動——ALLOWED_HOSTS 含非 loopback 的主機（含 "*"），或啟動指令綁在非 loopback 位址。
    有問題回傳說明文字，沒問題回傳 None。

    allow_nonloopback_bind 只放行「綁定位址」這一項，給開發用的 docker-compose 使用（容器內必須綁 0.0.0.0，
    對外的埠號只發布到宿主機的 127.0.0.1）；ALLOWED_HOSTS 的檢查不可略過。"""
    outside_hosts = [h for h in allowed_hosts if not _is_loopback_host(str(h))]
    if outside_hosts:
        return (
            "AUTH_DEV_BYPASS 為真時，ALLOWED_HOSTS 只能包含本機位址（localhost、127.0.0.1、::1），"
            f"目前還有：{', '.join(map(str, outside_hosts))}。AUTH_DEV_BYPASS 會讓每個請求都當成 owner，"
            "請關閉它，或移除這些主機。"
        )
    if not allow_nonloopback_bind:
        outside_binds = [h for h in _bind_hosts_from_argv(argv) if not _is_loopback_host(h)]
        if outside_binds:
            return (
                "AUTH_DEV_BYPASS 為真時，服務只能綁在本機位址（127.0.0.1、localhost、::1），"
                f"目前綁在：{', '.join(outside_binds)}。請改綁 127.0.0.1，或關閉 AUTH_DEV_BYPASS。"
            )
    return None


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
