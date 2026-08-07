"""把辭典音檔／圖片從外部來源搬到自己的 Firebase Storage，DB 只改指標
（P5 辭典媒體自主化）。

背景：辭典的文字資料（單字、釋義、例句）已經在自己的 PostgreSQL，但媒體完全
依賴外部——word_audio／word_explanation_sentence_audio 的 file_id 要即時打
ILRDF API 兩段式解析才拿得到真檔；word_explanation_image.image_url、
words.word_img 是完整外部 URL，前端直接連。外部來源一旦不可用，音檔要乾等
才靜默失敗、圖片變破圖。

四種 --source-kind，來源性質不同（重要——不要混著跑）：
    word_audio         ILRDF 官方兩段式音檔 API（file_id）
    sentence_audio      同上，例句音檔
    explanation_image   ILRDF／承包商官方釋義示意圖（完整 URL，單段直接抓）
    word_img            Bing 圖片搜尋縮圖／商業圖庫（完整 URL，單段直接抓）——
                         使用者已知悉這批來源跟 ILRDF 官方媒體性質不同、風險
                         也不同，仍決定一併遷移

media_asset.source_kind 跟上面四個 CLI 值故意不是一對一：word_audio／
sentence_audio 實測有 8 個 file_id 同時出現在兩張來源表（file_id 是 ILRDF
自己系統裡的資源 ID，是跨這兩張表的同一個命名空間，不是我們自己配發的），
而 /audio/{file_id} 端點只收得到 file_id、並不知道這次播放請求原本是從
word_audio 還是 sentence_audio 來的。兩者在 media_asset 統一成同一個
"ilrdf_audio" kind，讀取路徑才能只憑 file_id 查得到，那 8 個撞號的 file_id
也會自然去重（見 _MEDIA_ASSET_KIND）。

設計成 asset-level checkpoint 的粗粒度狀態機（不做 byte-range 續傳，這批
檔案平均只有幾十 KB～1MB，做續傳不划算；也不細分 downloading/downloaded/
uploading/uploaded 這幾個中間態，crash 後一律從頭重新下載+上傳，object
path 是內容 SHA-256，重傳頂多是覆寫同一個 path，不會產生垃圾物件）：
    downloading -> verified
                \-> failed_retryable / failed_terminal
DB 只存「已驗證完成的自有副本」這件事（media_asset 表 + 三張來源表的
nullable media_asset_id FK），原始 file_id／image_url／word_img 完全不動，
繼續當 provenance／過渡期 fallback（見 audio_proxy.py 的 MEDIA_SOURCE_MODE）。

冪等／可斷點續跑：(source_provider, source_kind, source_locator) 是 media_asset
的唯一鍵，重跑同一批只會跳過已經 verified 的項目。同一個 locator 被多筆
來源列引用時（explanation_image 540 筆裡有 136 筆是重複 URL），同一次執行
內只下載/上傳一次，完成後一次回填所有引用它的來源列（見 _list_candidates
的 groupby）。程序中途被中斷（Ctrl+C／當機）留在 downloading 狀態的項目，
10 分鐘後視為卡住，下次執行會自動重新認領——這裡刻意不做 asyncio 訊號式的
優雅關閉（Windows 的 ProactorEventLoop 對 SIGINT 訊號處理本來就不可靠），
改用這個 staleness recovery 達到「安全中斷、之後重跑會自動接上」的效果。

**操作假設：同一時間只跑一個這支指令的 process**（單一操作者手動執行的批次
腳本，不是常駐多 worker 服務）。finalize 有做「目前狀態必須還是 downloading
才能寫入結果」的防禦性檢查，避免真的有兩個 process 重疊執行時，較舊的呼叫
蓋掉較新的結果，但這不是完整的 fencing token 機制，仍然不建議刻意同時跑
兩個 process。

用法：
    python manage.py migrate_dictionary_media --source-kind word_audio --tribe paiwan --limit 50
    python manage.py migrate_dictionary_media --source-kind word_img --rate 2 --concurrency 2
    python manage.py migrate_dictionary_media --source-kind word_audio --retry-failed

速率／並行度刻意保守起跑（--rate 預設 4 次外部 HTTP 請求/秒、--concurrency
預設 4）：音檔一筆要兩次上游請求（先解析、再下載），對外實際大約是
2 個 asset/秒，等穩定後再視情況調高，不要一開始就對 ILRDF／Bing 開大量並行
連線——那些不是我們自己的服務，不該把它們當成可以隨意打的內部服務。
--concurrency 是實際同時執行的 worker 數（固定數量的 worker 從佇列拉工作，
不是一次把全部候選都建成 asyncio task）。
"""
import asyncio
import contextlib
import hashlib
import os
import random
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse

