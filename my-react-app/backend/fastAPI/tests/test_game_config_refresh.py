"""refresh_game_config_if_stale()：從 Django adminapi 讀遊戲參數、更新
game_config.py 模組全域變數的機制——完全比照 test_irt_config_refresh.py
對 quiz.py 那支同款函式的測試方式，見 game_config.py 該函式的完整說明。"""
from unittest.mock import MagicMock, patch

import pytest

from fastAPI import game_config


@pytest.fixture(autouse=True)
def _reset_game_config_state():
    original = {
        "LISTENING_QUESTIONS_PER_ROUND": game_config.LISTENING_QUESTIONS_PER_ROUND,
        "LISTENING_OPTIONS_PER_QUESTION": game_config.LISTENING_OPTIONS_PER_QUESTION,
        "SENTENCE_QUESTIONS_PER_ROUND": game_config.SENTENCE_QUESTIONS_PER_ROUND,
        "SENTENCE_OPTIONS_PER_QUESTION": game_config.SENTENCE_OPTIONS_PER_QUESTION,
        "PRONUNCIATION_MAX_AUDIO_MB": game_config.PRONUNCIATION_MAX_AUDIO_MB,
        "PRONUNCIATION_EXCELLENT_THRESHOLD": game_config.PRONUNCIATION_EXCELLENT_THRESHOLD,
        "PRONUNCIATION_GOOD_THRESHOLD": game_config.PRONUNCIATION_GOOD_THRESHOLD,
        "PRONUNCIATION_FAIR_THRESHOLD": game_config.PRONUNCIATION_FAIR_THRESHOLD,
        "PRONUNCIATION_PASS_THRESHOLD": game_config.PRONUNCIATION_PASS_THRESHOLD,
        "CROSSWORD_GRID_SIZE": game_config.CROSSWORD_GRID_SIZE,
        "CROSSWORD_MIN_WORD_LENGTH": game_config.CROSSWORD_MIN_WORD_LENGTH,
        "CROSSWORD_MAX_WORD_LENGTH": game_config.CROSSWORD_MAX_WORD_LENGTH,
        "CROSSWORD_WORDS_PER_ROUND": game_config.CROSSWORD_WORDS_PER_ROUND,
        "CROSSWORD_COMPUTE_TIME_LIMIT_SECONDS": game_config.CROSSWORD_COMPUTE_TIME_LIMIT_SECONDS,
    }
    game_config._game_config_last_fetch = 0.0
    yield
    for key, value in original.items():
        setattr(game_config, key, value)
    game_config._game_config_last_fetch = 0.0


def _fake_config_payload(**overrides):
    payload = {
        "listening_questions_per_round": 10, "listening_options_per_question": 4,
        "sentence_questions_per_round": 5, "sentence_options_per_question": 4,
        "pronunciation_max_audio_mb": 10, "pronunciation_excellent_threshold": 80,
        "pronunciation_good_threshold": 60, "pronunciation_fair_threshold": 40,
        "pronunciation_pass_threshold": 70, "crossword_grid_size": 13,
        "crossword_min_word_length": 4, "crossword_max_word_length": 10,
        "crossword_words_per_round": 30, "crossword_compute_time_limit_seconds": 2,
    }
    payload.update(overrides)
    return payload


def test_successful_fetch_updates_globals():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(
        listening_questions_per_round=20, crossword_grid_size=17,
    )
    with patch("fastAPI.game_config.requests.get", return_value=mock_response) as mock_get:
        game_config.refresh_game_config_if_stale()

    mock_get.assert_called_once()
    assert game_config.LISTENING_QUESTIONS_PER_ROUND == 20
    assert game_config.CROSSWORD_GRID_SIZE == 17


def test_within_ttl_does_not_refetch():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(listening_questions_per_round=20)
    with patch("fastAPI.game_config.requests.get", return_value=mock_response) as mock_get:
        game_config.refresh_game_config_if_stale()
        game_config.refresh_game_config_if_stale()
        game_config.refresh_game_config_if_stale()

    mock_get.assert_called_once()


def test_django_unreachable_keeps_current_values_not_crash():
    import requests as requests_module
    with patch(
        "fastAPI.game_config.requests.get",
        side_effect=requests_module.exceptions.ConnectionError("boom"),
    ):
        game_config.refresh_game_config_if_stale()  # 不應該丟例外

    assert game_config.LISTENING_QUESTIONS_PER_ROUND == 10
    assert game_config.CROSSWORD_GRID_SIZE == 13


def test_http_error_status_keeps_current_values_not_crash():
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.raise_for_status.side_effect = Exception("500 error")
    with patch("fastAPI.game_config.requests.get", return_value=mock_response):
        game_config.refresh_game_config_if_stale()  # 不應該丟例外

    assert game_config.LISTENING_QUESTIONS_PER_ROUND == 10


def test_failed_fetch_still_updates_last_fetch_timestamp_to_avoid_hammering():
    import requests as requests_module
    with patch(
        "fastAPI.game_config.requests.get",
        side_effect=requests_module.exceptions.ConnectionError("boom"),
    ) as mock_get:
        game_config.refresh_game_config_if_stale()
        game_config.refresh_game_config_if_stale()

    mock_get.assert_called_once()
