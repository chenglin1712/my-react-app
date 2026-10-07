"""還原某一批 apply_wordlist_mapping 寫入辭典的內容。預設只預覽，加 --apply 才執行。

  python manage.py revert_wordlist_mapping --batch-id <批次編號> [--apply]

只移除該批新增的來源連結／釋義，且只在詞條內容雜湊仍等於寫入後雜湊時才動（否則略過並回報）。
"""
from django.core.management.base import BaseCommand, CommandError

from adminapi import wordlist_apply as A


class Command(BaseCommand):
    help = "還原一批千詞表套用（預設只預覽）"

    def add_arguments(self, parser):
        parser.add_argument("--batch-id", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        try:
            r = A.revert_batch(opts["batch_id"], dry_run=not opts["apply"])
        except A.ApplyError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f"{'已還原' if opts['apply'] else '預覽'}：{r}")