import httpx
from django.core.management.base import BaseCommand, CommandError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from adminapi.firebase_ops import upload_media_object
from config.audio_source import get_ilrdf_audio_api
from config.tribes import TRIBE_IDS
from dictionary_db.connect import SessionLocal, dictionary_write_session, engine
from dictionary_db.model import (
    MediaAsset,
    Word,
    WordAudio,
    WordExplanation,
    WordExplanationImage,
    WordExplanationSentence,
    WordExplanationSentenceAudio,
)
from fastAPI.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target

_OWNING_TABLE = {
    "word_audio": WordAudio,
    "sentence_audio": WordExplanationSentenceAudio,
    "explanation_image": WordExplanationImage,
    "word_img": None,
}
_SOURCE_PROVIDER = {
    "word_audio": "ilrdf",
    "sentence_audio": "ilrdf",
    "explanation_image": "ilrdf",
    "word_img": "bing_or_thirdparty",
}
_MEDIA_ASSET_KIND = {
    "word_audio": "ilrdf_audio",
    "sentence_audio": "ilrdf_audio",
    "explanation_image": "explanation_image",
    "word_img": "word_img",
}
_FAMILY_BY_SOURCE_KIND = {
    "word_audio": "audio",
    "sentence_audio": "audio",
    "explanation_image": "image",
    "word_img": "image",
}
# 圖片實測約 1.2MB、音檔約 20~115KB，上限抓寬鬆一點防止極端離群值，
# 不是抓「剛好夠用」的緊繃值
_MAX_BYTES = {
    "word_audio": 5 * 1024 * 1024,
    "sentence_audio": 5 * 1024 * 1024,
    "explanation_image": 15 * 1024 * 1024,
    "word_img": 15 * 1024 * 1024,
}
_READ_TIMEOUT = {
    "word_audio": 30,
    "sentence_audio": 30,
    "explanation_image": 60,
    "word_img": 60,
}
_CONNECT_TIMEOUT = 5.0
_RESOLVE_TIMEOUT = 10.0
_VERIFY_TIMEOUT = 15.0

# 後台 MediaUploadField.jsx 上傳音檔的既有 bug：把 Cloudinary 的完整
# secure_url 寫進 word_audio.file_id，不是 ILRDF 的 file_id GUID（audio_proxy.py
# 原本 `ILRDF_BASE + file_id` 的播放路徑對這種 file_id 一樣會壞掉，這不是這次
# 遷移造成的既有問題）。遇到看起來是完整 URL 的 file_id，只信任這個已知網域
# 直接當一般 URL 下載，其餘網域一律當 terminal 失敗、留給人工檢查，不能對
# 任意「看起來像 URL 的 file_id」開放下載。
_TRUSTED_ABSOLUTE_SOURCE_DOMAINS = {"res.cloudinary.com"}

_IMAGE_SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
]
_EXTENSION_BY_CONTENT_TYPE = {
    "audio/mpeg": ".mp3",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}

_BACKOFF_SCHEDULE = [1, 2, 4, 8, 16]
_MAX_HTTP_RETRIES = 5
_MAX_DB_ATTEMPTS = 5
_STALE_AFTER = timedelta(minutes=10)
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
_IN_PROGRESS_STATUSES = ("downloading", "uploading")
# 固定值，只要跟專案裡其他可能用到 Postgres advisory lock 的地方不撞就好——
# 目前專案沒有其他地方用這個機制。
_ADVISORY_LOCK_KEY = 811202501


