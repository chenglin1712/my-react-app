"""WP-4（FastAPI 與日誌）稽核項目的回歸測試：BE4-01/02/03/04/06/07/15/16/17。"""
import asyncio
import io
import logging
import logging.config
import threading
import time

import pytest

from fastAPI import background_refresh, executors, feature_flags, game_config, rate_limit_config
from fastAPI.routes.pronunciation import model


# ---------------------------------------------------------------- BE4-01 / BE4-04
def _wav(seconds: float, rate: int = 48000, channels: int = 2) -> bytes:
    from pydub import AudioSegment

    buf = io.BytesIO()
    AudioSegment.silent(duration=int(seconds * 1000), frame_rate=rate).set_channels(channels).export(buf, format="wav")
    return buf.getvalue()


needs_ffmpeg = pytest.mark.skipif(not model._ffmpeg_path, reason="需要 ffmpeg")


@needs_ffmpeg
def test_audio_longer_than_the_limit_is_rejected_before_inference():
    with pytest.raises(model.AudioTooLongError):
        model.convert_to_wav(_wav(model.MAX_AUDIO_SECONDS + 5))


@needs_ffmpeg
def test_decoding_is_truncated_so_long_audio_is_never_fully_decoded(monkeypatch):
    """稽核 BE4-01：-t 不能放在 parameters（pydub 會把它接在輸出之後被 ffmpeg 忽略，整段長音檔照樣解碼進記憶體）。
    確認解出來的長度只有 duration 指定的那麼長（回退成 parameters 時會看到整段 120 秒而失敗）。"""
    from pydub import AudioSegment

    seen = {}
    real_from_file = AudioSegment.from_file

    def spy(*args, **kwargs):
        audio = real_from_file(*args, **kwargs)
        seen["decoded_ms"] = len(audio)
        return audio

    monkeypatch.setattr(AudioSegment, "from_file", staticmethod(spy))
    with pytest.raises(model.AudioTooLongError):
        model.convert_to_wav(_wav(120))
    assert seen["decoded_ms"] <= (model.MAX_AUDIO_SECONDS + 1) * 1000 + 100


@needs_ffmpeg
def test_audio_within_the_limit_is_converted_to_16khz_mono():
    """稽核 BE4-04：使用者錄音（48 kHz 雙聲道）與官方音檔取樣率不同，原本各用自己的取樣率餵給 wav2vec2。"""
    import soundfile as sf

    wav = model.convert_to_wav(_wav(1.5, rate=48000, channels=2))
    data, rate = sf.read(wav)
    assert rate == model.MODEL_SAMPLE_RATE == 16000
    assert data.ndim == 1  # 單聲道


def test_bytes_to_tensor_resamples_other_rates_to_16khz():
    import numpy as np
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, np.zeros(44100, dtype="float32"), 44100, format="WAV")
    waveform, rate = model.bytes_to_tensor(buf)
    assert rate == 16000
    assert abs(waveform.shape[-1] - 16000) <= 2


def test_embedding_runs_without_gradients():
    import torch

    seen = {}

    class FakeModel:
        def extract_features(self, wave):
            seen["inference_mode"] = torch.is_inference_mode_enabled()
            return [torch.zeros(1, 4, 8)], None

    model._get_embedding(FakeModel(), torch.zeros(1, 100))
    assert seen["inference_mode"] is True


def test_failed_thread_start_releases_the_refresh_name(monkeypatch):
    def boom(self):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(threading.Thread, "start", boom)
    assert background_refresh.spawn("unique-name", lambda: None) is False
    assert "unique-name" not in background_refresh._running


