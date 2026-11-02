"""稽核 FIL-1／FIL-2：媒體遷移指令的下載器（media_migration/fetcher.py）。

- file_id 來自資料庫，和辭典音檔代理一樣要先驗證格式才能接在 ILRDF 網址後面。
- 第二跳下載要先把網域解析一次、檢查所有結果，然後直接連那個 IP（連線時不再有第二次 DNS 查詢）。
"""
import asyncio
from unittest.mock import patch

import httpx
from django.test import SimpleTestCase

from adminapi.management.commands.media_migration import fetcher


def _addr(ip):
    return [(2, 1, 6, "", (ip, 443))]


class ResolveFileIdTests(SimpleTestCase):
    def _resolve(self, file_id, handler=None):
        seen = []

        def default_handler(request):
            seen.append(str(request.url))
            return httpx.Response(200, text="https://cdn.example.com/a.mp3")

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler or default_handler)) as client:
                return await fetcher._resolve_ilrdf_url(client, fetcher._RateLimiter(0), file_id)

        with patch.object(fetcher, "is_safe_redirect_target", return_value=True):
            return asyncio.run(run()), seen

    def test_ordinary_ids_are_requested_against_the_ilrdf_api(self):
        url, seen = self._resolve("7f3e9c1a-0b2d-4e5f-8a6b-1c2d3e4f5a6b")
        self.assertEqual(url, "https://cdn.example.com/a.mp3")
        self.assertTrue(seen[0].endswith("/7f3e9c1a-0b2d-4e5f-8a6b-1c2d3e4f5a6b"))

    def test_hostile_ids_are_refused_before_any_request(self):
        for bad in ("..", ".", "../x", "a/b", "a?x=1", "a#f", "a%2e%2e", "a\n"):
            with self.subTest(file_id=bad):
                seen = []

                def handler(request, seen=seen):
                    seen.append(str(request.url))
                    return httpx.Response(200, text="https://cdn.example.com/a.mp3")

                with self.assertRaises(fetcher._FetchError) as ctx:
                    self._resolve(bad, handler)
                self.assertTrue(ctx.exception.terminal)
                self.assertEqual(seen, [])


class PinnedDownloadTests(SimpleTestCase):
    def _fetch(self, handler, url="https://cdn.example.com/a.mp3", addr="93.184.216.34"):
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await fetcher._stream_fetch_once(
                    client, url, timeout=httpx.Timeout(5), max_bytes=1024, family="audio",
                )

        with patch("config.url_safety.socket.getaddrinfo", return_value=_addr(addr)), \
                patch.object(fetcher, "assert_response_from_safe_peer"), \
                patch.object(fetcher.sniff, "_sniff_content_type", return_value="audio/mpeg"):
            return asyncio.run(run())

    def test_the_request_goes_to_the_checked_ip_with_the_original_host(self):
        seen = {}

        def handler(request):
            seen["url"], seen["host"] = str(request.url), request.headers["host"]
            seen["sni"], seen["connection"] = request.extensions.get("sni_hostname"), request.headers.get("connection")
            return httpx.Response(200, content=b"ID3....")

        result = self._fetch(handler)
        self.assertEqual(result[0], "content")
        self.assertEqual(seen, {
            "url": "https://93.184.216.34/a.mp3", "host": "cdn.example.com", "sni": "cdn.example.com", "connection": "close",
        })

    def test_a_target_that_resolves_to_a_private_address_is_never_requested(self):
        called = []
        with self.assertRaises(fetcher._FetchError) as ctx:
            self._fetch(lambda request: called.append(request) or httpx.Response(200, content=b"x"), addr="100.100.100.200")
        self.assertTrue(ctx.exception.terminal)
        self.assertEqual(called, [])
