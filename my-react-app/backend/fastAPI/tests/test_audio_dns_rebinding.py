"""端到端測試（稽核修正第 7 項）：is_safe_redirect_target 在發出第二次請求
「之前」做的 DNS 解析，跟 httpx/requests 實際連線時重新做的 DNS 解析是兩次
獨立的查詢。這裡驗證 quiz.py 的 fetch_audio_from_id、dictionary/audio_proxy.py
的 proxy_audio 在「檢查當下通過、但實際連線的 IP 其實不安全」時，
仍然會被 assert_response_from_safe_peer 擋下來（模擬 DNS rebinding：兩次
解析回傳不同結果）。
"""
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.pronunciation.audio_fetch import fetch_audio_from_id
from dictionary_db.connect import get_db


class _SyncStream:
    """`httpx.Client.stream()` 的替身：with 區塊給出一個 httpx.Response。"""

    def __init__(self, response):
        self.response = response

    def __enter__(self):
        return self.response

    def __exit__(self, *exc):
        return False


class _AsyncStream:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, *exc):
        return False


def _request():
    return httpx.Request("GET", "http://x")


def _first_hop(final_url):
    return httpx.Response(200, text=final_url, request=_request())


def _second_hop(peer_ip, status_code=200):
    resp = httpx.Response(status_code, content=b"fake-audio-bytes", headers={"content-type": "audio/mpeg"}, request=_request())
    resp.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=(peer_ip, 443)))}
    return resp


def _sync_hops(*responses):
    hops = iter(responses)
    return patch("httpx.Client.stream", side_effect=lambda *a, **k: _SyncStream(next(hops)))


def _async_hops(*responses):
    hops = iter(responses)
    return patch("httpx.AsyncClient.stream", side_effect=lambda *a, **k: _AsyncStream(next(hops)))


class TestFetchAudioFromIdRebindingProtection:
    def test_rejects_when_actual_connection_peer_is_private(self, monkeypatch):
        # is_safe_redirect_target 檢查當下「通過」（模擬第一次 DNS 解析回傳
        # 合法公開 IP），但實際連線（第二次 DNS 解析，這裡直接控制 httpx 回應
        # 的 network_stream）卻連到了內網位址——這正是 DNS rebinding 的情境。
        # P5 辭典媒體自主化：fetch_audio_from_id 現在會先查有沒有自己 Storage
        # 的已驗證副本，這裡假設還沒遷移到（回傳 None），才會走到下面這支測試
        # 原本要測的 ILRDF fallback 路徑。
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: None)
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.is_safe_redirect_target", lambda url: True)

        with _sync_hops(_first_hop("https://cdn.example.com/audio.mp3"), _second_hop("10.0.0.5")):
            with pytest.raises(Exception, match="音檔 URL 指向不允許的位址"):
                fetch_audio_from_id("word123")

    def test_allows_when_actual_connection_peer_is_public(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: None)
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.is_safe_redirect_target", lambda url: True)

        with _sync_hops(_first_hop("https://cdn.example.com/audio.mp3"), _second_hop("93.184.216.34")):
            content = fetch_audio_from_id("word123")

        assert content == b"fake-audio-bytes"


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


class TestProxyAudioRebindingProtection:
    def test_returns_502_when_actual_connection_peer_is_private(self, client):
        first_hop = _first_hop("https://cdn.example.com/audio.mp3")
        second_hop = _second_hop("10.0.0.5")

        # P5 辭典媒體自主化：先假設這個 file_id 還沒遷移到自己的 Storage
        # （回傳 None），才會走到下面原本要測的 ILRDF fallback 路徑；client
        # fixture 的 _fake_get_db 回傳 None，不是真正能查詢的 Session。
        with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
            with patch("fastAPI.routes.dictionary.audio_proxy.is_safe_redirect_target", return_value=True):
                with _async_hops(first_hop, second_hop):
                    response = client.get("/api/v1/dictionary/audio/some-file-id")

        assert response.status_code == 502
        assert response.text == "Audio URL not allowed"

    def test_returns_content_when_actual_connection_peer_is_public(self, client):
        first_hop = _first_hop("https://cdn.example.com/audio.mp3")
        second_hop = _second_hop("93.184.216.34")

        with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
            with patch("fastAPI.routes.dictionary.audio_proxy.is_safe_redirect_target", return_value=True):
                with _async_hops(first_hop, second_hop):
                    response = client.get("/api/v1/dictionary/audio/some-file-id")

        assert response.status_code == 200
        assert response.content == b"fake-audio-bytes"
