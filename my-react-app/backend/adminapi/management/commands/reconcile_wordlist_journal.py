"""列出／人工對帳 apply_wordlist_mapping 中斷後留下的 pending 操作紀錄。預設只列出。

  python manage.py reconcile_wordlist_journal                                   # 列出 pending 與目前辭典狀態
  python manage.py reconcile_wordlist_journal --id 12 --as cancelled [--apply]  # 辭典沒有被寫入 → 取消 pending
  python manage.py reconcile_wordlist_journal --id 12 --as applied   [--apply]  # 辭典已被寫入 → 補完紀錄

兩種標記都有防呆（見 wordlist_apply.resolve_pending）：不符合辭典實際狀態就拒絕，不能只憑人說了算。
"""
from django.core.management.base import BaseCommand, CommandError

from adminapi import wordlist_apply as A


class Command(BaseCommand):
    help = "pending 操作紀錄對帳"

    def add_arguments(self, parser):
        parser.add_argument("--id", type=int)
        parser.add_argument("--as", dest="as_", choices=["applied", "cancelled"])
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        if opts["id"] is None:
            rows = A.pending_report()
            self.stdout.write(f"pending {len(rows)} 筆")
            for r in rows:
                self.stdout.write(str(r))
            return
        if not opts["as_"]:
            raise CommandError("指定 --id 時必須同時指定 --as")
        try:
            self.stdout.write(A.resolve_pending(opts["id"], opts["as_"], dry_run=not opts["apply"]))
        except A.ApplyError as exc:
            raise CommandError(str(exc))
