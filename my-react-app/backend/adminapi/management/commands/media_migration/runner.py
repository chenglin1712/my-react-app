"""整支批次遷移的組裝層：--source-kind 對應表、單一 process 互斥鎖、
固定數量 worker 從佇列拉工作、單筆候選的完整流程（claim → 下載 → 上傳 →
驗證 → finalize）。實際的下載／上傳／狀態機邏輯都在 fetcher.py／storage.py／
asset_repository.py，這裡只負責串起來。"""
import asyncio
import contextlib
import hashlib
from urllib.parse import urlparse

import httpx
from django.core.management.base import CommandError
from sqlalchemy import text

from adminapi.firebase_ops import upload_media_object
from config.url_safety import is_safe_redirect_target
from dictionary_db.connect import engine
from dictionary_db.model import WordAudio, WordExplanationImage, WordExplanationSentenceAudio

from . import asset_repository
from .fetcher import _FetchError, _RateLimiter, _fetch_bytes, _resolve_ilrdf_url, _with_retry
from .sniff import _EXTENSION_BY_CONTENT_TYPE
from .storage import _verify_public_read

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

# 後台 MediaUploadField.jsx 上傳音檔的既有 bug：把 Cloudinary 的完整
# secure_url 寫進 word_audio.file_id，不是 ILRDF 的 file_id GUID（audio_proxy.py
# 原本 `ILRDF_BASE + file_id` 的播放路徑對這種 file_id 一樣會壞掉，這不是這次
# 遷移造成的既有問題）。遇到看起來是完整 URL 的 file_id，只信任這個已知網域
# 直接當一般 URL 下載，其餘網域一律當 terminal 失敗、留給人工檢查，不能對
# 任意「看起來像 URL 的 file_id」開放下載。
_TRUSTED_ABSOLUTE_SOURCE_DOMAINS = {"res.cloudinary.com"}

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


class _Stats:
    def __init__(self):
        self.counts = {}

    def record(self, outcome):
        self.counts[outcome] = self.counts.get(outcome, 0) + 1

    def summary(self):
        return ", ".join(f"{k}={v}" for k, v in sorted(self.counts.items())) or "(無符合條件的項目)"


async def run_migration(command, *, source_kind, bucket_name, candidates, retry_failed, rate, concurrency):
    """command 是呼叫端的 Django BaseCommand 實例，只用來輸出彩色進度訊息
    （self.stdout／self.stderr／self.style），不影響任何遷移邏輯本身——
    保留這個參數是為了讓拆分後的輸出行為跟拆分前完全一致，不必重新設計一套
    回報機制。"""
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
                    outcome = await _process_one(command, client, rate_limiter, provider, source_kind, bucket_name, item, retry_failed)
                except Exception as exc:  # noqa: BLE001 - 任何單筆的未預期例外都不能讓整個 worker 停下來，
                                            # 更不能讓 gather() 整批中斷（見模組檔頭「必修問題」）
                    outcome = "failed_retryable"
                    command.stderr.write(command.style.ERROR(
                        f"  [unexpected] {source_kind} row_ids={item['row_ids']} locator={item['locator'][:80]}：{exc}"
                    ))
                async with stats_lock:
                    stats.record(outcome)
                if outcome not in ("skipped", "linked", "verified"):
                    command.stderr.write(command.style.WARNING(
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


async def _process_one(command, client, rate_limiter, provider, source_kind, bucket_name, item, retry_failed):
    locator = item["locator"]
    row_ids = item["row_ids"]
    owning_table = _OWNING_TABLE[source_kind]
    media_kind = _MEDIA_ASSET_KIND[source_kind]
    family = _FAMILY_BY_SOURCE_KIND[source_kind]

    action, asset_id = await asyncio.to_thread(
        asset_repository._claim_or_link_asset, provider, media_kind, locator, retry_failed, owning_table, row_ids,
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
        await asyncio.to_thread(asset_repository._finalize_asset_failure, asset_id, terminal=exc.terminal, error_message=str(exc))
        return "failed_terminal" if exc.terminal else "failed_retryable"
    except Exception as exc:  # noqa: BLE001 - 批次作業，任何未預期例外都不能讓整批中斷
        await asyncio.to_thread(asset_repository._finalize_asset_failure, asset_id, terminal=False, error_message=f"未預期例外：{exc}")
        return "failed_retryable"

    sha256_hex = hashlib.sha256(content).hexdigest()
    extension = _EXTENSION_BY_CONTENT_TYPE.get(content_type, "")
    object_path = f"dictionary/{source_kind}/{sha256_hex[:2]}/{sha256_hex}{extension}"

    try:
        public_url = await asyncio.to_thread(upload_media_object, content, object_path, content_type)
        await _verify_public_read(client, public_url, expected_size=len(content))
    except Exception as exc:  # noqa: BLE001
        await asyncio.to_thread(asset_repository._finalize_asset_failure, asset_id, terminal=False, error_message=f"上傳/驗證 Firebase 失敗：{exc}")
        return "failed_retryable"

    try:
        committed = await asyncio.to_thread(
            asset_repository._finalize_asset_success, asset_id,
            storage_bucket=bucket_name, storage_path=object_path, public_url=public_url,
            content_type=content_type, byte_size=len(content), sha256_hex=sha256_hex,
            owning_table=owning_table, owning_ids=row_ids,
        )
    except Exception as exc:  # noqa: BLE001 - 寫入 verified 結果這一步本身失敗
                                # （例如 DB 連線問題），也不能讓整批中斷；盡量
                                # 補記一筆失敗，記不成也不影響其他項目繼續跑
        try:
            await asyncio.to_thread(
                asset_repository._finalize_asset_failure, asset_id, terminal=False,
                error_message=f"下載/上傳都成功，但寫入 verified 結果時發生例外：{exc}",
            )
        except Exception:  # noqa: BLE001
            pass
        return "failed_retryable"

    # committed=False 代表被狀態守衛擋下（極端情況：真的有另一個 process
    # 重疊跑，較舊的呼叫不該覆蓋較新的結果）——內容確實下載/上傳成功了，
    # 只是這次呼叫沒能把結果寫進 DB，不能回報成 verified。
    return "verified" if committed else "failed_retryable"
