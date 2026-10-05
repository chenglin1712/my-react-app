"""參考音檔下載必須有大小上限（P1：原本整份讀進記憶體，無上限）。"""
import asyncio

import httpx

from fastAPI.routes.pronunciation.audio_fetch import download_reference_audio


def _run(handler, max_bytes=1000):
    async def go():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
            return await download_reference_audio(client, "https://firebasestorage.googleapis.com/x", max_bytes)
    return asyncio.run(go())


def test_returns_bytes_when_within_limit():
    assert _run(lambda req: httpx.Response(200, content=b"a" * 500)) == b"a" * 500


def test_rejects_when_declared_content_length_exceeds_limit():
    def handler(req):
        return httpx.Response(200, headers={"content-length": "999999"}, content=b"a" * 10)

    assert _run(handler) is None


def test_stops_when_streamed_body_exceeds_limit_without_content_length():
    class Body(httpx.AsyncByteStream):
        def __init__(self):
            self.sent = 0

        async def __aiter__(self):
            for _ in range(100):
                self.sent += 100
                yield b"a" * 100

    body = Body()
    result = _run(lambda req: httpx.Response(200, stream=body), max_bytes=1000)
    assert result is None
    assert body.sent < 100 * 100  # 超過上限就中斷，沒有把整份讀完


def test_non_200_and_redirect_are_skipped():
    assert _run(lambda req: httpx.Response(404, content=b"nope")) is None
    assert _run(lambda req: httpx.Response(302, headers={"location": "http://169.254.169.254/"})) is None
