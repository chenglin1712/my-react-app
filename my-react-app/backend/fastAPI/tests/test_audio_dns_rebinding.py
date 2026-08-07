"""端到端測試（稽核修正第 7 項）：is_safe_redirect_target 在發出第二次請求
「之前」做的 DNS 解析，跟 httpx/requests 實際連線時重新做的 DNS 解析是兩次
獨立的查詢。這裡驗證 quiz.py 的 fetch_audio_from_id、dictionary/audio_proxy.py
的 proxy_audio 在「檢查當下通過、但實際連線的 IP 其實不安全」時，
仍然會被 assert_response_from_safe_peer 擋下來（模擬 DNS rebinding：兩次
解析回傳不同結果）。
"""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.quiz import fetch_audio_from_id
from dictionary_db.connect import get_db


def _fake_first_hop(final_url):
    resp = MagicMock()
    resp.status_code = 200
    resp.text = final_url
    resp.headers = {}
    return resp


def _fake_second_hop(peer_ip, status_code=200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.content = b"fake-audio-bytes"
    resp.headers = {"content-type": "audio/mpeg"}
    resp.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=(peer_ip, 443)))}
    return resp


class TestFetchAudioFromIdRebindingProtection:
    def test_rejects_when_actual_connection_peer_is_private(self, monkeypatch):
        # is_safe_redirect_target 檢查當下「通過」（模擬第一次 DNS 解析回傳
        # 合法公開 IP），但實際連線（第二次 DNS 解析，這裡直接控制 httpx 回應
        # 的 network_stream）卻連到了內網位址——這正是 DNS rebinding 的情境。
        # P5 辭典媒體自主化：fetch_audio_from_id 現在會先查有沒有自己 Storage
        # 的已驗證副本，這裡假設還沒遷移到（回傳 None），才會走到下面這支測試
        # 原本要測的 ILRDF fallback 路徑。
        monkeypatch.setattr("fastAPI.routes.quiz._lookup_verified_audio_url", lambda audio_id: None)
        monkeypatch.setattr("fastAPI.routes.quiz.requests.get", lambda *a, **k: _fake_first_hop("https://cdn.example.com/audio.mp3"))
        monkeypatch.setattr("fastAPI.routes.quiz.is_safe_redirect_target", lambda url: True)

        with patch("httpx.Client.get", return_value=_fake_second_hop("10.0.0.5")):
            with pytest.raises(Exception, match="音檔 URL 指向不允許的位址"):
                fetch_audio_from_id("word123")

    def test_allows_when_actual_connection_peer_is_public(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.quiz._lookup_verified_audio_url", lambda audio_id: None)
        monkeypatch.setattr("fastAPI.routes.quiz.requests.get", lambda *a, **k: _fake_first_hop("https://cdn.example.com/audio.mp3"))
        monkeypatch.setattr("fastAPI.routes.quiz.is_safe_redirect_target", lambda url: True)

        with patch("httpx.Client.get", return_value=_fake_second_hop("93.184.216.34")):
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
        first_hop = httpx.Response(200, text="https://cdn.example.com/audio.mp3", request=httpx.Request("GET", "http://x"))
        second_hop = httpx.Response(200, content=b"fake-audio-bytes", request=httpx.Request("GET", "http://x"))

        second_hop.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=("10.0.0.5", 443)))}

        # P5 辭典媒體自主化：先假設這個 file_id 還沒遷移到自己的 Storage
        # （回傳 None），才會走到下面原本要測的 ILRDF fallback 路徑；client
        # fixture 的 _fake_get_db 回傳 None，不是真正能查詢的 Session。
        with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
            with patch("fastAPI.routes.dictionary.audio_proxy.is_safe_redirect_target", return_value=True):
                with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
                    mock_get.side_effect = [first_hop, second_hop]
                    response = client.get("/api/v1/dictionary/audio/some-file-id")

        assert response.status_code == 502
        assert response.text == "Audio URL not allowed"

    def test_returns_content_when_actual_connection_peer_is_public(self, client):
        first_hop = httpx.Response(200, text="https://cdn.example.com/audio.mp3", request=httpx.Request("GET", "http://x"))
        second_hop = httpx.Response(200, content=b"fake-audio-bytes", request=httpx.Request("GET", "http://x"))
        second_hop.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=("93.184.216.34", 443)))}

        with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
            with patch("fastAPI.routes.dictionary.audio_proxy.is_safe_redirect_target", return_value=True):
                with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
                    mock_get.side_effect = [first_hop, second_hop]
                    response = client.get("/api/v1/dictionary/audio/some-file-id")

        assert response.status_code == 200
        assert response.content == b"fake-audio-bytes"
