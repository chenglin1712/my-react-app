"""FastAPI 測試共用設定。"""
import time

import pytest

from fastAPI import background_refresh


@pytest.fixture(autouse=True)
def _no_leaked_background_refresh():
    """lifespan 會開啟背景刷新模式；測試結束後要確認它已關閉，並等還在跑的背景執行緒結束，
    免得它們晚一步寫回快取、蓋掉下一個測試設定好的值（稽核 BE4-06 的驗證建議）。"""
    yield
    background_refresh.disable()
    deadline = time.monotonic() + 3
    while background_refresh._running and time.monotonic() < deadline:
        time.sleep(0.01)