@contextlib.contextmanager
def _single_instance_guard():
    """避免真的有人不小心同時跑兩個這支指令的 process。finalize 那邊的
    「狀態守衛」（status 必須還是 downloading/uploading 才寫入結果）只能防止
    較舊的呼叫覆蓋已經 committed 的較新結果，防不了「較舊的 failure 搶先把
    asset 定案成 failed_*，較新的 success 因此被狀態守衛擋下、白白浪費一次
    下載/上傳」這種較新結果被丟棄的情況。用 Postgres session-level advisory
    lock 做最低複雜度的 command-level 互斥：整個 process 生命週期都持有同一個
    連線＋鎖，第二個 process 啟動時嘗試拿鎖會立刻拿不到、直接報錯退出，不會
    真的跑起來跟第一個 process 打架。

    只在 Postgres 生效——SQLite（本機開發用）沒有 advisory lock 這個概念，
    本機開發本來就是單機單一開發者在跑，不需要跨 process 保護。
    """
    if engine.dialect.name != "postgresql":
        yield
        return

    conn = engine.connect()
    try:
        got_lock = conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _ADVISORY_LOCK_KEY}).scalar()
        if not got_lock:
            raise CommandError(
                "偵測到已經有另一個 migrate_dictionary_media process 在執行中"
                "（Postgres advisory lock 被佔用）。同一時間只能跑一個，"
                "請先確認前一個 process 是否還在跑、或是否已經當掉但連線還沒斷。"
            )
        try:
            yield
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _ADVISORY_LOCK_KEY})
    finally:
        conn.close()


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


def _sniff_webp(data: bytes):
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _looks_like_mp3_frame(data: bytes) -> bool:
    """MP3 frame sync：第一個 byte 是 0xFF，第二個 byte 高 3 位元也全是 1
    （11-bit sync word）。其餘位元（MPEG version／layer／protection）有很多
    種合法組合，不窮舉列成清單——pilot 實測 ILRDF 回來的音檔開頭是
    b'\\xff\\xfa'（MPEG-1 Layer III + CRC 保護），一開始只列了
    \\xfb/\\xf3/\\xf2 幾種常見組合，沒列到這種，被誤判成「不是音訊格式」而
    直接 terminal 失敗——改成檢查 sync word 本身，不管後面的版本/layer/
    保護位元組合是哪一種，才是正確、不會漏判的做法。"""
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def _sniff_content_type(data: bytes, family: str):
    """只在對應家族（audio/image）的簽章裡比對，找不到回傳 None——呼叫端會把
    None 當成驗證失敗直接判 terminal，不會退回去相信上游的 Content-Type
    header。上游完全可能回一個 200 的 HTML 防爬頁或 JSON 錯誤內容，header
    宣稱是 audio/image 也不能盡信，一定要看真正的 bytes。"""
    if family == "audio":
        if data.startswith(b"ID3") or _looks_like_mp3_frame(data):
            return "audio/mpeg"
        return None
    for signature, content_type in _IMAGE_SIGNATURES:
        if data.startswith(signature):
            return content_type
    return _sniff_webp(data)


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
    content_type = _sniff_content_type(content, family)
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


