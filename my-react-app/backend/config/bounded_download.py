"""從第三方（官方辭典音檔來源、Firebase Storage）下載內容時的大小上限。

原本辭典音檔代理與發音比對的官方音檔下載都是 `client.get(url)` 再讀 `.content`：整份回應先
完整進到記憶體才知道多大。來源（或被導向的網址）回一個超大檔案，單一請求就能吃掉大量記憶體，
而這些端點雖然要登入，登入者可以一直打。

這裡的做法是先看 Content-Length，再邊讀邊計數，超過上限立刻中斷、不再繼續下載。
一律要求 `Accept-Encoding: identity` 並拒絕有 Content-Encoding 的回應：httpx 讀取時會先在記憶體
解壓縮再交給我們計數，高壓縮比的回應（壓縮炸彈）可能單一個區塊就解出遠超過上限的資料。
"""

# 一支音檔（單字或句子的 mp3／wav）遠小於這個數字；與發音比對的使用者上傳上限（10 MB）一致
MAX_OFFICIAL_AUDIO_BYTES = 10 * 1024 * 1024
# 第一次請求回來的只是「真正音檔網址」的純文字，幾百位元組就夠
MAX_RESOLVER_BODY_BYTES = 8 * 1024

IDENTITY_ENCODING_HEADERS = {"Accept-Encoding": "identity"}


class DownloadLimitError(Exception):
    """回應超過大小上限，或帶有無法在解壓前限制大小的壓縮編碼。"""


def _check_headers(response, max_bytes: int) -> None:
    encoding = (response.headers.get("content-encoding") or "identity").strip().lower()
    if encoding not in ("", "identity"):
        raise DownloadLimitError("回應帶有壓縮編碼，無法在解壓前限制大小")
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise DownloadLimitError(f"回應宣告的大小 {declared} 超過上限 {max_bytes}")


def read_capped(response, max_bytes: int) -> bytes:
    """讀取一個以 `client.stream()` 開啟的同步 httpx 回應，超過 max_bytes 就丟 DownloadLimitError。"""
    _check_headers(response, max_bytes)
    chunks = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise DownloadLimitError(f"回應超過上限 {max_bytes}")
        chunks.append(chunk)
    return b"".join(chunks)


async def aread_capped(response, max_bytes: int) -> bytes:
    """`read_capped` 的非同步版本，給 `AsyncClient.stream()` 用。"""
    _check_headers(response, max_bytes)
    chunks = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise DownloadLimitError(f"回應超過上限 {max_bytes}")
        chunks.append(chunk)
    return b"".join(chunks)
