"""修復被壓扁成純 map 的時間戳記欄位（P0-3）。

根因（見 import_firebase.py 的 _restore_timestamps() 修正）：某個匯出流程把
Firestore Timestamp 序列化成 `{"_seconds": …, "_nanoseconds": …}` 這種
JSON-safe 的 map，`import_firebase.py` 從備份還原時原本沒有把它轉換回真正
的 Timestamp，直接 `.set()` 整份 dict 回 Firestore——寫進去的就真的是一個
巢狀 map，不是 Timestamp 型別。已知的兩個後果都已實測到：
  1. 顯示端會把它當成一般物件處理，讀不到熟悉的 seconds 欄位（sharedNotes
     這邊已在 frontend/src/_note/timeAgo.js 加了讀取端防禦，但那只能讓
     「顯示」不崩壞，治不了下面第 2 點）。
  2. Firestore 對 map 型別的 orderBy 是逐 key 字典序比較，不是時間排序——
     任何對這個欄位 orderBy() 的查詢，排序結果都會完全錯亂。這一點只能靠
     把欄位改回真正的 Timestamp 才能修好，import_firebase.py 的根因修正
     只防得住「未來重新執行匯入」，治不了已經寫進 Firestore 的既有資料——
     這支指令就是用來修那些既有資料。

已知受影響的 collection／欄位（用本檔案的邏輯對正式專案跑過一次唯讀掃描，
2026-08-19）：
  - sharedNotes.createdAt：14 筆全部損壞（14/14）
  - quizs.createdAt：86 筆裡有 47 筆損壞
  - situations.answeredAt：3 筆全部正常，未受影響
  - userSituation.createdAt／calendar.createdAt：兩個 collection 都沒有這個
    欄位（可能存在別的欄位名稱或巢狀結構，這裡沒有進一步深挖，不在本次
    P0-3 的確認範圍內）
  - users.joinDate：9 筆全部是 ISO 8601 字串，這是這個欄位本來就設計成的
    格式（見 adminapi/user_service.py 的 _default_firestore_user_doc()），
    不是同一種污染，不要對這個欄位跑這支指令。

collection／field 刻意做成必填參數、不給預設值——這是會寫入正式資料的
操作，要求操作者每次都明確講清楚「這次要修哪個 collection 的哪個欄位」，
不能因為忘記帶參數就套用到錯的範圍。

用法：
    python manage.py fix_corrupted_timestamps --collection sharedNotes --field createdAt --dry-run
    python manage.py fix_corrupted_timestamps --collection sharedNotes --field createdAt
    python manage.py fix_corrupted_timestamps --collection quizs --field createdAt --dry-run
    python manage.py fix_corrupted_timestamps --collection quizs --field createdAt

這支指令會連線到 .env 設定的 Firebase 專案（FIREBASE_SERVICE_ACCOUNT_PATH）
寫入真實資料，執行前請先確認那是你要修正的專案，且已知這是不可逆的正式資料
變更（請先用 --dry-run 看一次會動到哪些文件）。
"""
import sys
from datetime import datetime, timezone

from django.core.management.base import BaseCommand, CommandError

from adminapi import firebase_ops


def _is_corrupted_timestamp_map(value):
    """跟 import_firebase.py 的 _is_timestamp_map() 用同一套判斷標準（獨立
    審查覆核這批修正時收緊過，這裡同步）：形狀恰好是
    {_seconds, _nanoseconds}（且沒有其他 key）的 dict，兩個 key 都必須是
    int（不接受 bool——bool 是 int 的子類別，isinstance(True, int) 會誤判；
    也不接受 float——真正序列化出來的 Timestamp 分量本來就是整數），且
    nanoseconds 落在 [0, 1_000_000_000) 這個合法範圍內，避免誤傷剛好也叫
    這兩個名字、但語意上不是時間戳記的其他資料。"""
    if not isinstance(value, dict) or set(value.keys()) != {"_seconds", "_nanoseconds"}:
        return False
    seconds = value["_seconds"]
    nanoseconds = value["_nanoseconds"]
    if isinstance(seconds, bool) or isinstance(nanoseconds, bool):
        return False
    if not isinstance(seconds, int) or not isinstance(nanoseconds, int):
        return False
    return 0 <= nanoseconds < 1_000_000_000