async def _verify_public_read(client, public_url, expected_size):
    """上傳後立刻用一次匿名 HEAD 請求驗證「這個網址真的公開可讀、大小也對」，
    不是只信任 upload_from_string() 沒丟例外就代表沒問題。這一步是唯一能
    真正抓到「Firebase bucket 其實沒開公開讀取權限，物件其實傳上去了但一般
    使用者連不到（403）」這種上傳 API 呼叫成功、實際卻壞掉的情況——不驗證
    的話，這種問題會被靜默標成 verified，一直到真人在網站上點才會發現。

    只驗證可公開讀取＋大小相符，不是逐 byte 內容 hash 比對（那需要重新
    GET 整份內容，對 4.8 萬個檔案的例行遷移來說成本太高）；真正的內容
    正確性驗證放在 pilot 階段人工抽樣做（見 plan 的「驗證」章節）。"""
    try:
        res = await client.head(
            public_url,
            timeout=httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_VERIFY_TIMEOUT, write=_VERIFY_TIMEOUT, pool=_VERIFY_TIMEOUT),
        )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"驗證公開讀取時發生錯誤：{exc}")
    if res.status_code != 200:
        raise RuntimeError(f"公開讀取驗證失敗：HTTP {res.status_code}（bucket 可能沒有設定公開讀取）")
    # Google Cloud Storage 的公開物件正常一定會回 Content-Length，缺少或無法
    # 解析視為驗證失敗（fail closed），不是略過不檢查——這裡就是在防「上傳
    # 有回應、但實際內容跟預期對不上」的情況，缺這個 header 反而更可疑。
    content_length = res.headers.get("content-length")
    if content_length is None:
        raise RuntimeError("公開讀取驗證失敗：回應沒有 Content-Length，無法確認內容大小")
    try:
        actual_size = int(content_length)
    except ValueError:
        raise RuntimeError(f"公開讀取驗證失敗：Content-Length 無法解析（{content_length!r}）")
    if actual_size != expected_size:
        raise RuntimeError(f"公開讀取驗證大小不符：預期 {expected_size} bytes，實際 {actual_size} bytes")


def _maybe_link_all(db, owning_table, owning_ids, asset_id):
    if owning_table is None:
        return
    for owning_id in owning_ids:
        owning_row = db.get(owning_table, owning_id)
        if owning_row is not None and owning_row.media_asset_id != asset_id:
            owning_row.media_asset_id = asset_id


def _claim_or_link_asset(source_provider, source_kind, source_locator, retry_failed, owning_table, owning_ids):
    """短交易：決定這個 locator 現在該不該被處理。

    回傳 (action, asset_id)：
      "process" —— 需要真的下載/上傳，呼叫端接著要跑網路流程
      "linked"  —— media_asset 早已 verified，這裡已經把 owning_ids 接上 FK，
                    不需要網路
      "skip"    —— 真的什麼都不用做（terminal 失敗、或還在冷卻期、或有其他
                    worker 正在處理且還沒卡住超過 staleness 門檻）

    只有 asset 已經是 verified 的分支才呼叫 _maybe_link_all()，回傳
    "process" 的兩個分支刻意不接 FK：曾經踩過的坑是，如果 claim 當下就把
    owning row 的 media_asset_id 接上去，不管最後下載/上傳成不成功，
    _list_candidates() 的 `media_asset_id IS NULL` 篩選條件會把這筆永遠
    排除在候選之外——下載失敗的項目會從此消失，連 --retry-failed 都救不
    回來，因為它根本不會再被列出來重試。FK 只在 _finalize_asset_success()
    真正確認驗證通過後才寫入（見該函式），media_asset_id 的語意就是「已驗證
    可用的副本」，不是「曾經嘗試過」。

    新增列時用 SAVEPOINT（begin_nested）包住：同一個 locator 可能同時被
    多個候選觸發（word_audio／sentence_audio 共用 kind 之後尤其常見、
    explanation_image 本身就有 136 筆重複 URL），先查無再 INSERT 在併發下
    會撞 (source_provider, source_kind, source_locator) 的 unique constraint
    丟 IntegrityError；不用 SAVEPOINT 接住的話，這個例外會讓外層整個
    session／transaction 進入 aborted 狀態，之後任何操作都會失敗。
    """
    now = datetime.utcnow()
    with dictionary_write_session() as db:
        row = (
            db.query(MediaAsset)
            .filter_by(source_provider=source_provider, source_kind=source_kind, source_locator=source_locator)
            .with_for_update()
            .first()
        )
        if row is None:
            nested = db.begin_nested()
            try:
                row = MediaAsset(
                    source_provider=source_provider, source_kind=source_kind, source_locator=source_locator,
                    status="downloading", attempt_count=0, updated_at=now,
                )
                db.add(row)
                db.flush()
            except IntegrityError:
                nested.rollback()
                row = (
                    db.query(MediaAsset)
                    .filter_by(source_provider=source_provider, source_kind=source_kind, source_locator=source_locator)
                    .with_for_update()
                    .first()
                )
                if row is None:
                    raise
            else:
                nested.commit()
                return "process", row.id

        asset_id = row.id
        if row.status == "verified":
            _maybe_link_all(db, owning_table, owning_ids, asset_id)
            return "linked", asset_id
        if row.status == "failed_terminal":
            return "skip", asset_id
        if row.status in _IN_PROGRESS_STATUSES and row.updated_at and (now - row.updated_at) < _STALE_AFTER:
            return "skip", asset_id
        if row.status == "failed_retryable" and not retry_failed:
            if row.next_retry_at and row.next_retry_at > now:
                return "skip", asset_id

        row.status = "downloading"
        row.updated_at = now
        return "process", asset_id


