"""發音比對要用到的官方／真人參考音檔下載邏輯——跟 model.py（拿到 bytes
之後怎麼轉成向量）是完全不同的關注點，這裡只管「音檔從哪裡來、安全地
下載回來」。
"""
from urllib.parse import urlparse

import httpx

from config.audio_source import get_ilrdf_audio_api
from config.bounded_download import (
    IDENTITY_ENCODING_HEADERS, MAX_OFFICIAL_AUDIO_BYTES, MAX_RESOLVER_BODY_BYTES, DownloadLimitError, read_capped,
)
from config.media_source import get_media_source_mode
from config.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target
from dictionary_db.connect import SessionLocal
from dictionary_db.model import MediaAsset

# reference_urls 是前端傳入、後端直接發 GET 請求的網址（真人參考音檔），若不限制網域，
# 等於讓伺服器變成一個開放的請求轉發器（SSRF）：可被用來對內網位址（例如雲端環境的
# metadata endpoint 169.254.169.254）或任意外部主機發出請求。只允許 Firebase Storage
# 的公開音檔網域，且限定 https。
_ALLOWED_REF_HOSTS = ("firebasestorage.googleapis.com", "storage.googleapis.com")


def _is_allowed_reference_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in _ALLOWED_REF_HOSTS)


# 1. 下載語音
def _lookup_verified_audio_url(audio_id: str):
    """P5 辭典媒體自主化：查這個 file_id 是否已經有遷移完成的自有 Storage
    副本，有的話回傳 public_url，沒有回傳 None。這支函式本身是同步函式、被
    asyncio.to_thread 呼叫，不是 FastAPI request-scoped，沒有 Depends(get_db)
    可用，比照 crawler/dictionary_source.py 既有的「db = SessionLocal();
    try/finally: db.close()」慣例（跟 audio_proxy.py 的 kind 命名一致，見
    該檔案的 _AUDIO_MEDIA_KIND 說明——word_audio／sentence_audio 共用同一個
    "ilrdf_audio" kind）。"""
    db = SessionLocal()
    try:
        asset = db.query(MediaAsset).filter_by(
            source_provider="ilrdf", source_kind="ilrdf_audio", source_locator=audio_id, status="verified",
        ).first()
        return asset.public_url if asset else None
    finally:
        db.close()


async def download_reference_audio(client: httpx.AsyncClient, url: str, max_bytes: int):
    """下載單一真人參考音檔，回傳 bytes；被重導向、HTTP 狀態非 200 或內容超過
    max_bytes 時回傳 None（呼叫端把這份參考音檔略過即可）。

    原本直接 `resp.content` 把整份回應讀進記憶體，10 MB 上限只套用在使用者上傳的
    user_audio，參考音檔完全沒有大小限制：登入者能提供最多 5 個合法的 Firebase
    Storage 網址指向超大物件，讓服務逐一下載、解碼，耗盡記憶體與 CPU。改成串流，
    先看 Content-Length，再邊讀邊計數，超過上限就立刻中斷、不繼續下載。"""
    # 要求不壓縮，並拒絕任何有 Content-Encoding 的回應：httpx 的 aiter_bytes() 會先在記憶體
    # 解壓縮再交給我們計數，高壓縮比的回應（壓縮炸彈）可能單一個 chunk 就解壓出遠大於上限的
    # 資料，等我們發現超限時記憶體尖峰已經發生。Firebase Storage 的音檔本來就是原樣回傳，
    # 不需要壓縮；改用 aiter_raw() 計數也不行，那樣只限制了「壓縮後」大小。
    async with client.stream("GET", url, headers={"Accept-Encoding": "identity"}) as resp:
        if resp.is_redirect or resp.status_code != 200:
            return None
        if resp.headers.get("content-encoding", "identity").strip().lower() not in ("", "identity"):
            return None
        declared = resp.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            return None
        chunks = []
        total = 0
        async for chunk in resp.aiter_bytes():
            total += len(chunk)
            if total > max_bytes:
                return None
            chunks.append(chunk)
        return b"".join(chunks)


