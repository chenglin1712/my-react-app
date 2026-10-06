"""清除詞素學習的研究事件（依使用者，或依保存期限）。預設只預覽筆數，加 --yes 才真的刪除。

用法：
    python manage.py purge_quiz_research_data --uid <使用者 uid> [--yes]
    python manage.py purge_quiz_research_data --older-than-days 180 [--yes]

--uid 需要設定 QUIZ_RESEARCH_SALT（用它從 uid 算出事件裡的假名）。刪除使用者事件時會一併把同意紀錄標記為已撤回。
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from adminapi import quiz_research_service as svc
from adminapi.models import QuizSkillEvent
from config import quiz_research as QR
from datetime import timedelta


class Command(BaseCommand):
    help = "清除詞素學習研究事件（預設只預覽，加 --yes 才刪除）"

    def add_arguments(self, parser):
        parser.add_argument("--uid", default=None, help="刪除這位使用者的全部事件並撤回同意")
        parser.add_argument("--older-than-days", type=int, default=None, help="刪除超過這個天數的事件")
        parser.add_argument("--yes", action="store_true", help="真的刪除（沒有這個旗標只預覽）")

    def handle(self, *args, **opts):
        uid, days = opts["uid"], opts["older_than_days"]
        if bool(uid) == (days is not None):
            raise CommandError("請擇一指定 --uid 或 --older-than-days")
        if uid:
            pseud = QR.pseudonym(uid)
            if pseud is None:
                raise CommandError("未設定 QUIZ_RESEARCH_SALT（或 uid 為空），無法算出假名")
            count = QuizSkillEvent.objects.filter(pseudonym=pseud).count()
            if not opts["yes"]:
                self.stdout.write(f"預覽：會刪除這位使用者的 {count} 筆事件並撤回同意（加 --yes 才執行）")
                return
            result = svc.purge_user(uid)
            self.stdout.write(self.style.SUCCESS(f"已刪除 {result['events_deleted']} 筆事件，撤回同意紀錄 {result['consent_revoked']} 筆"))
            return
        if days < 1:
            raise CommandError("--older-than-days 必須 >= 1")
        count = QuizSkillEvent.objects.filter(occurred_at__lt=timezone.now() - timedelta(days=days)).count()
        if not opts["yes"]:
            self.stdout.write(f"預覽：會刪除 {count} 筆超過 {days} 天的事件（加 --yes 才執行）")
            return
        self.stdout.write(self.style.SUCCESS(f"已刪除 {svc.purge_older_than(days)} 筆超過 {days} 天的事件"))