def _to_datetime(value):
    """呼叫前一律先用 _is_corrupted_timestamp_map() 過濾過，seconds 數值仍
    可能超出 datetime 支援的範圍——呼叫端 handle() 負責接住
    OverflowError/OSError/ValueError，讓單筆異常值不中斷整個掃描。"""
    return datetime.fromtimestamp(
        value["_seconds"] + value["_nanoseconds"] / 1e9, tz=timezone.utc,
    )


class Command(BaseCommand):
    help = "修復指定 collection/欄位裡被壓扁成 {_seconds,_nanoseconds} map 的正式資料"

    def add_arguments(self, parser):
        parser.add_argument(
            "--collection", required=True,
            help="Firestore collection 名稱，例如 sharedNotes、quizs",
        )
        parser.add_argument(
            "--field", required=True,
            help="要修正的欄位名稱，例如 createdAt",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="只列出會被修正的文件與轉換後的時間，不實際寫入 Firestore",
        )

    def handle(self, *args, **options):
        # Windows 終端機預設不是 UTF-8（cp1252），這支指令的輸出全是中文，
        # 不 reconfigure 會在 self.stdout.write() 直接丟 UnicodeEncodeError
        # 中斷指令——跟 reconcile_stuck_dictionary_revisions 同一個既有處理。
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")

        collection_name = options["collection"]
        field = options["field"]
        if not collection_name or not field:
            raise CommandError("--collection 與 --field 都必須是非空字串")

        dry_run = options["dry_run"]
        mode_label = "dry-run（不會寫入）" if dry_run else "實際執行"
        self.stdout.write(f"掃描 {collection_name}.{field}，模式：{mode_label}\n")

        client = firebase_ops.get_firestore_client()
        # 用 stream() 逐筆處理而不是先 list() 整批載入記憶體，資料量大的
        # collection（例如 quizs）也能安全執行。每筆各自 update()，中途失敗
        # 只影響那一筆，重跑這支指令是 idempotent 的（已經修正過的文件會在
        # 下一輪被 _is_corrupted_timestamp_map() 判斷成「本來就正常」而跳過）。

        scanned = 0
        fixed = 0
        skipped = 0
        errored = 0

        for doc in client.collection(collection_name).stream():
            scanned += 1
            data = doc.to_dict() or {}
            value = data.get(field)

            if not _is_corrupted_timestamp_map(value):
                skipped += 1
                continue

            try:
                corrected = _to_datetime(value)
            except (OverflowError, OSError, ValueError) as exc:
                # 數值形狀對，但實際大小超出 datetime 支援範圍——不該讓一筆
                # 異常資料中斷整個掃描，記下來讓操作者事後人工複查。
                errored += 1
                self.stdout.write(self.style.WARNING(
                    f"  ⚠️  {doc.id}: {value} 無法轉換（{exc}），略過，需人工複查"
                ))
                continue

            self.stdout.write(
                f"  {doc.id}: {value} → {corrected.isoformat()}"
                + ("（dry-run，未寫入）" if dry_run else "")
            )

            if not dry_run:
                doc.reference.update({field: corrected})

            fixed += 1

        self.stdout.write("")
        summary = (
            f"完成。掃描 {scanned} 筆，{'會' if dry_run else '已'}修正 {fixed} 筆，"
            f"{skipped} 筆本來就正常（略過）"
        )
        if errored:
            summary += f"，{errored} 筆數值異常無法轉換（需人工複查）"
        self.stdout.write(self.style.SUCCESS(summary + "。"))
        if dry_run and fixed:
            self.stdout.write("不加 --dry-run 重新執行以實際寫入。")
