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

        # 詞形分析器的兩個旗標預設【關閉】（跟其他旗標預設啟用相反）：
        # 這個功能會讓更多詞被判成有佐證，錯放行比漏判嚴重，必須明確打開才生效。
        # 建議流程：先開 shadow（只記錄、不改輸出）觀察真實流量，再開 analyzer。
        for key, label, description in (
            ("translation_morphology_shadow", "翻譯詞形分析器（僅記錄）",
             "開啟後，翻譯的佐證檢核會在背景記錄詞形分析器『本來會把哪些詞升級成有佐證』，"
             "完全不改變任何翻譯輸出。用來在正式啟用前用真實流量驗證。"),
            ("translation_morphology_analyzer", "翻譯詞形分析器（正式啟用）",
             "開啟後，詞形分析器通過校準的規則會讓更多詞形被判成『由詞根衍生』。只使用直接命中、"
             "只涵蓋放行檔啟用的族語。出問題時關閉即可恢復原本行為（最慢約 30 秒生效）。"),
        ):
            _, created = FeatureFlag.objects.get_or_create(
                key=key, defaults={"label": label, "description": description, "enabled": False},
            )
            created_count += int(created)

        # 測驗的詞形干擾項（句子填空題）：預設關閉，要人工抽樣檢查過再開。
        _, created = FeatureFlag.objects.get_or_create(
            key="quiz_morphology_distractors",
            defaults={
                "label": "測驗詞形干擾項",
                "description": "開啟後，句子填空題的錯誤選項會優先用『同一個詞根換別的詞綴／中綴放錯位置』造出的詞形，"
                               "而不是隨機別的詞。造出的只是辭典與語料都找不到的『候選』錯誤形；關閉即恢復隨機干擾項。",
                "enabled": False,
            },
        )
        created_count += int(created)

        # 詞素級學習者模型（M4）的四個旗標，預設全部【關閉】，由上往下一層一層打開（程式端有相依檢查）：
        # 診斷 → 熟練度更新 → 適性選題；研究事件另外需要使用者同意。見 fastAPI/routes/quiz/flags.py。
        for key, label, description in (
            ("quiz_morphology_diagnosis", "詞素診斷（句子填空）",
             "開啟後，句子填空題會附診斷 token，作答時判斷錯在詞綴、中綴位置或詞根；只回傳診斷，不改任何學習資料。"
             "需要先開啟測驗詞形干擾項才有意義。"),
            ("quiz_rule_skill_update", "詞素熟練度更新",
             "開啟後，診斷結果會更新每位學習者在每條詞綴規則上的熟練度估計（存在伺服器端）。需要先開啟詞素診斷。"),
            ("quiz_rule_adaptive_selection", "詞素適性選題",
             "開啟後，句子填空會多挑熟練度估計較低的詞綴規則出題（有探索比例與同規則題數上限）。需要先開啟熟練度更新。"),
            ("quiz_rule_event_logging", "詞素學習研究事件",
             "開啟後，經使用者同意才記錄假名化的作答事件（只存假名、規則與預測值），用來評估熟練度模型。需要先開啟詞素診斷。"),
        ):
            _, created = FeatureFlag.objects.get_or_create(
                key=key, defaults={"label": label, "description": description, "enabled": False},
            )
            created_count += int(created)

        # 待專家驗證佇列（M5）：預設【關閉】。後端判斷是 fail-closed（查不到這一列也視為關閉），
        # 所以即使沒跑這個種子，佇列也不會開；打開前要先確認有人能提供意見。
        _, created = FeatureFlag.objects.get_or_create(
            key="verification_queue",
            defaults={
                "label": "待專家驗證佇列",
                "description": "開啟後，後台『待驗證佇列』頁面可使用：檢視候選詞形、提交意見、匯出待填 CSV 與匯入意見。"
                               "意見只被收集，不會寫回辭典或測驗題庫；所有項目都仍待專家驗證。",
                "enabled": False,
            },
        )
        created_count += int(created)

        total = len(TRIBES) + 9
        self.stdout.write(self.style.SUCCESS(
            f"功能開關種子完成：共 {total} 筆（族語測驗開關 {len(TRIBES)} + 族語翻譯開關 1 + 詞形分析器 2 + 測驗詞形干擾項 1 "
            f"+ 詞素學習 4 + 待專家驗證佇列 1，除了族語測驗與翻譯開關，其餘預設關閉），"
            f"新增 {created_count} 筆，其餘已存在維持原值。"
        ))