def _finalize_asset_success(asset_id, *, storage_bucket, storage_path, public_url,
                             content_type, byte_size, sha256_hex, owning_table, owning_ids):
    """回傳 True 代表真的寫入 verified；False 代表被狀態守衛擋下（asset 不存在，
    或狀態已經不是 downloading/uploading）——呼叫端要檢查這個回傳值，不能
    假設呼叫沒丟例外就等於真的寫進 verified，兩者在這支函式裡是分開的概念。"""
    now = datetime.utcnow()
    with dictionary_write_session() as db:
        asset = db.query(MediaAsset).filter_by(id=asset_id).with_for_update().first()
        if asset is None or asset.status not in _IN_PROGRESS_STATUSES:
            # 操作假設是同一時間只跑一個 process，正常不會走到這裡；這是防禦
            # 最壞情況（真的重疊跑了兩個 process）——寧可讓這次上傳變成
            # Storage 裡的孤兒物件（object path 是內容 hash，之後重跑要嘛
            # 自然去重、要嘛不影響任何人），也不要讓較舊的呼叫蓋掉已經記錄的
            # 較新結果。
            return False
        asset.status = "verified"
        asset.storage_provider = "firebase"
        asset.storage_bucket = storage_bucket
        asset.storage_path = storage_path
        asset.public_url = public_url
        asset.content_type = content_type
        asset.byte_size = byte_size
        asset.sha256 = sha256_hex
        asset.last_error = None
        asset.migrated_at = now
        asset.verified_at = now
        asset.updated_at = now
        _maybe_link_all(db, owning_table, owning_ids, asset_id)
        return True


def _finalize_asset_failure(asset_id, *, terminal, error_message):
    now = datetime.utcnow()
    with dictionary_write_session() as db:
        asset = db.query(MediaAsset).filter_by(id=asset_id).with_for_update().first()
        if asset is None or asset.status not in _IN_PROGRESS_STATUSES:
            return
        asset.attempt_count = (asset.attempt_count or 0) + 1
        asset.last_error = error_message[:2000]
        asset.updated_at = now
        if terminal or asset.attempt_count >= _MAX_DB_ATTEMPTS:
            asset.status = "failed_terminal"
            asset.next_retry_at = None
        else:
            asset.status = "failed_retryable"
            backoff_seconds = min(60 * (2 ** asset.attempt_count), 3600)
            asset.next_retry_at = now + timedelta(seconds=backoff_seconds)


