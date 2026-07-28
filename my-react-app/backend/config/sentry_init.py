"""Sentry 初始化，Django 與 FastAPI 共用。

原本 core/settings.py（Django）與 fastAPI/main.py（FastAPI）各自複製貼上一份
幾乎相同的 sentry_sdk.init(...)——dsn 讀取、environment 預設值邏輯、
traces_sample_rate、send_default_pii、LoggingIntegration 全部一樣，只有
框架專屬的 integrations（DjangoIntegration vs StarletteIntegration+
FastApiIntegration）不同。FastAPI 端原本的註解甚至寫著「與 Django 端
core/settings.py 同一套邏輯」，等於承認了這是重複——這裡統一成一份。
"""
import os
from typing import Callable, List

from config.debug_flag import is_debug


def init_sentry(build_extra_integrations: Callable[[], List]) -> None:
    """SENTRY_DSN 沒設定時完全不做事（維持原行為）。build_extra_integrations
    是無參數 callable，回傳該框架專屬的 integrations 清單，只有在真的要初始化
    Sentry 時才會被呼叫，避免沒用到 Sentry 時也匯入框架專屬的 integration 模組。
    """
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return

    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration

    debug = is_debug()
    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production" if not debug else "development"),
        integrations=[
            *build_extra_integrations(),
            # 結構化 log（config/logging.py）本來就會記錄的 ERROR 等級以上訊息，
            # 一併送一份到 Sentry 當成事件，不用另外在每個 view/端點補呼叫。
            LoggingIntegration(level=None, event_level="ERROR"),
        ],
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0")),
        send_default_pii=False,
    )
