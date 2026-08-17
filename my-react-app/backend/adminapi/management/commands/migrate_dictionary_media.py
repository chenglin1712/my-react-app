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
也會自然去重（見 media_migration/runner.py 的 _MEDIA_ASSET_KIND）。

實際邏輯拆成 media_migration/ 底下職責單一的子模組（P4 review BE-15，原本
836 行全部塞在這支指令檔案裡）：
    sniff.py             下載內容真實格式判斷（純函式，不做 I/O）
    fetcher.py           對外下載：ILRDF 解析、限速、重試、串流下載＋SSRF 防護
    storage.py           上傳到 Firebase Storage 後的公開可讀性驗證
    asset_repository.py  media_asset 表的狀態機讀寫（AssetStatus 常數＋claim/finalize）
    runner.py            組裝層：單一 process 互斥鎖、worker pool、單筆候選完整流程
這支指令檔案本身只保留 CLI 參數解析與最外層的協調，不含任何下載/上傳/資料庫
細節。

設計成 asset-level checkpoint 的粗粒度狀態機（不做 byte-range 續傳，這批
檔案平均只有幾十 KB～1MB，做續傳不划算；也不細分 downloading/downloaded/
uploading/uploaded 這幾個中間態，crash 後一律從頭重新下載+上傳，object
path 是內容 SHA-256，重傳頂多是覆寫同一個 path，不會產生垃圾物件）：
    DOWNLOADING -> VERIFIED
                \-> FAILED_RETRYABLE / FAILED_TERMINAL
（見 media_migration/asset_repository.py 的 AssetStatus）
DB 只存「已驗證完成的自有副本」這件事（media_asset 表 + 三張來源表的
nullable media_asset_id FK），原始 file_id／image_url／word_img 完全不動，
繼續當 provenance／過渡期 fallback（見 audio_proxy.py 的 MEDIA_SOURCE_MODE）。

冪等／可斷點續跑：(source_provider, source_kind, source_locator) 是 media_asset
的唯一鍵，重跑同一批只會跳過已經 verified 的項目。同一個 locator 被多筆
來源列引用時（explanation_image 540 筆裡有 136 筆是重複 URL），同一次執行
內只下載/上傳一次，完成後一次回填所有引用它的來源列（見 asset_repository.py
的 _list_candidates 的 groupby）。程序中途被中斷（Ctrl+C／當機）留在
downloading 狀態的項目，10 分鐘後視為卡住，下次執行會自動重新認領——這裡
刻意不做 asyncio 訊號式的優雅關閉（Windows 的 ProactorEventLoop 對 SIGINT
訊號處理本來就不可靠），改用這個 staleness recovery 達到「安全中斷、之後
重跑會自動接上」的效果。

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
import os

from django.core.management.base import BaseCommand, CommandError

from config.tribes import TRIBE_IDS

from .media_migration.asset_repository import _list_candidates
from .media_migration.runner import _OWNING_TABLE, _single_instance_guard, run_migration


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

            stats = asyncio.run(run_migration(
                self, source_kind=source_kind, bucket_name=bucket_name, candidates=candidates,
                retry_failed=options["retry_failed"], rate=options["rate"], concurrency=options["concurrency"],
            ))
            self.stdout.write(self.style.SUCCESS(f"完成。{stats.summary()}"))