def test_too_short_daily_secret_logs_one_error_and_falls_back(monkeypatch):
    from unittest.mock import patch

    from fastAPI import guest_trial

    monkeypatch.setenv("TRANSLATION_DAILY_SECRET", "short")
    monkeypatch.delenv("GUEST_TRIAL_SECRET", raising=False)
    monkeypatch.setenv("INTERNAL_API_SECRET", "internal-secret-0123456789-abcdefghijklmnop")
    monkeypatch.setattr(guest_trial, "_warned_short_secrets", set())
    with patch.object(guest_trial.logger, "error") as log_error:
        first = guest_trial._daily_secret()
        second = guest_trial._daily_secret()
    assert first == second and first  # 退回由 INTERNAL_API_SECRET 衍生的那一層
    assert log_error.call_count == 1


def test_warm_up_rolls_back_the_shared_session_after_a_failed_cache(monkeypatch):
    from unittest.mock import MagicMock, patch

    from fastAPI import main as main_module

    session = MagicMock()
    with patch.object(main_module, "_WARM_CACHE_JITTER_MAX_SECONDS", 0), \
            patch.object(main_module, "SessionLocal", return_value=session), \
            patch.object(main_module.listening, "warm_cache", side_effect=RuntimeError("boom")), \
            patch.object(main_module.sentence, "warm_cache"), \
            patch.object(main_module.quiz, "warm_cache"), \
            patch.object(main_module.dictionary, "warm_cache"):
        main_module._warm_caches(main_module.app)
    session.rollback.assert_called_once()


# ---------------------------------------------------------------- BE4-02
def test_httpx_request_logs_cannot_leak_api_keys_in_urls():
    from config.logging import get_logging_config

    config = get_logging_config("test-wp4.log")
    try:
        assert config["loggers"]["httpx"]["level"] == "WARNING"
        assert config["loggers"]["httpcore"]["level"] == "WARNING"
        logging.config.dictConfig(config)
        assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)
        assert not logging.getLogger("httpx").isEnabledFor(logging.DEBUG)
    finally:
        logging.getLogger("httpx").setLevel(logging.NOTSET)
        logging.getLogger("httpcore").setLevel(logging.NOTSET)


# ---------------------------------------------------------------- BE4-03
def test_slow_work_uses_dedicated_pools_not_the_default_one():
    names = {}

    def record(name):
        names[name] = threading.current_thread().name

    async def go():
        await executors.run_in(executors.crawler_executor, record, "crawler")
        await executors.run_in(executors.llm_executor, record, "llm")
        await executors.run_in(executors.inference_executor, record, "inference")

    asyncio.run(go())
    assert names["crawler"].startswith("crawler")
    assert names["llm"].startswith("llm")
    assert names["inference"].startswith("inference")


def test_run_in_copies_contextvars_into_the_worker_thread():
    import contextvars

    var = contextvars.ContextVar("uid", default="")

    async def go():
        var.set("user-1")
        return await executors.run_in(executors.llm_executor, var.get)

    assert asyncio.run(go()) == "user-1"


# ---------------------------------------------------------------- BE4-06
@pytest.fixture
def background_mode():
    background_refresh.enable()
    try:
        yield
    finally:
        background_refresh.disable()


def test_stale_rate_limit_rules_refresh_in_the_background_without_blocking(monkeypatch, background_mode):
    started, release = threading.Event(), threading.Event()

    def slow_fetch():
        started.set()
        release.wait(5)
        rate_limit_config._rate_limit_rules = {"k": "1/minute"}

    monkeypatch.setattr(rate_limit_config, "_fetch_rules", slow_fetch)
    monkeypatch.setattr(rate_limit_config, "_rate_limit_last_fetch", float("-inf"))
    monkeypatch.setattr(rate_limit_config, "_rate_limit_rules", {})

    t0 = time.monotonic()
    assert rate_limit_config.get_configured_rate("k", "9/minute") == "9/minute"  # 先用目前的值，不等更新
    assert time.monotonic() - t0 < 1
    assert started.wait(2)
    release.set()
    for _ in range(50):
        if rate_limit_config._rate_limit_rules:
            break
        time.sleep(0.02)
    assert rate_limit_config.get_configured_rate("k", "9/minute") == "1/minute"


