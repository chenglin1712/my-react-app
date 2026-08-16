"""掃描並修復卡在「已核准但記帳沒寫完」的辭典提案。

dictionary_views._finalize_approved_revision() 在 dictionary DB 寫入成功
之後，還要把 applied_at／target_id 寫回 Django 端的 DictionaryRevision、
寫稽核紀錄、通知 FastAPI 清除快取——這一步失敗（重試 3 次仍失敗，通常是
DB 連線問題持續得比較久，或 process 在這中間被中斷）不會把 revision 退回
pending_review（那樣下次核准會對同一個 target 重新套用一次，可能重複
建立或跟已生效內容打架），而是刻意留在 status=approved、applied_at=NULL
——這個組合本身就是「內容已經生效，只是記帳沒寫完」的可掃描標記，這支
指令就是用來找出並補完成這些殘留記錄。

用法：
    python manage.py reconcile_stuck_dictionary_revisions           # 只列出，不改動
    python manage.py reconcile_stuck_dictionary_revisions --apply   # 嘗試補完成
    python manage.py reconcile_stuck_dictionary_revisions --min-age-minutes 5

update／delete 操作的 target_id 在提案送審當下就已經知道（revision.target_id
就是被修改/刪除的既有詞條/文法章節），--apply 只對這兩種操作補寫
applied_at／target_id／稽核紀錄——會先用 tree_getter 確認 update 的目標
「現在讀得到」、delete 的目標「現在讀不到」，跟預期的操作方向一致才動手，
不一致就跳過並提示人工複查（可能代表 dictionary DB 那步其實沒有真的
commit 成功，不是單純記帳失敗）。

create 操作沒有這個安全網：新建詞條/文法章節實際拿到的 id
（apply_word_tree()／apply_grammar_section() 的回傳值）只存在當時 request
的記憶體裡，沒有任何地方持久化，這支指令沒辦法知道「哪一筆新建記錄對應
這個提案」。對 create 操作一律只列出來，不會自動 --apply，需要人工去
dictionary DB 依內容比對找出對應的新建記錄，確認後手動補上 target_id／
applied_at。這是目前縮小範圍後的已知限制；要徹底解決需要在套用前就先
分配 deterministic id，還沒排進這次改動（見 BE-2 同一輪修正裡新增
DictionaryImportJob 逐列 checkpoint 時採用的 deterministic id 做法，
未來可以套用同樣的思路到單筆提案的 create 流程）。
"""
import json
import sys
from types import SimpleNamespace

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from adminapi import dictionary_write as dw
from adminapi._shared import safe_write_audit_log
from adminapi.dictionary_cache import invalidate_dictionary_cache
from adminapi.dictionary_views import _CACHE_SCOPES, _TREE_GETTERS, _revision_target_type
from adminapi.models import DictionaryRevision
from dictionary_db.connect import SessionLocal


class Command(BaseCommand):
    help = "掃描並修復卡在「已核准但記帳沒寫完」（status=approved, applied_at=NULL）的辭典提案"

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="實際嘗試補完成（僅限 update／delete 操作）；不加這個旗標只列出，不改動任何資料",
        )
        parser.add_argument(
            "--min-age-minutes", type=int, default=2,
            help="只處理「核准時間」已經超過這麼多分鐘的提案，避免撈到剛好還在 request 生命週期內、"
                 "重試尚未跑完的正常情況（預設 2 分鐘）",
        )

    def handle(self, *args, **options):
        # Windows 終端機預設不是 UTF-8（cp1252），這支指令的輸出全是中文，
        # 不 reconfigure 會在 self.stdout.write() 直接丟 UnicodeEncodeError
        # 中斷指令——跟 run.py／run_fastapi.py 處理同一個既有問題一樣的做法。
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")

        apply_fixes = options["apply"]
        min_age = options["min_age_minutes"]
        cutoff = timezone.now() - timezone.timedelta(minutes=min_age)

        stuck = list(
            DictionaryRevision.objects.filter(
                status=DictionaryRevision.STATUS_APPROVED,
                applied_at__isnull=True,
                reviewed_at__lte=cutoff,
            ).order_by("reviewed_at")
        )

        if not stuck:
            self.stdout.write(self.style.SUCCESS("沒有找到卡住的辭典提案。"))
            return

        self.stdout.write(f"找到 {len(stuck)} 筆卡在「已核准但記帳沒寫完」的提案：\n")

        read_db = SessionLocal()
        try:
            for revision in stuck:
                stuck_for = timezone.now() - revision.reviewed_at
                self.stdout.write(
                    f"  #{revision.pk} [{revision.target_kind}/{revision.operation}] "
                    f"target_id={revision.target_id or '(create，無法自動辨識)'} "
                    f"tribe={revision.tribe} title={revision.title_cache!r} "
                    f"reviewed_by={revision.reviewed_by} 卡住 {stuck_for} 了"
                )

                if revision.operation == DictionaryRevision.OPERATION_CREATE:
                    self.stdout.write(self.style.WARNING(
                        "      → create 操作，無法自動辨識對應的新建記錄，需人工複查（見本檔案 docstring）"
                    ))
                    continue

                if not apply_fixes:
                    continue

                self._try_apply(read_db, revision)
        finally:
            read_db.close()

    def _try_apply(self, read_db, revision):
        tree_getter = _TREE_GETTERS.get(revision.target_kind)
        if tree_getter is None:
            self.stdout.write(self.style.WARNING(f"      → 未知的 target_kind，跳過"))
            return

        try:
            current = tree_getter(read_db, revision.target_id)
            exists = True
        except dw.DictionaryWriteError:
            current = None
            exists = False

        expect_exists = revision.operation != DictionaryRevision.OPERATION_DELETE
        if exists != expect_exists:
            self.stdout.write(self.style.ERROR(
                f"      → 目標存在狀態（{'存在' if exists else '不存在'}）跟預期的操作方向"
                f"（{revision.operation}）不一致，可能代表 dictionary DB 那步其實沒有真的 commit "
                f"成功，不是單純記帳失敗——跳過，需人工複查"
            ))
            return

        with transaction.atomic():
            revision = DictionaryRevision.objects.select_for_update().get(pk=revision.pk)
            if revision.applied_at is not None:
                self.stdout.write("      → 已經在其他地方補完成了，略過")
                return
            revision.applied_at = timezone.now()
            revision.save(update_fields=["applied_at", "updated_at"])
            # write_audit_log() 預期一個真正的 Django HttpRequest（讀
            # request.META 記 IP／User-Agent）；管理指令沒有這個東西，用一個
            # 只帶空 META 的替身物件湊出相同介面，稽核紀錄的 actor_uid 標成
            # 這支指令自己的名字，方便事後追查是自動補完成而非人工在後台點的。
            fake_request = SimpleNamespace(META={})
            safe_write_audit_log(
                fake_request, {"uid": "system:reconcile_stuck_dictionary_revisions"},
                "approve_proposal", revision.target_id or f"revision:{revision.pk}",
                after=json.loads(json.dumps(current, default=str)) if current else {"deleted": True},
                target_type=_revision_target_type(revision),
            )
        invalidate_dictionary_cache(
            _CACHE_SCOPES.get(revision.target_kind, ["all"]),
            tribes=[revision.tribe] if revision.tribe else None,
        )
        self.stdout.write(self.style.SUCCESS(f"      → 已補完成"))
