"""種入 5 個族語各一筆 quiz_enabled_<tribe> 功能開關，預設 enabled=True。

用法：
    python manage.py seed_feature_flags

這是唯一在這批「並行項目」裡真正接上判斷的功能開關（族語測驗總開關，見
crawler/views.py 的 get_quiz_data／get_situation_quiz_data）；其餘 key
目前只登錄在這張表，還沒有程式碼真的去讀。預設全部 enabled=True，維持
現況行為，管理者主動關閉才會改變。用 get_or_create()，已存在的 key 不
覆蓋，可重複執行、冪等。
"""
from django.core.management.base import BaseCommand

from adminapi.models import FeatureFlag
from config.tribes import TRIBES


class Command(BaseCommand):
    help = "種入 5 個族語的 quiz_enabled_<tribe> 功能開關（冪等，可重複執行）"

    def handle(self, *args, **options):
        created_count = 0
        for tribe in TRIBES:
            _, created = FeatureFlag.objects.get_or_create(
                key=f"quiz_enabled_{tribe.slug}",
                defaults={
                    "label": f"{tribe.short_name}語測驗",
                    "description": f"關閉後，{tribe.full_name}的官方等級測驗與情境題會回傳 403，不再出題。",
                    "enabled": True,
                },
            )
            created_count += int(created)

        self.stdout.write(self.style.SUCCESS(
            f"功能開關種子完成：共 {len(TRIBES)} 筆族語測驗開關，新增 {created_count} 筆，其餘已存在維持原值。"
        ))