def test_only_one_background_refresh_runs_at_a_time(background_mode):
    release = threading.Event()
    calls = []

    def fn():
        calls.append(1)
        release.wait(2)

    assert background_refresh.spawn("same", fn) is True
    assert background_refresh.spawn("same", fn) is False
    release.set()


def test_game_config_refresh_runs_in_the_background_when_enabled(monkeypatch, background_mode):
    ran = threading.Event()
    monkeypatch.setattr(game_config, "_fetch_game_config", ran.set)
    monkeypatch.setattr(game_config, "_game_config_last_fetch", float("-inf"))
    game_config.refresh_game_config_if_stale()
    assert ran.wait(2)


def test_without_background_mode_the_refresh_is_still_synchronous(monkeypatch):
    called = []
    monkeypatch.setattr(game_config, "_fetch_game_config", lambda: called.append(1))
    monkeypatch.setattr(game_config, "_game_config_last_fetch", float("-inf"))
    game_config.refresh_game_config_if_stale()
    assert called == [1]


# ---------------------------------------------------------------- BE4-07
def test_limiter_falls_back_to_memory_when_redis_is_down():
    from fastAPI.rate_limit import limiter

    assert limiter._in_memory_fallback_enabled is True


# ---------------------------------------------------------------- BE4-16
def test_paid_flag_turns_off_when_flag_data_is_too_stale(monkeypatch):
    monkeypatch.setattr(feature_flags, "_refresh_if_stale", lambda: None)
    monkeypatch.setattr(feature_flags, "_engine", object())
    monkeypatch.setattr(feature_flags, "_cache", {"translation_enabled": True})
    monkeypatch.setattr(feature_flags, "_last_paid_stale_log", 0.0)

    monkeypatch.setattr(feature_flags, "_last_success", time.monotonic())
    assert feature_flags.is_enabled_paid("translation_enabled") is True

    monkeypatch.setattr(feature_flags, "_last_success", time.monotonic() - feature_flags._PAID_MAX_AGE_SECONDS - 5)
    assert feature_flags.is_enabled_paid("translation_enabled") is False


def test_paid_flag_is_closed_until_flags_have_been_loaded_once(monkeypatch):
    """重啟後、第一次載入完成前：資料庫裡「已被預算保護關閉」不能在空窗期被預設值蓋過去。"""
    monkeypatch.setattr(feature_flags, "_refresh_if_stale", lambda: None)
    monkeypatch.setattr(feature_flags, "_engine", object())
    monkeypatch.setattr(feature_flags, "_cache", {})
    monkeypatch.setattr(feature_flags, "_last_success", 0.0)
    monkeypatch.setattr(feature_flags, "_last_paid_stale_log", 0.0)
    assert feature_flags.is_enabled_paid("translation_enabled") is False

    monkeypatch.setattr(feature_flags, "_last_success", time.monotonic())
    assert feature_flags.is_enabled_paid("translation_enabled") is True  # 載入成功且沒有被關閉


def test_paid_flag_ignores_staleness_without_a_database(monkeypatch):
    monkeypatch.setattr(feature_flags, "_refresh_if_stale", lambda: None)
    monkeypatch.setattr(feature_flags, "_engine", None)
    monkeypatch.setattr(feature_flags, "_cache", {})
    assert feature_flags.is_enabled_paid("translation_enabled") is True


# ---------------------------------------------------------------- BE4-17
def test_wildcard_origin_is_dropped_outside_debug_mode(monkeypatch):
    from config import cors

    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example.com,*")
    monkeypatch.setattr(cors, "is_debug", lambda: False)
    assert cors.get_allowed_origins() == ["https://app.example.com"]


def test_wildcard_origin_is_left_alone_in_debug_mode(monkeypatch):
    from config import cors

    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    monkeypatch.setattr(cors, "is_debug", lambda: True)
    assert cors.get_allowed_origins() == ["*"]


def test_cors_does_not_allow_credentials():
    from fastAPI.main import app

    cors_layer = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert cors_layer.kwargs["allow_credentials"] is False
