"""_refresh_irt_config_if_stale()：從 Django adminapi 讀 IRT 超參數、更新
quiz.py 模組全域變數的機制（見 quiz.py 該函式的完整說明）。"""
from unittest.mock import MagicMock, patch

import pytest

from fastAPI.routes.quiz import irt as quiz


@pytest.fixture(autouse=True)
def _reset_irt_config_state():
    """每個測試前後都重置成模組原本的預設值與「從未抓取過」的狀態，避免
    測試之間互相汙染（quiz.py 的這幾個變數是模組全域，不會隨測試函式
    自動重置）。"""
    original = {
        "ALPHA0": quiz.ALPHA0, "BETA0": quiz.BETA0, "DEFAULT_GUESS": quiz.DEFAULT_GUESS,
        "TYPE_AQ": dict(quiz.TYPE_AQ), "LEARNING_RATE": quiz.LEARNING_RATE,
        "DQ_ALPHA": quiz.DQ_ALPHA, "DQ_BETA": quiz.DQ_BETA, "DQ_GAMMA": quiz.DQ_GAMMA,
        "BETA1": quiz.BETA1, "BETA2": quiz.BETA2, "BETA3": quiz.BETA3,
        "BETA4": quiz.BETA4, "BETA5": quiz.BETA5, "TOTAL_QUESTIONS": quiz.TOTAL_QUESTIONS,
    }
    quiz._irt_config_last_fetch = 0.0
    yield
    for key, value in original.items():
        setattr(quiz, key, value)
    quiz._irt_config_last_fetch = 0.0


def _fake_config_payload(**overrides):
    payload = {
        "total_questions": 10, "alpha0": 1.0, "beta0": 1.0, "default_guess": 0.25,
        "learning_rate": 0.08, "dq_alpha": 0.45, "dq_beta": 0.35, "dq_gamma": 0.20,
        "type_aq_word_translate": 1.2, "type_aq_word_match": 1.0,
        "type_aq_sentence_fill": 0.9, "type_aq_sentence_order": 1.1,
        "beta1": 0.2, "beta2": 0.2, "beta3": 0.2, "beta4": 0.2, "beta5": 0.2,
    }
    payload.update(overrides)
    return payload


def test_successful_fetch_updates_globals():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(total_questions=20, dq_alpha=0.9)
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response) as mock_get:
        quiz._refresh_irt_config_if_stale()

    mock_get.assert_called_once()
    assert quiz.TOTAL_QUESTIONS == 20
    assert quiz.DQ_ALPHA == 0.9


def test_type_aq_dict_rebuilt_from_flat_fields():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(type_aq_word_match=3.5)
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response):
        quiz._refresh_irt_config_if_stale()

    assert quiz.TYPE_AQ["word-match"] == 3.5


def test_within_ttl_does_not_refetch():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(total_questions=20)
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response) as mock_get:
        quiz._refresh_irt_config_if_stale()
        quiz._refresh_irt_config_if_stale()
        quiz._refresh_irt_config_if_stale()

    mock_get.assert_called_once()


def test_django_unreachable_keeps_current_values_not_crash():
    import requests as requests_module
    with patch("fastAPI.routes.quiz.irt.requests.get", side_effect=requests_module.exceptions.ConnectionError("boom")):
        quiz._refresh_irt_config_if_stale()  # 不應該丟例外

    # Django 連不上時保留目前值（這裡是 fixture 重置後的原始預設值）不變。
    assert quiz.TOTAL_QUESTIONS == 10


def test_http_error_status_keeps_current_values_not_crash():
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.raise_for_status.side_effect = Exception("500 error")
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response):
        quiz._refresh_irt_config_if_stale()  # 不應該丟例外

    assert quiz.TOTAL_QUESTIONS == 10


