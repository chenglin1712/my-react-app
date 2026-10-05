"""P4 review BE-24：/health（liveness）跟 /ready（readiness）要能分開回報
「process 活著」跟「關鍵快取是否已經預熱完成」；背景預熱 daemon thread 的
jitter 與關閉行為也在這裡驗證（見 fastAPI/main.py 的完整說明）。
"""
from unittest.mock import patch

from fastapi.testclient import TestClient

from fastAPI import main as main_module


def _wait_for_stray_warm_threads(timeout=10.0):
    """前面某些測試（例如讓 listening.warm_cache 睡 1 秒的那個）離開 TestClient 之後，
    背景預熱執行緒仍可能還在跑。它若恰好撞上後面測試設定好的 mock（例如模型預載的
    side_effect 次數），會吃掉別人的呼叫、讓斷言莫名失敗。每個會數呼叫次數的測試開始前
    先等這些雜散執行緒結束。"""
    import threading
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not any(t.is_alive() and getattr(t, "_target", None) is main_module._warm_caches
                   for t in threading.enumerate()):
            return
        time.sleep(0.02)


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


def test_ready_requires_pronunciation_model_when_preload_enabled():
    """PRELOAD_PRONUNCIATION_MODEL 開啟時，模型載入失敗要讓 /ready 維持 503
    （原本模型是第一次請求才懶載入，下載失敗時 /ready 仍回 200）。"""
    _wait_for_stray_warm_threads()
    import time

    for scenario, side_effect, expected_status in (("成功", None, 200), ("失敗", RuntimeError("download failed"), 503)):
        with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
             patch.object(main_module, "_PRELOAD_PRONUNCIATION_MODEL", True), \
             patch.object(main_module, "_PRELOAD_BACKOFF_SECONDS", 0), \
             patch.object(main_module.pronunciation_model, "get_wav2vec2", side_effect=side_effect), \
             patch.object(main_module.listening, "warm_cache"), \
             patch.object(main_module.sentence, "warm_cache"), \
             patch.object(main_module.quiz, "warm_cache"), \
             patch.object(main_module.dictionary, "warm_cache"):
            with TestClient(main_module.app) as client:
                for _ in range(100):
                    if getattr(client.app.state, "caches_warm", False):
                        break
                    time.sleep(0.05)
                response = client.get("/ready")
        assert response.status_code == expected_status, scenario


def test_ready_ignores_pronunciation_model_when_preload_disabled():
    """預設（本機開發、測試）不預載模型，/ready 不受影響。"""
    _wait_for_stray_warm_threads()
    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
         patch.object(main_module, "_PRELOAD_PRONUNCIATION_MODEL", False), \
         patch.object(main_module.pronunciation_model, "get_wav2vec2", side_effect=AssertionError("不該被呼叫")) as loader, \
         patch.object(main_module.listening, "warm_cache"), \
         patch.object(main_module.sentence, "warm_cache"), \
         patch.object(main_module.quiz, "warm_cache"), \
         patch.object(main_module.dictionary, "warm_cache"):
        with TestClient(main_module.app) as client:
            import time
            for _ in range(100):
                if getattr(client.app.state, "caches_warm", False):
                    break
                time.sleep(0.05)
            response = client.get("/ready")
    assert response.status_code == 200
    loader.assert_not_called()


def _ready_status_with_model_side_effects(side_effects):
    _wait_for_stray_warm_threads()
    import time

    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
         patch.object(main_module, "_PRELOAD_PRONUNCIATION_MODEL", True), \
         patch.object(main_module, "_PRELOAD_BACKOFF_SECONDS", 0), \
         patch.object(main_module.pronunciation_model, "get_wav2vec2", side_effect=side_effects) as loader, \
         patch.object(main_module.listening, "warm_cache"), \
         patch.object(main_module.sentence, "warm_cache"), \
         patch.object(main_module.quiz, "warm_cache"), \
         patch.object(main_module.dictionary, "warm_cache"):
        with TestClient(main_module.app) as client:
            for _ in range(100):
                if getattr(client.app.state, "caches_warm", False):
                    break
                time.sleep(0.05)
            response = client.get("/ready")
    return response.status_code, loader.call_count


def test_preload_retries_transient_failures_then_reports_ready():
    """暫時性失敗（前兩次丟例外、第三次成功）不該讓 /ready 永久 503。"""
    status, calls = _ready_status_with_model_side_effects([RuntimeError("blip"), RuntimeError("blip"), None])
    assert (status, calls) == (200, 3)


def test_preload_gives_up_after_limited_attempts_and_stays_unready():
    """重試有上限：持續失敗（例如權重檔損毀）最後仍維持 503，讓部署被擋下，且不會無限重試。"""
    status, calls = _ready_status_with_model_side_effects(RuntimeError("corrupted weights"))
    assert (status, calls) == (503, main_module._PRELOAD_ATTEMPTS)
