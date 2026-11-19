"""影像辨識呼叫 Google Vision 失敗時的狀態碼與訊息（F5）。

以前的問題：沒檢查 HTTP 狀態碼、response.json() 沒保護、連線逾時等例外直接變成 500。
Google 配額用完（429）或金鑰被限制（403）都變成 500，還把 Google 的英文訊息放進 detail。
前端分不出「忙碌、可重試」和「壞了」。

現在：逾時 504、連線失敗 503、Google 429 → 429、Google 其他錯誤（5xx、403…）→ 502、
回應不是 JSON 或格式不對 → 502。Google 的原文只寫 log，回給前端的一律是固定的中文；
log 裡也不能出現金鑰（url 裡帶著金鑰，連線例外的訊息可能含 url，所以只記例外類型）。
"""
import io
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes import vision as vision_module

KEY = "SECRET-KEY-123"
URL = "/api/v1/vision/analyze_image/"


async def _fake_auth():
    return {"uid": "test-user"}


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(vision_module, "CLOUD_API_URL", "https://vision.example.com/?key=")
    monkeypatch.setattr(vision_module, "CLOUD_API_KEY", KEY)
    monkeypatch.setattr(vision_module, "translate_labels", lambda descriptions: {d: d for d in descriptions})
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with patch("fastAPI.rate_limit_config.get_configured_rate", return_value="1000/minute"):
            with TestClient(app, raise_server_exceptions=False) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()


def _response(status=200, payload=None, text="", json_error=False):
    r = MagicMock()
    r.status_code = status
    r.text = text
    if json_error:
        r.json.side_effect = ValueError("not json")
    else:
        r.json.return_value = payload
    return r


class _LogSpy:
    """監看 vision.py 的 _logger（不用 caplog：caplog 要靠整個測試行程的 logging 設定，
    其他測試改過設定時會收不到，單獨跑會過、整批跑才失敗）。"""

    def __init__(self, logger):
        self._logger = logger

    @property
    def text(self) -> str:
        lines = []
        for call in self._logger.method_calls:
            if not call.args:
                continue
            msg, *args = call.args
            try:
                lines.append(str(msg) % tuple(args) if args else str(msg))
            except (TypeError, ValueError):
                lines.append(f"{msg} {args}")
        return "\n".join(lines)


@pytest.fixture
def log(monkeypatch):
    spy_logger = MagicMock()
    monkeypatch.setattr(vision_module, "_logger", spy_logger)
    return _LogSpy(spy_logger)


def _post(client, mock_post):
    with patch("httpx.AsyncClient.post", mock_post):
        return client.post(URL, files={"file": ("a.png", _png(), "image/png")})


def _assert_fixed_chinese(response, status, must_not_contain=()):
    assert response.status_code == status
    detail = response.json()["detail"]
    assert detail and all("一" <= ch <= "鿿" or ch in "，。、 " for ch in detail), f"訊息不是純中文：{detail!r}"
    for leaked in must_not_contain:
        assert leaked not in response.text


def test_timeout_becomes_504(client):
    response = _post(client, AsyncMock(side_effect=httpx.ReadTimeout("took too long")))
    _assert_fixed_chinese(response, 504)


def test_connect_timeout_is_also_504(client):
    response = _post(client, AsyncMock(side_effect=httpx.ConnectTimeout("slow")))
    _assert_fixed_chinese(response, 504)


def test_connection_failure_becomes_503_and_keeps_the_key_out_of_the_log(client, log):
    boom = httpx.ConnectError(f"All connection attempts failed for https://vision.example.com/?key={KEY}")
    response = _post(client, AsyncMock(side_effect=boom))
    _assert_fixed_chinese(response, 503, must_not_contain=(KEY, "vision.example.com"))
    assert KEY not in log.text
    assert "ConnectError" in log.text            # 只記例外類型


def test_google_429_becomes_429(client):
    body = {"error": {"code": 429, "message": "Quota exceeded for quota metric 'Requests'", "status": "RESOURCE_EXHAUSTED"}}
    response = _post(client, AsyncMock(return_value=_response(429, body)))
    _assert_fixed_chinese(response, 429, must_not_contain=("Quota", "quota"))


@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_google_5xx_becomes_502(client, status):
    response = _post(client, AsyncMock(return_value=_response(status, {"error": {"message": "Internal error"}})))
    _assert_fixed_chinese(response, 502, must_not_contain=("Internal",))


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_google_client_errors_such_as_a_restricted_key_become_502_not_500(client, status):
    body = {"error": {"code": status, "message": "This API method requires billing to be enabled. API key not valid."}}
    response = _post(client, AsyncMock(return_value=_response(status, body)))
    _assert_fixed_chinese(response, 502, must_not_contain=("billing", "API key"))


def test_non_json_response_becomes_502_not_500(client):
    response = _post(client, AsyncMock(return_value=_response(200, json_error=True, text="<html>Bad gateway</html>")))
    _assert_fixed_chinese(response, 502, must_not_contain=("html", "Bad gateway"))


def test_non_json_error_page_with_error_status_becomes_502(client):
    response = _post(client, AsyncMock(return_value=_response(502, json_error=True, text="<html>upstream</html>")))
    _assert_fixed_chinese(response, 502)