def test_response_missing_field_leaves_all_globals_untouched():
    """P4 review BE-10：原本逐欄位 `GLOBAL = data["key"]`，回應中途缺一個
    欄位時，前面已經賦值的 global 會停在新值、後面的停在舊值，變成一份
    「半新半舊」的設定。這裡驗證修正後是全有或全無：缺欄位時完全不套用，
    連同一個回應裡「排在缺欄位之前」的欄位（total_questions）也不能被
    套用。"""
    payload = _fake_config_payload(total_questions=999, dq_alpha=0.99)
    del payload["beta5"]  # 模擬 Django 端漏填/欄位交接期缺欄位
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = payload
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response):
        quiz._refresh_irt_config_if_stale()  # 不應該丟例外

    # total_questions 在 dataclass 欄位順序裡排在 beta5 之前，如果是逐欄位
    # 賦值就會先套用成功，這裡要確認完全沒有套用，維持 fixture 重置後的
    # 原始預設值。
    assert quiz.TOTAL_QUESTIONS == 10
    assert quiz.DQ_ALPHA == 0.45


def test_response_wrong_type_leaves_all_globals_untouched():
    payload = _fake_config_payload(alpha0="not-a-number")
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = payload
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response):
        quiz._refresh_irt_config_if_stale()  # 不應該丟例外

    assert quiz.ALPHA0 == 1.0


def test_failed_fetch_still_updates_last_fetch_timestamp_to_avoid_hammering():
    # 失敗也要進入下一個 TTL 週期再試，不能讓每個請求都重新嘗試連線並等待逾時。
    import requests as requests_module
    with patch("fastAPI.routes.quiz.irt.requests.get", side_effect=requests_module.exceptions.ConnectionError("boom")) as mock_get:
        quiz._refresh_irt_config_if_stale()
        quiz._refresh_irt_config_if_stale()

    mock_get.assert_called_once()


def test_refreshed_coefficients_are_used_by_default_arguments():
    """回歸測試（E1）：後台改了 alpha0／beta0／dq_*，省略參數的呼叫必須跟著用新值。
    原本預設值在 import 當下就被複製，後台調整永遠不會生效。"""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(
        alpha0=9.0, beta0=1.0, dq_alpha=0.9, dq_beta=0.05, dq_gamma=0.05,
    )
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response):
        quiz._refresh_irt_config_if_stale()

    # (1 + 9) / (3 + 9 + 1)
    assert quiz.compute_smoothed_error_rate(1, 3) == pytest.approx(10 / 13)
    dq, _ = quiz.compute_Dq_and_bw(0.5, 0.4, 0.3)
    assert dq == pytest.approx(0.9 * 0.5 + 0.05 * 0.4 + 0.05 * (1 - 0.3))


def test_explicit_arguments_still_override_and_zero_is_respected():
    # 明確傳入的值優先，0.0 不能被當成「沒給」。
    assert quiz.compute_smoothed_error_rate(1, 3, alpha0=0.0, beta0=0.0) == pytest.approx(1 / 3)
    dq, _ = quiz.compute_Dq_and_bw(0.5, 0.4, 0.3, alpha=1.0, beta=0.0, gamma=0.0)
    assert dq == pytest.approx(0.5)


def test_theta_helpers_follow_refreshed_guess_and_learning_rate_by_default():
    """compute_P_theta／update_theta 的預設參數也要在呼叫時才讀目前的全域值（和 E1 同一類問題）。"""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = _fake_config_payload(default_guess=0.5, learning_rate=0.5)
    with patch("fastAPI.routes.quiz.irt.requests.get", return_value=mock_response):
        quiz._refresh_irt_config_if_stale()

    # theta == bw 時 1/(1+e^0) = 0.5：P = C + (1-C)*0.5 = 0.5 + 0.25
    assert quiz.compute_P_theta(0.4, 0.4) == pytest.approx(0.75)
    assert quiz.update_theta(0.4, True, 0.75) == pytest.approx(0.4 + 0.5 * 0.25)
    # 明確傳入的值（含 0.0）優先。
    assert quiz.compute_P_theta(0.4, 0.4, C=0.0) == pytest.approx(0.5)
    assert quiz.update_theta(0.4, True, 0.75, gamma=0.0) == pytest.approx(0.4)
