"""刪除超過保存天數的訪客翻譯試用計次資料（C-2）。

資料只有雜湊值，且只對「當天」的計次有用；隱私說明承諾的保存期限就靠這個指令（以及 FastAPI
寫入時 1% 機率的機會式清理）落實。建議用排程每天跑一次。

用法：
    python manage.py purge_guest_trial_usage              # 刪除超過 3 天的資料
    python manage.py purge_guest_trial_usage --days 1
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from adminapi.models import GuestTranslationUsage

# 與 fastAPI/guest_trial.py 的 RETENTION_DAYS 一致
DEFAULT_RETENTION_DAYS = 3
_TAIPEI_OFFSET = timedelta(hours=8)


class Command(BaseCommand):
    help = "刪除超過保存天數的訪客翻譯試用計次資料（只含雜湊值）"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=DEFAULT_RETENTION_DAYS, help="保存天數（預設 3）")

    def handle(self, *args, **options):
        days = options["days"]
        if days < 0:
            self.stderr.write("--days 不可為負數")
            return
        # 計次的 day 是台灣日期，清理基準也用台灣日期，兩邊才不會差一天
        today_taipei = (timezone.now() + _TAIPEI_OFFSET).date()
        cutoff = today_taipei - timedelta(days=days)
        deleted, _ = GuestTranslationUsage.objects.filter(day__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"已刪除 {deleted} 筆超過 {days} 天的訪客試用計次資料"))
