"""對外下載邏輯：ILRDF 兩段式網址解析、限速、重試、串流下載＋SSRF 防護。
跟 storage.py（下載完之後怎麼傳到 Firebase）、asset_repository.py（DB 狀態
機）是不同關注點，這裡只管「怎麼安全、有節制地把 bytes 從外部來源抓回來」。
"""
import asyncio
import random
import time

import httpx

from config.audio_source import get_ilrdf_audio_api
from config.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target

from . import sniff

_CONNECT_TIMEOUT = 5.0
_RESOLVE_TIMEOUT = 10.0

_BACKOFF_SCHEDULE = [1, 2, 4, 8, 16]
_MAX_HTTP_RETRIES = 5
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class _FetchError(Exception):
    """terminal=True 代表重試也沒用（400/403/404/內容不合法/被 SSRF 檢查擋下），
    terminal=False 代表可能只是暫時性問題（timeout/連線失敗/429/5xx）。"""

    def __init__(self, message, *, terminal):
        super().__init__(message)
        self.terminal = terminal


class _RateLimiter:
    """全域 token 間隔限流：每次外部 HTTP 請求前呼叫一次 wait()，
    確保任何時刻對外請求頻率不超過 per_second。用一個 asyncio.Lock 保護
    _next_time，多個 worker 共用同一個限流器時仍然正確：搶到 lock 的那個
    worker 先預約下一個可用時間槽再放掉 lock，其他 worker 不會拿到同一個
    時槽。"""

    def __init__(self, per_second: float):
        self._interval = 1.0 / per_second if per_second > 0 else 0.0
        self._lock = asyncio.Lock()
        self._next_time = 0.0

    async def wait(self):
        if self._interval <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            wait_for = max(0.0, self._next_time - now)
            self._next_time = max(now, self._next_time) + self._interval
        if wait_for > 0:
            await asyncio.sleep(wait_for)


async def _with_retry(coro_factory):
    """coro_factory 是一個不吃參數、每次呼叫都回傳新 coroutine 的函式
    （coroutine 只能 await 一次，重試必須每次重新建立，見呼叫端的 lambda）。"""
    last_exc = None
    for attempt in range(_MAX_HTTP_RETRIES):
        try:
            return await coro_factory()
        except _FetchError as exc:
            last_exc = exc
            if exc.terminal or attempt == _MAX_HTTP_RETRIES - 1:
                raise
            delay = _BACKOFF_SCHEDULE[min(attempt, len(_BACKOFF_SCHEDULE) - 1)]
            delay += random.uniform(0, delay * 0.3)
            await asyncio.sleep(delay)
    raise last_exc


async def _resolve_ilrdf_url(client, rate_limiter, file_id):
    """比照 audio_proxy.py 的 proxy_audio：第一次請求解析出真正的音檔網址。
    先依 HTTP 狀態碼分類（跟 _fetch_bytes 一致），200 才把回應內容當純文字
    URL 解析——上游回 429/5xx 時本體不一定是有效 URL，之前的寫法會誤判成
    「沒解析出網址」而永久判死，其實應該重試。"""
    await rate_limiter.wait()
    try:
        res = await client.get(
            get_ilrdf_audio_api() + file_id,
            timeout=httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_RESOLVE_TIMEOUT, write=_RESOLVE_TIMEOUT, pool=_RESOLVE_TIMEOUT),
        )
    except httpx.TimeoutException as exc:
        raise _FetchError(f"ILRDF 解析逾時：{exc}", terminal=False)
    except httpx.ConnectError as exc:
        raise _FetchError(f"ILRDF 無法連線：{exc}", terminal=False)
    except httpx.HTTPError as exc:
        raise _FetchError(f"ILRDF 解析失敗：{exc}", terminal=False)

    if res.status_code in (301, 302, 303, 307, 308):
        final_url = res.headers.get("Location", "")
    elif res.status_code in _RETRYABLE_STATUS_CODES:
        raise _FetchError(f"ILRDF 解析遇到暫時性錯誤：HTTP {res.status_code}", terminal=False)
    elif res.status_code != 200:
        raise _FetchError(f"ILRDF 解析失敗：HTTP {res.status_code}", terminal=True)
    else:
        final_url = res.text.strip()

    if not final_url or "http" not in final_url:
        raise _FetchError(f"ILRDF 沒有解析出有效網址（file_id={file_id}）", terminal=True)
    if not await asyncio.to_thread(is_safe_redirect_target, final_url):
        raise _FetchError(f"ILRDF 解析出的網址被 SSRF 檢查擋下：{final_url}", terminal=True)
    return final_url


