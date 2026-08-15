"""種入 5 個族語各一筆 quiz_enabled_<tribe> 功能開關，加上族語翻譯功能總開關
translation_enabled，預設皆 enabled=True。

用法：
    python manage.py seed_feature_flags

族語測驗總開關（crawler/views.py 的 get_quiz_data／get_situation_quiz_data）
與族語翻譯總開關（backend/fastAPI/routes/translation/api.py，透過
backend/fastAPI/feature_flags.py 讀取）是目前真正接上判斷的兩個開關；其餘
key 只登錄在這張表，還沒有程式碼真的去讀。預設全部 enabled=True，維持現況
行為，管理者主動關閉才會改變。用 get_or_create()，已存在的 key 不覆蓋，
可重複執行、冪等。
"""
from django.core.management.base import BaseCommand

from adminapi.models import FeatureFlag
from config.tribes import TRIBES


class Command(BaseCommand):
    help = "種入 5 個族語的 quiz_enabled_<tribe> 功能開關 + 族語翻譯總開關（冪等，可重複執行）"

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

        _, created = FeatureFlag.objects.get_or_create(
            key="translation_enabled",
            defaults={
                "label": "族語翻譯",
                "description": "關閉後，/translate 頁面的翻譯請求會回傳 403，不再呼叫 LLM。",
                "enabled": True,
            },
        )
        created_count += int(created)

        total = len(TRIBES) + 1
        self.stdout.write(self.style.SUCCESS(
            f"功能開關種子完成：共 {total} 筆（族語測驗開關 {len(TRIBES)} + 族語翻譯開關 1），"
            f"新增 {created_count} 筆，其餘已存在維持原值。"
        ))
