"""把千詞表對照表中『語別明確相同、辭典唯一同名』的詞形標為 accept（決定者 system:auto-same-dialect）。
預設只預覽，加 --apply 才寫入對照表（Django 庫）。其他類別（未標語別、跨語別、多筆、近似形、新增）一律不碰，要人工決定。

  python manage.py decide_wordlist_mapping --auto-same-dialect [--tribe amis] [--apply]
  python manage.py decide_wordlist_mapping --auto-create [--tribe bunun] [--apply]    # 辭典沒有的詞：標為『新增』（嚴格條件，僅泰雅、布農）
"""
from django.core.management.base import BaseCommand, CommandError

from adminapi import wordlist_apply as A
from adminapi import wordlist_mapping as WM


class Command(BaseCommand):
    help = "自動接受語別明確相同且唯一同名的詞形（預設只預覽）"

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument("--auto-same-dialect", action="store_true")
        g.add_argument("--auto-create", action="store_true")
        parser.add_argument("--tribe", choices=sorted(WM.TARGETS))
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        if opts["auto_create"]:
            r = A.auto_decide_create(opts["tribe"], dry_run=not opts["apply"])
            self.stdout.write(f"{'已標為 create' if opts['apply'] else '預覽：將標為 create'}：{r['decided']} 個詞形／{r['groups']} 個詞條；略過（群數）：{r['skipped']}")
        else:
            r = A.auto_decide_same_dialect(opts["tribe"], dry_run=not opts["apply"])
            self.stdout.write(f"{'已標為 accept' if opts['apply'] else '預覽：將標為 accept'}：{r['decided']}；略過：{r['skipped']}")
        if not opts["apply"]:
            self.stdout.write("（未寫入。加 --apply 才寫入）")