async def _stream_fetch_once(client, url, *, timeout, max_bytes, family):
    """單次串流下載，回傳 ("content", bytes, content_type) 或
    ("redirect", target_url)。用 client.stream() 而不是 client.get()：
    後者會先把整個回應收進記憶體才給呼叫端檢查大小，上游若回傳異常大的內容，
    max_bytes 上限完全不會生效，要等整份下載完才判斷。這裡邊讀 chunk 邊累計
    大小，一超過上限立刻中止，不會把過大的內容整個吃進記憶體。"""
    async with client.stream("GET", url, timeout=timeout, follow_redirects=False) as res:
        if res.status_code in (301, 302, 303, 307, 308):
            return ("redirect", res.headers.get("Location", ""))
        if res.status_code in _RETRYABLE_STATUS_CODES:
            raise _FetchError(f"上游暫時性錯誤：HTTP {res.status_code}", terminal=False)
        if res.status_code != 200:
            raise _FetchError(f"HTTP {res.status_code}", terminal=True)

        try:
            assert_response_from_safe_peer(res)
        except UnsafeConnectionError as exc:
            raise _FetchError(str(exc), terminal=True)

        content_length = res.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > max_bytes:
                    raise _FetchError(
                        f"Content-Length 超過大小上限（{content_length} > {max_bytes}）", terminal=True
                    )
            except ValueError:
                pass

        chunks = []
        total = 0
        async for chunk in res.aiter_bytes():
            total += len(chunk)
            if total > max_bytes:
                raise _FetchError(f"下載內容超過大小上限（>{max_bytes} bytes）", terminal=True)
            chunks.append(chunk)
        content = b"".join(chunks)

    if not content:
        raise _FetchError("下載內容是空的", terminal=True)
    content_type = sniff._sniff_content_type(content, family)
    if content_type is None:
        preview = content[:16]
        raise _FetchError(f"內容不是可辨識的{family}格式（開頭 bytes={preview!r}）", terminal=True)
    return ("content", content, content_type)


async def _fetch_bytes(client, rate_limiter, url, *, read_timeout, max_bytes, family):
    """下載實際內容，最多跟一次 redirect（跟 audio_proxy.py 同樣只信任一跳），
    並用 assert_response_from_safe_peer 防 DNS rebinding。"""
    await rate_limiter.wait()
    timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=read_timeout, write=read_timeout, pool=read_timeout)
    try:
        result = await _stream_fetch_once(client, url, timeout=timeout, max_bytes=max_bytes, family=family)
    except httpx.TimeoutException as exc:
        raise _FetchError(f"下載逾時：{exc}", terminal=False)
    except httpx.ConnectError as exc:
        raise _FetchError(f"無法連線：{exc}", terminal=False)
    except httpx.HTTPError as exc:
        raise _FetchError(f"下載失敗：{exc}", terminal=False)

    if result[0] == "redirect":
        redirect_target = result[1]
        if not await asyncio.to_thread(is_safe_redirect_target, redirect_target):
            raise _FetchError(f"重導向網址被 SSRF 檢查擋下：{redirect_target}", terminal=True)
        await rate_limiter.wait()
        try:
            result = await _stream_fetch_once(client, redirect_target, timeout=timeout, max_bytes=max_bytes, family=family)
        except httpx.TimeoutException as exc:
            raise _FetchError(f"下載逾時：{exc}", terminal=False)
        except httpx.ConnectError as exc:
            raise _FetchError(f"無法連線：{exc}", terminal=False)
        except httpx.HTTPError as exc:
            raise _FetchError(f"下載失敗：{exc}", terminal=False)
        if result[0] == "redirect":
            raise _FetchError("重導向超過一跳，拒絕繼續跟隨", terminal=True)

    _, content, content_type = result
    return content, content_type
