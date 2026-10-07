"""把對照表中已接受、未過期的決定，套用成辭典裡的來源連結（只增不減）。預設只預覽，加 --apply 才寫辭典。

  python manage.py apply_wordlist_mapping --tribe amis --limit 50                  # 預覽
  python manage.py apply_wordlist_mapping --tribe amis --limit 50 --apply
  python manage.py apply_wordlist_mapping --tribe amis --limit 50 --with-glosses --apply   # 另外補符合嚴格條件的釋義

每個寫入都有操作紀錄（WordlistApplyJournal），可用 revert_wordlist_mapping 還原。只新增來源連結（及受限釋義），
不改、不刪辭典的任何既有內容。寫入的是 DICTIONARY_DATABASE_URL 所指的資料庫（PostgreSQL 為主）。
"""
from django.core.management.base import BaseCommand, CommandError

from adminapi import wordlist_apply as A
from adminapi import wordlist_mapping as WM


class Command(BaseCommand):
    help = "套用千詞表對照表的決定到辭典（只增不減，預設只預覽）"

    def add_arguments(self, parser):
        parser.add_argument("--tribe", choices=sorted(WM.TARGETS))
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--with-glosses", action="store_true")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        if opts["limit"] < 1:
            raise CommandError("--limit 必須 >= 1")
        if not opts["apply"]:
            todo, skipped = A.plan(opts["tribe"], opts["with_glosses"])
            n_gloss = sum(1 for _, a in todo if "gloss" in a)
            self.stdout.write(f"預覽：可套用 {len(todo)} 個詞形（其中可補釋義 {n_gloss}）；略過：{dict(skipped)}")
            self.stdout.write(f"（未寫入。本次 --apply 最多處理 {opts['limit']} 個詞形）")
            return
        try:
            r = A.apply_batch(opts["tribe"], opts["limit"], opts["with_glosses"])
        except A.ApplyError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f"批次 {r['batch_id']}：可套用 {r['eligible_forms']}，本次處理 {r['processed_forms']}；結果 {r['results']}；略過 {r['skipped']}")
