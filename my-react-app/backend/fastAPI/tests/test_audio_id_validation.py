"""稽核 FIL-1：字典音檔代理與發音比對的 file_id／audio_id 格式驗證。

file_id 會被接在固定的 ILRDF 下載網址後面。沒有格式限制時，登入使用者能放進斜線、問號、%2e%2e 等，
讓伺服器對固定主機發出路徑或查詢字串不同的 GET。
"""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from config import audio_source
from dictionary_db.connect import get_db
from fastAPI.main import app
from fastAPI.rate_limit import limiter
from fastAPI.routes import auth as auth_module


def _fake_get_db():
    yield None


async def _fake_auth():
    return {"uid": "test-user"}


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = _fake_get_db
    app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
    limiter.reset()
    try:
        with patch("fastAPI.rate_limit_config.get_configured_rate", side_effect=lambda key, default: default):
            with TestClient(app) as test_client:
                yield test_client
    finally:
        app.dependency_overrides.clear()
        limiter.reset()


@pytest.mark.parametrize("value", [
    "abc", "A1-b_2.c", "7f3e9c1a-0b2d-4e5f-8a6b-1c2d3e4f5a6b", "a" * 128, "file.mp3", "...a",
])
def test_ordinary_ids_are_valid(value):
    assert audio_source.is_valid_audio_id(value)


@pytest.mark.parametrize("value", [
    "", ".", "..", "a/b", "../x", "a?x=1", "a#f", "a%2e%2e", "a b", "a\n", "a\r\nb", "é", "a;b", "a@b", "a\\b",
    "a" * 129, None, 123,
])
def test_hostile_or_malformed_ids_are_invalid(value):
    assert not audio_source.is_valid_audio_id(value)


def test_build_url_quotes_and_refuses_bad_ids(monkeypatch):
    monkeypatch.delenv("AUDIO_FILE_URL", raising=False)
    assert audio_source.build_ilrdf_audio_url("abc-1.mp3") == audio_source.get_ilrdf_audio_api() + "abc-1.mp3"
    with pytest.raises(ValueError):
        audio_source.build_ilrdf_audio_url("../etc")
    with pytest.raises(ValueError):
        audio_source.build_ilrdf_audio_url("a?b=1")


@pytest.mark.parametrize("path", [
    "a/b", "x%3Fy%3D1", "a%23b", "a%20b", "%E9", "a%0Ab", "a" * 129,
])
def test_proxy_rejects_malformed_ids_without_any_outbound_request(client, path):
    with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset") as lookup, \
            patch("httpx.AsyncClient.stream") as stream:
        response = client.get(f"/api/v1/dictionary/audio/{path}")
    assert response.status_code in (404, 422)
    lookup.assert_not_called()
    stream.assert_not_called()


@pytest.mark.parametrize("path", [".", ".."])
def test_proxy_rejects_dot_segments(client, path):
    with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset") as lookup, \
            patch("httpx.AsyncClient.stream") as stream:
        response = client.get(f"/api/v1/dictionary/audio/{path}")
    assert response.status_code in (404, 422)
    lookup.assert_not_called()
    stream.assert_not_called()


def test_proxy_still_serves_an_ordinary_id(client):
    with patch("fastAPI.routes.dictionary.audio_proxy._lookup_verified_audio_asset", return_value=None):
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = httpx.Response(status_code=404, request=httpx.Request("GET", "http://x"))
            response = client.get("/api/v1/dictionary/audio/7f3e9c1a-0b2d-4e5f-8a6b-1c2d3e4f5a6b")
    assert response.status_code == 404
    assert response.text != "音檔代號格式不合法"


def test_pronunciation_fetch_refuses_dot_segments_before_any_request():
    from fastAPI.routes.pronunciation import audio_fetch

    with patch.object(audio_fetch, "_lookup_verified_audio_url", return_value=None), \
            patch.object(audio_fetch.httpx, "Client") as http_client:
        for bad in ("..", ".", "a/b"):
            with pytest.raises(ValueError):
                audio_fetch.fetch_audio_from_id(bad)
    http_client.assert_not_called()


@pytest.mark.parametrize("audio_id", ["..", ".", "a/b", "a\n"])
def test_compare_audio_rejects_dot_segments_and_newline(audio_id):
    import asyncio

    from fastAPI.routes.pronunciation import api as pronunciation_api

    with patch.object(pronunciation_api.model, "_ffmpeg_path", "ffmpeg"):
        result = asyncio.run(pronunciation_api._compare_uploaded_audio(None, audio_id, ""))
    assert result["success"] is False and result["error_step"] == "invalid_audio_id"
