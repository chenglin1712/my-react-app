"""刪除超過保存天數的使用事件（UsageEvent）。

使用事件表是公開可寫、只增不減的（稽核 BE2b-10），需要定期清理；儀表板最長看一年多，預設保存 400 天。
預設只預覽要刪多少筆，加 --apply 才真的刪除；分批刪除，不會一次鎖住整張表。建議用排程每天跑一次。

用法：
    python manage.py purge_usage_events                # 預覽（保存 400 天）
    python manage.py purge_usage_events --days 180 --apply
"""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from adminapi.models import UsageEvent

DEFAULT_RETENTION_DAYS = 400
_BATCH = 5000


class Command(BaseCommand):
    help = "刪除超過保存天數的使用事件（預設只預覽，--apply 才刪）"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=DEFAULT_RETENTION_DAYS, help="保存天數（預設 400）")
        parser.add_argument("--apply", action="store_true", help="實際刪除；不加只預覽")

    def handle(self, *args, **options):
        days = options["days"]
        if days < 1:
            raise CommandError("--days 必須至少 1")
        cutoff = timezone.now() - timedelta(days=days)
        old = UsageEvent.objects.filter(created_at__lt=cutoff)
        total = old.count()
        if not options["apply"]:
            self.stdout.write(f"預覽：有 {total} 筆超過 {days} 天的使用事件會被刪除。加 --apply 才會實際刪除。")
            return
        deleted_total = 0
        while True:
            ids = list(old.values_list("pk", flat=True)[:_BATCH])
            if not ids:
                break
            deleted, _ = UsageEvent.objects.filter(pk__in=ids).delete()
            deleted_total += deleted
        self.stdout.write(self.style.SUCCESS(f"已刪除 {deleted_total} 筆超過 {days} 天的使用事件"))
