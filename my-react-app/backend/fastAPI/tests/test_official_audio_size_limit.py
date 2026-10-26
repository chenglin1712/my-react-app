"""官方音檔下載的大小上限：辭典音檔代理（非同步）與發音比對的官方音檔下載（同步）。

原本兩處都是 `client.get(url)` 後讀 `.content`，整份回應先完整進記憶體。來源回超大檔案、
宣告超大 Content-Length、或回壓縮炸彈時，單一請求就能吃掉大量記憶體。
"""
import gzip
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from config import bounded_download as bd
from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.pronunciation.audio_fetch import fetch_audio_from_id
from fastAPI.tests.test_audio_dns_rebinding import _AsyncStream, _SyncStream, _async_hops, _first_hop, _sync_hops

PUBLIC_PEER = ("93.184.216.34", 443)


def _response(content=b"x", headers=None, status=200):
    resp = httpx.Response(status, content=content, headers=headers or {}, request=httpx.Request("GET", "http://x"))
    resp.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=PUBLIC_PEER))}
    return resp


def _chunked_response(chunk, count, headers=None, asynchronous=False):
    def body():
        for _ in range(count):
            yield chunk

    async def abody():
        for _ in range(count):
            yield chunk

    resp = httpx.Response(200, content=abody() if asynchronous else body(), headers=headers or {}, request=httpx.Request("GET", "http://x"))
    resp.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=PUBLIC_PEER))}
    return resp


class TestReadCapped:
    def test_returns_body_within_limit(self):
        assert bd.read_capped(_response(b"abc"), 10) == b"abc"

    def test_rejects_declared_oversize_without_reading(self):
        resp = _response(b"abc", headers={"content-length": "999"})
        with patch.object(resp, "iter_bytes", side_effect=AssertionError("不該開始讀本文")):
            with pytest.raises(bd.DownloadLimitError):
                bd.read_capped(resp, 10)

    def test_stops_reading_once_the_stream_exceeds_the_limit(self):
        resp = _chunked_response(b"x" * 100, 1000)   # 沒有宣告 Content-Length（chunked）
        with pytest.raises(bd.DownloadLimitError):
            bd.read_capped(resp, 1000)

    def test_rejects_compressed_responses(self):
        with pytest.raises(bd.DownloadLimitError):
            bd.read_capped(_response(gzip.compress(b"abc"), headers={"content-encoding": "gzip"}), 10)


class TestFetchAudioFromId:
    @pytest.fixture(autouse=True)
    def _not_migrated(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: None)
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.is_safe_redirect_target", lambda url: True)

    def test_oversized_audio_is_refused(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.MAX_OFFICIAL_AUDIO_BYTES", 1000)
        big = _chunked_response(b"x" * 100, 1000)
        with _sync_hops(_first_hop("https://cdn.example.com/a.mp3"), big):
            with pytest.raises(Exception, match="音檔過大"):
                fetch_audio_from_id("word123")

    def test_declared_oversized_audio_is_refused(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.MAX_OFFICIAL_AUDIO_BYTES", 1000)
        with _sync_hops(_first_hop("https://cdn.example.com/a.mp3"), _response(b"x", headers={"content-length": "5000"})):
            with pytest.raises(Exception, match="音檔過大"):
                fetch_audio_from_id("word123")

    def test_oversized_resolver_body_is_not_treated_as_a_url(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.MAX_RESOLVER_BODY_BYTES", 50)
        huge_text = _response(b"https://cdn.example.com/" + b"a" * 500)
        with _sync_hops(huge_text):
            with pytest.raises(Exception, match="無法取得真正音檔 URL"):
                fetch_audio_from_id("word123")

    def test_verified_storage_copy_is_also_capped(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: "https://storage.example.com/a.mp3")
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.MAX_OFFICIAL_AUDIO_BYTES", 1000)
        with _sync_hops(_chunked_response(b"x" * 100, 1000)):
            with pytest.raises(Exception, match="音檔過大"):
                fetch_audio_from_id("word123")

    def test_storage_copy_must_be_https(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: "http://storage.example.com/a.mp3")
        with _sync_hops():
            with pytest.raises(Exception, match="音檔 URL 指向不允許的位址"):
                fetch_audio_from_id("word123")

    def test_storage_copy_pointing_at_a_private_target_is_refused_before_connecting(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: "https://internal.example.com/a.mp3")
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch.is_safe_redirect_target", lambda url: False)
        with _sync_hops():                      # 一次 stream() 都不該被呼叫
            with pytest.raises(Exception, match="音檔 URL 指向不允許的位址"):
                fetch_audio_from_id("word123")

    def test_storage_copy_whose_actual_peer_is_private_is_refused(self, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.pronunciation.audio_fetch._lookup_verified_audio_url", lambda audio_id: "https://storage.example.com/a.mp3")
        private = _response(b"secret")
        private.extensions = {"network_stream": MagicMock(get_extra_info=MagicMock(return_value=("10.0.0.5", 443)))}
        with _sync_hops(private):
            with pytest.raises(Exception, match="音檔 URL 指向不允許的位址"):
                fetch_audio_from_id("word123")


@pytest.fixture
def client():
    def fake_db():
        yield None

    async def fake_auth():
        return {"uid": "test-user"}

    app.dependency_overrides[get_db] = fake_db
    app.dependency_overrides[auth_module.verify_firebase_token] = fake_auth
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


class TestProxyAudio:
    def _get(self, client, second):
        with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
            with patch("fastAPI.routes.dictionary.audio_proxy.is_safe_redirect_target", return_value=True):
                with _async_hops(_first_hop("https://cdn.example.com/a.mp3"), second):
                    return client.get("/api/v1/dictionary/audio/some-file-id")

    def test_normal_audio_passes_through(self, client):
        response = self._get(client, _response(b"fake-audio", headers={"content-type": "audio/mpeg"}))
        assert response.status_code == 200
        assert response.content == b"fake-audio"

    def test_oversized_stream_gets_502_not_buffered(self, client, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.dictionary.audio_proxy.MAX_OFFICIAL_AUDIO_BYTES", 1000)
        response = self._get(client, _chunked_response(b"x" * 100, 1000, asynchronous=True))
        assert response.status_code == 502
        assert response.text == "Audio file too large"

    def test_declared_oversize_gets_502(self, client, monkeypatch):
        monkeypatch.setattr("fastAPI.routes.dictionary.audio_proxy.MAX_OFFICIAL_AUDIO_BYTES", 1000)
        response = self._get(client, _response(b"x", headers={"content-length": "999999"}))
        assert response.status_code == 502
