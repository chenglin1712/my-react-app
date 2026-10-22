"""清除 AI 助手的學習記憶（路線圖 #21），依保存期限或依使用者。預設只預覽筆數，加 --yes 才真的刪除。

用法：
    python manage.py purge_learner_memory [--older-than-days 180] [--yes]     # 最後一次更新超過期限的記憶檔
    python manage.py purge_learner_memory --uid <使用者 uid> [--yes]          # 某位使用者的全部記憶並撤回同意

保存期限預設 180 天（AIModel.memory_store.RETENTION_DAYS，使用者在「我的學習記憶」頁看到的數字也是它）。
請排程每天跑一次（例如 cron：0 3 * * * python manage.py purge_learner_memory --yes）。
"""
import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from AIModel import memory_store
from adminapi.models import LearnerMemoryFile


class Command(BaseCommand):
    help = "清除 AI 助手學習記憶（預設只預覽，加 --yes 才刪除）"

    def add_arguments(self, parser):
        parser.add_argument("--uid", default=None, help="刪除這位使用者的全部記憶並撤回同意")
        parser.add_argument("--older-than-days", type=int, default=memory_store.RETENTION_DAYS,
                            help=f"刪除最後更新超過這個天數的記憶檔（預設 {memory_store.RETENTION_DAYS}）")
        parser.add_argument("--yes", action="store_true", help="真的刪除（沒有這個旗標只預覽）")

    def handle(self, *args, **opts):
        uid, days = opts["uid"], opts["older_than_days"]
        if uid:
            count = LearnerMemoryFile.objects.filter(uid=uid).count()
            if not opts["yes"]:
                self.stdout.write(f"預覽：會刪除這位使用者的 {count} 個記憶檔並撤回同意（加 --yes 才執行）")
                return
            self.stdout.write(self.style.SUCCESS(f"已刪除 {memory_store.revoke_consent(uid)} 個記憶檔並撤回同意"))
            return
        if days < 1:
            raise CommandError("--older-than-days 必須 >= 1")
        cutoff = timezone.now() - datetime.timedelta(days=days)
        count = LearnerMemoryFile.objects.filter(updated_at__lt=cutoff).count()
        if not opts["yes"]:
            self.stdout.write(f"預覽：會刪除 {count} 個超過 {days} 天沒更新的記憶檔（加 --yes 才執行）")
            return
        self.stdout.write(self.style.SUCCESS(f"已刪除 {memory_store.purge_expired(days=days)} 個超過 {days} 天沒更新的記憶檔"))
