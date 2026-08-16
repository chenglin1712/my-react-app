"""續跑卡在「套用中」（status=applying）的批次匯入工作。

見 adminapi.dictionary_import_views.import_job_approve() 的說明：process
如果在逐列套用迴圈中途被中斷（部署重啟、OOM，不是 Python 例外——單一列的
例外已經在迴圈內被攔下並 checkpoint 成 failed，不會讓工作卡在這裡），job
會停在 status=applying。核准端點本身故意不接受在這個狀態下重新呼叫（避免
兩個請求同時續跑同一個 job 的併發風險），需要用這支指令由人工確認狀況後
手動處理。

用法：
    python manage.py resume_stuck_dictionary_import <job_id>            # 只診斷，不改動
    python manage.py resume_stuck_dictionary_import <job_id> --apply    # 實際續跑剩下的列

--apply 會重新呼叫 resolve_import_bundle() 解析原始 bundle，對每一列：
  - job.report 裡已經有這一列的 outcome（applied／failed／skipped），
    直接沿用，不重新處理——避免對已經成功套用的列重複套用。
  - 沒有記錄的列才視為「還沒處理過」，用 dictionary_write.apply_word_tree()
    套用；新建列用跟 import_job_approve() 一樣的 deterministic id 推導
    （見 dictionary_import_views._deterministic_import_row_id()），所以就算
    上一次其實已經建立成功、只是 checkpoint 沒寫回 Django，這次重跑也會
    對回同一筆詞條（apply_word_tree 對已存在的 id 走的是更新對帳邏輯，
    內容沒變的話等於是 no-op），不會建立第二筆重複的。

跟核准端點一樣故意不重新比對 preflight_hash——resume 當下資料庫內容本來
就包含了上一次已經套用成功的那幾列，重新比對反而會被自己造成的變化誤判
成「已經被別人改過」。這代表 resume 略過了「送審後到現在資料庫是否被
別人動過」這層保護，是這個縮小範圍版本的已知取捨：執行前建議先確認這段
期間沒有其他人同時在編輯同一批詞條。
"""
import json
import sys
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from adminapi import dictionary_write as dw
from adminapi._shared import safe_write_audit_log
from adminapi.dictionary_cache import invalidate_dictionary_cache
from adminapi.dictionary_import import resolve_import_bundle
from adminapi.dictionary_import_views import _TRIBE_SLUG_TO_ID, _deterministic_import_row_id
from adminapi.models import DictionaryImportJob
from dictionary_db.connect import SessionLocal, dictionary_write_session


class Command(BaseCommand):
    help = "續跑卡在「套用中」（status=applying）的批次匯入工作"

    def add_arguments(self, parser):
        parser.add_argument("job_id", type=int)
        parser.add_argument("--apply", action="store_true", help="實際續跑剩下的列；不加只診斷、不改動任何資料")

    def handle(self, *args, **options):
        # Windows 終端機預設不是 UTF-8（cp1252），這支指令的輸出全是中文，
        # 不 reconfigure 會在 self.stdout.write() 直接丟 UnicodeEncodeError
        # 中斷指令——跟 run.py／run_fastapi.py 處理同一個既有問題一樣的做法。
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")

        job_id = options["job_id"]
        apply_fixes = options["apply"]

        try:
            job = DictionaryImportJob.objects.get(pk=job_id)
        except DictionaryImportJob.DoesNotExist:
            raise CommandError(f"找不到匯入工作 #{job_id}")

        if job.status != DictionaryImportJob.STATUS_APPLYING:
            self.stdout.write(self.style.WARNING(
                f"工作 #{job_id} 目前狀態是「{job.get_status_display()}」，不是「套用中」，不需要續跑。"
            ))
            return

        prior_outcomes = {o["row"]: o for o in (job.report or {}).get("outcomes", [])}
        self.stdout.write(
            f"工作 #{job_id}（{job.tribe}，{job.filename or '未命名'}）目前卡在套用中，"
            f"已知已處理 {len(prior_outcomes)} 列（成功 {job.applied_count}，失敗 {job.failed_count}）。"
        )

        tribe_id = _TRIBE_SLUG_TO_ID[job.tribe]
        read_db = SessionLocal()
        try:
            fresh_report = resolve_import_bundle(read_db, tribe_id, job.payload.get("words", []))
        finally:
            read_db.close()

        remaining = [item for item in fresh_report["items"] if item["row"] not in prior_outcomes]
        self.stdout.write(f"還有 {len(remaining)} 列尚未處理過。")

        if not apply_fixes:
            for item in remaining:
                self.stdout.write(f"  待處理：row={item['row']} name={item['name']!r} action={item['action']}")
            self.stdout.write(self.style.WARNING("這是診斷模式，沒有實際改動任何資料。加上 --apply 才會真的續跑。"))
            return

        applied_count = job.applied_count
        failed_count = job.failed_count
        outcomes = list(prior_outcomes.values())

        for item in remaining:
            row = item["row"]
            if item["action"] == "error":
                outcome = {"row": row, "name": item["name"], "outcome": "skipped", "detail": item["errors"]}
            else:
                try:
                    with dictionary_write_session() as write_db:
                        result_id = dw.apply_word_tree(
                            write_db, item["payload"], word_id=item["word_id"], expected_hash=item.get("current_hash"),
                            create_id=_deterministic_import_row_id(job.pk, row) if not item["word_id"] else None,
                        )
                    applied_count += 1
                    outcome = {"row": row, "name": item["name"], "outcome": "applied", "word_id": result_id}
                    self.stdout.write(self.style.SUCCESS(f"  row={row} {item['name']!r} → 已套用（{result_id}）"))
                except dw.DictionaryWriteError as exc:
                    failed_count += 1
                    outcome = {"row": row, "name": item["name"], "outcome": "failed", "detail": str(exc)}
                    self.stdout.write(self.style.ERROR(f"  row={row} {item['name']!r} → 失敗：{exc}"))
                except Exception:
                    failed_count += 1
                    outcome = {"row": row, "name": item["name"], "outcome": "failed", "detail": "套用時發生非預期錯誤"}
                    self.stdout.write(self.style.ERROR(f"  row={row} {item['name']!r} → 非預期錯誤"))

            outcomes.append(outcome)
            job.report = {**fresh_report, "outcomes": outcomes}
            job.applied_count = applied_count
            job.failed_count = failed_count
            job.save(update_fields=["report", "applied_count", "failed_count"])

        job.status = (
            DictionaryImportJob.STATUS_APPLIED
            if failed_count == 0 and fresh_report["error_count"] == 0
            else DictionaryImportJob.STATUS_APPLIED_WITH_ERRORS
        )
        job.applied_by = "system:resume_stuck_dictionary_import"
        job.applied_at = timezone.now()
        job.save(update_fields=["status", "applied_by", "applied_at"])

        # write_audit_log() 預期一個真正的 Django HttpRequest；管理指令
        # 沒有這個東西，用只帶空 META 的替身物件湊出相同介面（跟
        # reconcile_stuck_dictionary_revisions 同一種做法）。
        fake_request = SimpleNamespace(META={})
        safe_write_audit_log(
            fake_request, {"uid": "system:resume_stuck_dictionary_import"},
            "approve_import_job", str(job.pk),
            after=json.loads(json.dumps({"applied_count": applied_count, "failed_count": failed_count}, default=str)),
            target_type="dictionary_import_job",
        )

        if applied_count > 0:
            invalidate_dictionary_cache(["words"], tribes=[job.tribe])

        self.stdout.write(self.style.SUCCESS(f"完成，工作 #{job_id} 狀態更新為「{job.get_status_display()}」。"))
