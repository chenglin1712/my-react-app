"""P4 review BE-24：/health（liveness）跟 /ready（readiness）要能分開回報
「process 活著」跟「關鍵快取是否已經預熱完成」；背景預熱 daemon thread 的
jitter 與關閉行為也在這裡驗證（見 fastAPI/main.py 的完整說明）。
"""
from unittest.mock import patch

from fastapi.testclient import TestClient

from fastAPI import main as main_module


def test_health_always_returns_ok_regardless_of_warm_state():
    with TestClient(main_module.app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_returns_503_before_caches_finish_warming():
    """_warm_caches 在背景 thread 執行，關掉 jitter 之後理論上很快就會設
    app.state.caches_warm=True——這裡直接把它擋住（讓其中一個快取的
    warm_cache 睡 1 秒模擬「還在預熱中」的窗口），確認這段期間 /ready
    誠實回報還沒準備好，不是照樣裝忙回 200。"""
    import time

    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
         patch.object(main_module.listening, "warm_cache", side_effect=lambda db: time.sleep(1)):
        with TestClient(main_module.app) as client:
            response = client.get("/ready")
            assert response.status_code == 503
            assert response.json() == {"ready": False}


def test_ready_returns_200_after_caches_finish_warming():
    """不打真正的辭典 DB（listening/sentence/quiz/dictionary 四個
    warm_cache() 全表掃描本機測試資料庫也要好幾秒），全部換成立即回傳的
    假函式，只驗證「四個都跑過一輪之後 caches_warm 會變 True、/ready 會回
    200」這件事本身，不是在測真正的預熱查詢多快。"""
    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
         patch.object(main_module.listening, "warm_cache"), \
         patch.object(main_module.sentence, "warm_cache"), \
         patch.object(main_module.quiz, "warm_cache"), \
         patch.object(main_module.dictionary, "warm_cache"):
        with TestClient(main_module.app) as client:
            for _ in range(50):
                if getattr(client.app.state, "caches_warm", False):
                    break
                __import__("time").sleep(0.05)
            response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"ready": True}


def test_warm_caches_sets_flag_even_when_individual_cache_fails():
    """每個快取各自 try/except，其中一個失敗不影響其餘快取繼續跑，也不影響
    最終 caches_warm 被設成 True——「嘗試過預熱」跟「每個快取都成功」是
    兩件事，/ready 回報的是前者（見 main.py 的說明）。"""
    app = main_module.app
    app.state.caches_warm = False
    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
         patch.object(main_module.listening, "warm_cache", side_effect=RuntimeError("boom")), \
         patch.object(main_module, "SessionLocal") as mock_session_local:
        mock_session_local.return_value.close = lambda: None
        main_module._warm_caches(app)
    assert app.state.caches_warm is True


def test_shutdown_does_not_block_on_still_running_warm_thread():
    """BE-24 修正前 finally 區塊會 join(timeout=2)，讓每一次
    `with TestClient(app):` 進出都多付出最多 2 秒的關閉延遲——這裡直接驗證
    lifespan 關閉不會因為背景執行緒還在跑而卡住（用一個長時間 sleep 的假
    warm_cache 模擬「還沒跑完」，斷言整個 with 區塊在遠低於該長度的時間內
    結束）。"""
    import time

    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
         patch.object(main_module.listening, "warm_cache", side_effect=lambda db: time.sleep(5)):
        start = time.monotonic()
        with TestClient(main_module.app):
            pass
        elapsed = time.monotonic() - start
    assert elapsed < 2