def _list_candidates(source_kind, tribe_id, limit):
    """回傳 [{"locator": ..., "row_ids": [id, ...]}, ...]，同一個 locator 被
    多筆來源列引用時合併成一筆（見模組檔頭說明）。row_ids 是來源表
    （word_audio 等）自己的 PK 清單，給遷移成功後回填 media_asset_id 用；
    word_img 沒有獨立的 FK 欄位（words 表不能加欄位，理由見 migration
    檔頭），row_ids 一律是空 list。

    limit 是「最多處理幾個不重複的媒體物件」，不是「最多幾筆來源列」——
    groupby 之後才切 limit，pilot 測試時比較符合直覺（--limit 50 就是真的
    會嘗試下載 50 個不同的檔案，不會因為重複 URL 而少於預期）。"""
    db = SessionLocal()
    try:
        if source_kind == "word_audio":
            q = (
                db.query(WordAudio.id, WordAudio.file_id)
                .join(Word, Word.id == WordAudio.word_id)
                .filter(WordAudio.media_asset_id.is_(None), WordAudio.file_id.isnot(None), WordAudio.file_id != "")
            )
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(r.id, r.file_id) for r in q.all()]

        elif source_kind == "sentence_audio":
            q = (
                db.query(WordExplanationSentenceAudio.id, WordExplanationSentenceAudio.file_id)
                .join(WordExplanationSentence, WordExplanationSentence.id == WordExplanationSentenceAudio.sentence_id)
                .join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
                .join(Word, Word.id == WordExplanation.word_id)
                .filter(
                    WordExplanationSentenceAudio.media_asset_id.is_(None),
                    WordExplanationSentenceAudio.file_id.isnot(None),
                    WordExplanationSentenceAudio.file_id != "",
                )
            )
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(r.id, r.file_id) for r in q.all()]

        elif source_kind == "explanation_image":
            q = (
                db.query(WordExplanationImage.id, WordExplanationImage.image_url)
                .join(WordExplanation, WordExplanation.id == WordExplanationImage.explanation_id)
                .join(Word, Word.id == WordExplanation.word_id)
                .filter(
                    WordExplanationImage.media_asset_id.is_(None),
                    WordExplanationImage.image_url.isnot(None),
                    WordExplanationImage.image_url != "",
                )
            )
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(r.id, r.image_url) for r in q.all()]

        elif source_kind == "word_img":
            verified_locators = {
                row.source_locator
                for row in db.query(MediaAsset.source_locator).filter(
                    MediaAsset.source_kind == "word_img", MediaAsset.status == "verified",
                )
            }
            q = db.query(Word.word_img).filter(Word.word_img.isnot(None), Word.word_img != "")
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(None, word_img) for (word_img,) in q.all() if word_img not in verified_locators]

        else:
            raise ValueError(f"未知的 source_kind：{source_kind}")

        grouped = {}
        for row_id, locator in pairs:
            entry = grouped.setdefault(locator, [])
            if row_id is not None:
                entry.append(row_id)
        results = [{"locator": locator, "row_ids": row_ids} for locator, row_ids in grouped.items()]
        if limit:
            results = results[:limit]
        return results
    finally:
        db.close()


class _Stats:
    def __init__(self):
        self.counts = {}

    def record(self, outcome):
        self.counts[outcome] = self.counts.get(outcome, 0) + 1

    def summary(self):
        return ", ".join(f"{k}={v}" for k, v in sorted(self.counts.items())) or "(無符合條件的項目)"


