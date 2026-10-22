"""清除過期的 AI 助手內容審核事件（路線圖 #28）。預設只預覽筆數，加 --yes 才真的刪除。

用法：
    python manage.py purge_ai_moderation [--older-than-days 30] [--yes]

保存期限預設 30 天（adminapi.models.ai_assistant.MODERATION_RETENTION_DAYS）。請排程每天跑一次。
"""
import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from adminapi.models import AiModerationEvent
from adminapi.models.ai_assistant import MODERATION_RETENTION_DAYS


class Command(BaseCommand):
    help = "清除過期的 AI 助手內容審核事件（預設只預覽，加 --yes 才刪除）"

    def add_arguments(self, parser):
        parser.add_argument("--older-than-days", type=int, default=MODERATION_RETENTION_DAYS,
                            help=f"刪除建立超過這個天數的事件（預設 {MODERATION_RETENTION_DAYS}）")
        parser.add_argument("--yes", action="store_true", help="真的刪除（沒有這個旗標只預覽）")

    def handle(self, *args, **opts):
        days = opts["older_than_days"]
        if days < 1:
            raise CommandError("--older-than-days 必須 >= 1")
        queryset = AiModerationEvent.objects.filter(created_at__lt=timezone.now() - datetime.timedelta(days=days))
        if not opts["yes"]:
            self.stdout.write(f"預覽：會刪除 {queryset.count()} 筆超過 {days} 天的審核事件（加 --yes 才執行）")
            return
        deleted, _ = queryset.delete()
        self.stdout.write(self.style.SUCCESS(f"已刪除 {deleted} 筆超過 {days} 天的審核事件"))
