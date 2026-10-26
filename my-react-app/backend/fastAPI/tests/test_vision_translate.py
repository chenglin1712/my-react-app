"""vision.py 的標籤翻譯：只用官方 Cloud Translation API；失敗時保留英文原字（S-13 移除 deep_translator）。"""
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from fastAPI.routes import vision as V


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    monkeypatch.setattr(V, "_translation_cache", {})
    monkeypatch.setattr(V, "CLOUD_API_KEY", "dummy-key")


def _response(status=200, body=None):
    response = MagicMock()
    response.status_code = status
    response.text = "err dummy-key"
    response.json.return_value = body
    return response


def test_official_api_translates_the_whole_batch_in_one_call():
    body = {"data": {"translations": [{"translatedText": "狗"}, {"translatedText": "貓"}]}}
    with patch.object(V.httpx, "post", return_value=_response(200, body)) as post:
        out = V.translate_labels(["dog", "cat", "dog"])
    assert out == {"dog": "狗", "cat": "貓"}
    assert post.call_count == 1
    assert post.call_args.kwargs["json"]["q"] == ["dog", "cat"]


def test_results_are_cached_so_a_repeat_does_not_call_the_api_again():
    body = {"data": {"translations": [{"translatedText": "狗"}]}}
    with patch.object(V.httpx, "post", return_value=_response(200, body)) as post:
        V.translate_labels(["dog"])
        V.translate_labels(["Dog"])
    assert post.call_count == 1


def test_api_failure_keeps_the_english_word_and_does_not_cache_it(caplog):
    with patch.object(V.httpx, "post", return_value=_response(403)):
        out = V.translate_labels(["dog"])
    assert out == {"dog": "dog"}
    assert V._translation_cache == {}
    assert "dummy-key" not in caplog.text          # 錯誤訊息裡的金鑰要遮掉


def test_network_exception_keeps_the_english_word():
    with patch.object(V.httpx, "post", side_effect=RuntimeError("down")):
        assert V.translate_labels(["dog"]) == {"dog": "dog"}


def test_without_an_api_key_nothing_is_sent_and_the_english_word_is_kept(monkeypatch):
    monkeypatch.setattr(V, "CLOUD_API_KEY", "")
    with patch.object(V.httpx, "post") as post:
        assert V.translate_labels(["dog"]) == {"dog": "dog"}
    post.assert_not_called()


def test_the_unofficial_scraper_package_is_gone():
    assert not hasattr(V, "GoogleTranslator")
    assert not hasattr(V, "translate_with_retry")
    requirements = (Path(__file__).resolve().parents[3] / "requirements.txt").read_text(encoding="utf-8")
    assert "deep_translator" not in requirements.lower().replace("-", "_")

def test_a_short_batch_keeps_the_english_word_for_the_missing_item():
    body = {"data": {"translations": [{"translatedText": "狗"}]}}      # 送了兩個，只回一個
    with patch.object(V.httpx, "post", return_value=_response(200, body)):
        out = V.translate_labels(["dog", "cat"])
    assert out == {"dog": "狗", "cat": "cat"}
    assert "cat" not in V._translation_cache


def test_empty_or_malformed_items_are_failures_not_cached_blanks():
    body = {"data": {"translations": [{"translatedText": "  "}, {"oops": 1}]}}
    with patch.object(V.httpx, "post", return_value=_response(200, body)):
        out = V.translate_labels(["dog", "cat"])
    assert out == {"dog": "dog", "cat": "cat"}
    assert V._translation_cache == {}