def fetch_audio_from_id(audio_id: str):
    # P5 辭典媒體自主化：發音比對功能每次使用者錄音都要抓一次官方音檔，使用
    # 頻率遠高於單純播放——優先用自己 Storage 的已驗證副本，不用每次都跟
    # ILRDF 要一次。
    public_url = _lookup_verified_audio_url(audio_id)
    if public_url:
        # public_url 來自資料庫：資料被誤寫或匯入污染時，不能讓後端連去內網或 metadata 位址。
        # 只接受 https，並在讀本文之前確認實際連線的對象（理由同下面 ILRDF 的第二次請求）。
        if not public_url.startswith("https://") or not is_safe_redirect_target(public_url):
            raise Exception("音檔 URL 指向不允許的位址")
        # 串流並限制大小（見 config/bounded_download.py）：不先把整個回應讀進記憶體
        with httpx.Client(timeout=15, follow_redirects=False) as client:
            with client.stream("GET", public_url, headers=IDENTITY_ENCODING_HEADERS) as resp:
                try:
                    assert_response_from_safe_peer(resp)
                except UnsafeConnectionError:
                    raise Exception("音檔 URL 指向不允許的位址")
                if resp.status_code != 200:
                    raise Exception(f"下載音檔失敗 (HTTP {resp.status_code})")
                try:
                    return read_capped(resp, MAX_OFFICIAL_AUDIO_BYTES)
                except DownloadLimitError:
                    raise Exception("音檔過大，拒絕下載")

    if get_media_source_mode() == "storage_only":
        raise Exception("音檔尚未遷移完成，暫時無法比對")

    # hybrid 模式（預設）：還沒遷移到的詞條，照舊即時代理 ILRDF，行為完全不變。
    # 網址單一資料來源見 config/audio_source.py：原本這裡跟 dictionary/
    # audio_proxy.py 的 debug_audio 各自讀環境變數，audio_proxy.py 的正式路徑
    # （proxy_audio，全站辭典發音實際在走的路徑）卻是另一個寫死的 Python 常數，
    # 三處各自一份、容易改了環境變數卻漏改寫死常數那條路徑。
    api_url = get_ilrdf_audio_api() + audio_id

    # 第一次請求取得重導向 URL。回應本文只是一段網址文字，讀取時限制在幾 KB 內。
    with httpx.Client(timeout=10, follow_redirects=False) as client:
        with client.stream("GET", api_url, headers=IDENTITY_ENCODING_HEADERS) as resp:
            if resp.status_code in [301, 302, 303, 307, 308]:
                final_url = resp.headers.get("Location")
            else:
                try:
                    final_url = read_capped(resp, MAX_RESOLVER_BODY_BYTES).decode("utf-8", "replace").strip()
                except DownloadLimitError:
                    final_url = None

    if not final_url or not final_url.startswith("http"):
        raise Exception("無法取得真正音檔 URL")

    # 第二次請求的目標網址完全由第一次請求的回應內容決定，發出前先擋掉明顯
    # 指向內網／loopback／link-local（含雲端 metadata endpoint）的位址，
    # 避免被當成 SSRF 跳板（見 url_safety.py 說明，跟 compare_audio.reference_urls
    # 已經修好的白名單機制互補）。
    if not is_safe_redirect_target(final_url):
        raise Exception("音檔 URL 指向不允許的位址")

    # 第二次請求下載真正音檔。這裡改用 httpx（而非 requests）：is_safe_redirect_target
    # 剛剛做的 DNS 解析，跟接下來實際連線時重新做的 DNS 解析是兩次獨立的查詢——
    # 如果網域在中間變更了解析結果（低 TTL、DNS rebinding），前面的檢查就形同
    # 虛設。httpx 能在連線建立「之後」告訴我們實際連到的是哪個 IP
    # （response.extensions["network_stream"]），藉此改成檢查「真正被拿去
    # 收發資料的那個位址」本身安全（見 url_safety.py 的
    # assert_response_from_safe_peer），不再只依賴檢查當下的解析結果。
    #
    # 串流下載並限制大小（見 config/bounded_download.py）：連線對象的檢查在讀取本文「之前」做，
    # 不安全就一個位元組都不讀。
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        with client.stream("GET", final_url, headers=IDENTITY_ENCODING_HEADERS) as audio_resp:
            try:
                assert_response_from_safe_peer(audio_resp)
            except UnsafeConnectionError:
                raise Exception("音檔 URL 指向不允許的位址")

            if audio_resp.status_code != 200:
                raise Exception(f"下載音檔失敗 (HTTP {audio_resp.status_code})")

            try:
                return read_capped(audio_resp, MAX_OFFICIAL_AUDIO_BYTES)
            except DownloadLimitError:
                raise Exception("音檔過大，拒絕下載")