@pytest.mark.parametrize("payload", [None, [], "oops", {}, {"responses": []}, {"responses": None}, {"responses": [None]}, {"responses": ["x"]}])
def test_malformed_200_body_becomes_502(client, payload):
    response = _post(client, AsyncMock(return_value=_response(200, payload)))
    _assert_fixed_chinese(response, 502)


@pytest.mark.parametrize("annotations", [
    None, "dog", {"description": "dog", "score": 0.9}, ["dog"], [None],
    [{"score": 0.9}], [{"description": "dog"}], [{"description": 5, "score": 0.9}],
    [{"description": "dog", "score": "0.9"}], [{"description": "dog", "score": None}],
    [{"description": "dog", "score": True}],
    [{"description": "dog", "score": 0.9}, {"description": "cat"}],      # 只要有一項壞掉就整批當成壞資料
])
def test_malformed_label_annotations_become_502_not_500(client, annotations):
    body = {"responses": [{"labelAnnotations": annotations}]}
    response = _post(client, AsyncMock(return_value=_response(200, body)))
    _assert_fixed_chinese(response, 502)


@pytest.mark.parametrize("score", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_scores_in_the_raw_json_become_502(client, score):
    """json 模組預設會收下 NaN／Infinity；它們無法序列化回 JSON，會讓回應變成 500。用真的 json 字串解析來測。"""
    import json
    payload = json.loads('{"responses":[{"labelAnnotations":[{"description":"dog","score":%s}]}]}' % score)
    response = _post(client, AsyncMock(return_value=_response(200, payload)))
    _assert_fixed_chinese(response, 502)


@pytest.mark.parametrize("score", ["1" + "0" * 400, "-1", "1.5", "2"])
def test_out_of_range_or_huge_scores_become_502_not_500(client, score):
    """超大整數（比 float 能表示的還大）與超出 0～1 的分數：不能讓驗證本身丟例外變成 500。"""
    import json
    payload = json.loads('{"responses":[{"labelAnnotations":[{"description":"dog","score":%s}]}]}' % score)
    response = _post(client, AsyncMock(return_value=_response(200, payload)))
    _assert_fixed_chinese(response, 502)


@pytest.mark.parametrize("score", [0, 1, 0.0, 1.0, 0.5])
def test_scores_at_the_edges_of_the_range_are_accepted(client, score):
    body = {"responses": [{"labelAnnotations": [{"description": "dog", "score": score}]}]}
    response = _post(client, AsyncMock(return_value=_response(200, body)))
    assert response.status_code == 200


@pytest.mark.parametrize("first", [{}, {"labelAnnotations": []}])
def test_no_labels_is_a_normal_empty_result_not_an_error(client, first):
    response = _post(client, AsyncMock(return_value=_response(200, {"responses": [first]})))
    assert response.status_code == 200
    assert response.json() == {"labels": []}


def test_integer_scores_are_accepted(client):
    body = {"responses": [{"labelAnnotations": [{"description": "dog", "score": 1}]}]}
    response = _post(client, AsyncMock(return_value=_response(200, body)))
    assert response.status_code == 200
    assert response.json() == {"labels": [{"description": "dog", "score": 1}]}


def test_key_in_a_non_json_error_body_is_redacted_in_the_log(client, log):
    """沒有結構化 error.message 時，退回記回應本文的開頭：金鑰一樣要遮掉。"""
    _post(client, AsyncMock(return_value=_response(403, json_error=True, text=f"<html>denied for {KEY}</html>")))
    assert KEY not in log.text
    assert "***" in log.text


def test_per_image_error_becomes_502_with_fixed_message_and_original_only_in_the_log(client, log):
    body = {"responses": [{"error": {"code": 3, "message": "Bad image data."}}]}
    response = _post(client, AsyncMock(return_value=_response(200, body)))
    _assert_fixed_chinese(response, 502, must_not_contain=("Bad image data",))
    assert "Bad image data" in log.text           # 原文只寫 log


def test_per_image_resource_exhausted_becomes_429(client):
    body = {"responses": [{"error": {"code": 8, "message": "Quota exceeded"}}]}
    response = _post(client, AsyncMock(return_value=_response(200, body)))
    _assert_fixed_chinese(response, 429, must_not_contain=("Quota",))


def test_per_image_error_without_a_dict_or_message_does_not_crash(client):
    for error in ("boom", None, {}, {"code": "x"}):
        body = {"responses": [{"error": error}]}
        response = _post(client, AsyncMock(return_value=_response(200, body)))
        assert response.status_code == 502


def test_key_in_google_error_text_is_redacted_in_the_log(client, log):
    body = {"error": {"message": f"key {KEY} is restricted"}}
    _post(client, AsyncMock(return_value=_response(403, body)))
    assert KEY not in log.text
    assert "***" in log.text


def test_success_still_works(client):
    body = {"responses": [{"labelAnnotations": [{"description": "dog", "score": 0.912}]}]}
    response = _post(client, AsyncMock(return_value=_response(200, body)))
    assert response.status_code == 200
    assert response.json() == {"labels": [{"description": "dog", "score": 0.91}]}


def test_an_unexpected_non_http_exception_still_goes_to_the_global_handler(client):
    """只攔截 httpx 的例外；其他沒預期到的錯誤仍交給全域 handler（維持 500 通用訊息）。"""
    response = _post(client, AsyncMock(side_effect=RuntimeError("internal detail")))
    assert response.status_code == 500
    assert "internal detail" not in response.text