class Command(BaseCommand):
    help = (
        "把辭典音檔／圖片從外部來源（ILRDF／Bing 等）搬到自己的 Firebase Storage，"
        "DB 只改指標，不覆寫原始 file_id／image_url（P5 辭典媒體自主化）"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--source-kind", required=True, choices=sorted(_OWNING_TABLE.keys()),
            help="要遷移哪一種媒體；四種來源性質不同，一次只處理一種",
        )
        parser.add_argument(
            "--tribe", default=None,
            help=f"只處理指定族語（可用值：{', '.join(sorted(TRIBE_IDS))}），預設處理全部族語",
        )
        parser.add_argument("--limit", type=int, default=None, help="最多處理幾個不重複的媒體物件，預設不限（先用小數字跑 pilot）")
        parser.add_argument(
            "--retry-failed", action="store_true",
            help="連 failed_retryable 且還在冷卻中的項目也一併重試（不含 failed_terminal——那些通常代表"
                 "內容本身有問題，需要人工檢查後手動重置狀態才會重跑）",
        )
        parser.add_argument("--rate", type=float, default=4.0, help="每秒最多幾次外部 HTTP 請求（預設 4，必須 > 0）")
        parser.add_argument("--concurrency", type=int, default=4, help="同時執行幾個 worker（預設 4，必須 >= 1）")

    def handle(self, *args, **options):
        if not os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH"):
            raise CommandError("尚未設定 FIREBASE_SERVICE_ACCOUNT_PATH，無法初始化 Firebase Admin SDK")
        bucket_name = os.getenv("VITE_FIREBASE_STORAGE_BUCKET")
        if not bucket_name:
            raise CommandError("尚未設定 VITE_FIREBASE_STORAGE_BUCKET，無法決定要上傳到哪個 bucket")

        if options["rate"] <= 0:
            raise CommandError("--rate 必須大於 0")
        if options["concurrency"] < 1:
            raise CommandError("--concurrency 必須至少是 1")
        if options["limit"] is not None and options["limit"] <= 0:
            raise CommandError("--limit 必須大於 0")

        source_kind = options["source_kind"]
        tribe_slug = options["tribe"]
        tribe_id = None
        if tribe_slug:
            tribe_id = TRIBE_IDS.get(tribe_slug)
            if not tribe_id:
                raise CommandError(f"不支援的族語代稱：{tribe_slug}（可用值：{', '.join(sorted(TRIBE_IDS))}）")

        with _single_instance_guard():
            candidates = _list_candidates(source_kind, tribe_id, options["limit"])
            if not candidates:
                self.stdout.write("沒有符合條件、需要處理的項目。")
                return

            self.stdout.write(f"共 {len(candidates)} 個不重複媒體物件待處理（source_kind={source_kind}, tribe={tribe_slug or '全部'}）")

            stats = asyncio.run(self._run_async(
                source_kind=source_kind, bucket_name=bucket_name, candidates=candidates,
                retry_failed=options["retry_failed"], rate=options["rate"], concurrency=options["concurrency"],
            ))
            self.stdout.write(self.style.SUCCESS(f"完成。{stats.summary()}"))

    async def _run_async(self, *, source_kind, bucket_name, candidates, retry_failed, rate, concurrency):
        rate_limiter = _RateLimiter(rate)
        stats = _Stats()
        stats_lock = asyncio.Lock()
        provider = _SOURCE_PROVIDER[source_kind]

        queue = asyncio.Queue()
        for item in candidates:
            queue.put_nowait(item)

        limits = httpx.Limits(max_connections=concurrency * 2, max_keepalive_connections=concurrency)
        async with httpx.AsyncClient(limits=limits) as client:

            async def _worker_loop():
                while True:
                    try:
                        item = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        return
                    try:
                        outcome = await self._process_one(client, rate_limiter, provider, source_kind, bucket_name, item, retry_failed)
                    except Exception as exc:  # noqa: BLE001 - 任何單筆的未預期例外都不能讓整個 worker 停下來，
                                                # 更不能讓 gather() 整批中斷（見模組檔頭「必修問題」）
                        outcome = "failed_retryable"
                        self.stderr.write(self.style.ERROR(
                            f"  [unexpected] {source_kind} row_ids={item['row_ids']} locator={item['locator'][:80]}：{exc}"
                        ))
                    async with stats_lock:
                        stats.record(outcome)
                    if outcome not in ("skipped", "linked", "verified"):
                        self.stderr.write(self.style.WARNING(
                            f"  [{outcome}] {source_kind} row_ids={item['row_ids']} locator={item['locator'][:80]}"
                        ))
                    queue.task_done()

            # 固定數量 worker 從佇列拉工作，而不是一次把全部候選（可能高達
            # 27,541 筆）都建成 asyncio task——同時存在的 task 數量固定等於
            # concurrency，記憶體用量跟候選總數無關，Ctrl+C 時也只有少量
            # 正在執行中的 task 需要處理，不是數萬個。
            workers = [asyncio.create_task(_worker_loop()) for _ in range(concurrency)]
            await asyncio.gather(*workers)

        return stats

    async def _process_one(self, client, rate_limiter, provider, source_kind, bucket_name, item, retry_failed):
        locator = item["locator"]
        row_ids = item["row_ids"]
        owning_table = _OWNING_TABLE[source_kind]
        media_kind = _MEDIA_ASSET_KIND[source_kind]
        family = _FAMILY_BY_SOURCE_KIND[source_kind]

        action, asset_id = await asyncio.to_thread(
            _claim_or_link_asset, provider, media_kind, locator, retry_failed, owning_table, row_ids,
        )
        if action == "linked":
            return "linked"
        if action == "skip":
            return "skipped"

        try:
            if source_kind in ("word_audio", "sentence_audio"):
                if locator.startswith("http://") or locator.startswith("https://"):
                    hostname = urlparse(locator).hostname or ""
                    if hostname not in _TRUSTED_ABSOLUTE_SOURCE_DOMAINS:
                        raise _FetchError(f"file_id 是不受信任網域的完整 URL，需要人工檢查：{locator}", terminal=True)
                    if not await asyncio.to_thread(is_safe_redirect_target, locator):
                        raise _FetchError(f"file_id 網址被 SSRF 檢查擋下：{locator}", terminal=True)
                    final_url = locator
                else:
                    final_url = await _with_retry(lambda: _resolve_ilrdf_url(client, rate_limiter, locator))
            else:
                if not await asyncio.to_thread(is_safe_redirect_target, locator):
                    raise _FetchError(f"來源網址被 SSRF 檢查擋下：{locator}", terminal=True)
                final_url = locator

            content, content_type = await _with_retry(
                lambda: _fetch_bytes(
                    client, rate_limiter, final_url,
                    read_timeout=_READ_TIMEOUT[source_kind], max_bytes=_MAX_BYTES[source_kind], family=family,
                )
            )
        except _FetchError as exc:
            await asyncio.to_thread(_finalize_asset_failure, asset_id, terminal=exc.terminal, error_message=str(exc))
            return "failed_terminal" if exc.terminal else "failed_retryable"
        except Exception as exc:  # noqa: BLE001 - 批次作業，任何未預期例外都不能讓整批中斷
            await asyncio.to_thread(_finalize_asset_failure, asset_id, terminal=False, error_message=f"未預期例外：{exc}")
            return "failed_retryable"

        sha256_hex = hashlib.sha256(content).hexdigest()
        extension = _EXTENSION_BY_CONTENT_TYPE.get(content_type, "")
        object_path = f"dictionary/{source_kind}/{sha256_hex[:2]}/{sha256_hex}{extension}"

        try:
            public_url = await asyncio.to_thread(upload_media_object, content, object_path, content_type)
            await _verify_public_read(client, public_url, expected_size=len(content))
        except Exception as exc:  # noqa: BLE001
            await asyncio.to_thread(_finalize_asset_failure, asset_id, terminal=False, error_message=f"上傳/驗證 Firebase 失敗：{exc}")
            return "failed_retryable"

        try:
            committed = await asyncio.to_thread(
                _finalize_asset_success, asset_id,
                storage_bucket=bucket_name, storage_path=object_path, public_url=public_url,
                content_type=content_type, byte_size=len(content), sha256_hex=sha256_hex,
                owning_table=owning_table, owning_ids=row_ids,
            )
        except Exception as exc:  # noqa: BLE001 - 寫入 verified 結果這一步本身失敗
                                    # （例如 DB 連線問題），也不能讓整批中斷；盡量
                                    # 補記一筆失敗，記不成也不影響其他項目繼續跑
            try:
                await asyncio.to_thread(
                    _finalize_asset_failure, asset_id, terminal=False,
                    error_message=f"下載/上傳都成功，但寫入 verified 結果時發生例外：{exc}",
                )
            except Exception:  # noqa: BLE001
                pass
            return "failed_retryable"

        # committed=False 代表被狀態守衛擋下（極端情況：真的有另一個 process
        # 重疊跑，較舊的呼叫不該覆蓋較新的結果）——內容確實下載/上傳成功了，
        # 只是這次呼叫沒能把結果寫進 DB，不能回報成 verified。
        return "verified" if committed else "failed_retryable"
