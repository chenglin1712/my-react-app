"""get_configured_rate()／_refresh_if_stale()：從 Django adminapi 讀限流
規則、更新 rate_limit_config.py 模組快取的機制——比照 test_irt_config_refresh.py
／test_game_config_refresh.py 對同款輪詢函式的測試方式。"""
from unittest.mock import MagicMock, patch

import pytest

from fastAPI import rate_limit_config


@pytest.fixture(autouse=True)
def _reset_rate_limit_config_state():
    rate_limit_config._rate_limit_last_fetch = 0.0
    rate_limit_config._rate_limit_rules = {}
    yield
    rate_limit_config._rate_limit_last_fetch = 0.0
    rate_limit_config._rate_limit_rules = {}


def test_successful_fetch_updates_rules_dict():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"rules": {"quiz_compare_audio": "5/minute"}}
    with patch("fastAPI.rate_limit_config.requests.get", return_value=mock_response) as mock_get:
        rate = rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    mock_get.assert_called_once()
    assert rate == "5/minute"


def test_internal_request_declares_https_so_django_does_not_redirect():
    # 正式環境 Django 開了 SECURE_SSL_REDIRECT：沒有 X-Forwarded-Proto 的內部請求會被導去
    # https://127.0.0.1:8000 而 SSL 失敗，後台設定的限流就永遠讀不到
    mock_response = MagicMock()
    mock_response.json.return_value = {"rules": {}}
    with patch("fastAPI.rate_limit_config.requests.get", return_value=mock_response) as mock_get:
        rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    assert mock_get.call_args.kwargs["headers"]["X-Forwarded-Proto"] == "https"


def test_key_not_in_django_response_falls_back_to_default():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"rules": {"other_key": "5/minute"}}
    with patch("fastAPI.rate_limit_config.requests.get", return_value=mock_response):
        rate = rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    assert rate == "20/minute"


def test_within_ttl_does_not_refetch():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"rules": {"quiz_compare_audio": "5/minute"}}
    with patch("fastAPI.rate_limit_config.requests.get", return_value=mock_response) as mock_get:
        rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")
        rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")
        rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    mock_get.assert_called_once()


def test_django_unreachable_falls_back_to_default_not_crash():
    import requests as requests_module
    with patch(
        "fastAPI.rate_limit_config.requests.get",
        side_effect=requests_module.exceptions.ConnectionError("boom"),
    ):
        rate = rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    assert rate == "20/minute"


def test_http_error_status_falls_back_to_default_not_crash():
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.raise_for_status.side_effect = Exception("500 error")
    with patch("fastAPI.rate_limit_config.requests.get", return_value=mock_response):
        rate = rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    assert rate == "20/minute"


def test_failed_fetch_still_updates_last_fetch_timestamp_to_avoid_hammering():
    import requests as requests_module
    with patch(
        "fastAPI.rate_limit_config.requests.get",
        side_effect=requests_module.exceptions.ConnectionError("boom"),
    ) as mock_get:
        rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")
        rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute")

    mock_get.assert_called_once()
