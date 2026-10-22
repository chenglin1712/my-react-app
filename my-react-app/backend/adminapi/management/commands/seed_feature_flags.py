"""種入 5 個族語各一筆 quiz_enabled_<tribe> 功能開關，加上族語翻譯功能總開關
translation_enabled、AI 助手總開關 ai_assistant_enabled，預設皆 enabled=True。

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
                    "description": f"關閉後，{tribe.display_name}的官方等級測驗與情境題會回傳 403，不再出題。",
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

        # AI 助手總開關：與翻譯同為付費 LLM 呼叫的費用出口，預設啟用，需要時可一鍵關閉。
        _, created = FeatureFlag.objects.get_or_create(
            key="ai_assistant_enabled",
            defaults={
                "label": "AI 助手",
                "description": "關閉後，右下角 AI 助手的對話與複習建議請求會回傳 403，不再呼叫 LLM。",
                "enabled": True,
            },
        )
        created_count += int(created)

        # 單題錯題講解（路線圖 #22）：預設【關閉】。真金鑰驗收完才從後台「功能開關」頁打開；
        # 後端判斷是 fail-closed（查不到這一列也視為關閉）。關閉時 review 頁的「AI 助手」分頁不顯示。
        _, created = FeatureFlag.objects.get_or_create(
            key="ai_question_review_enabled",
            defaults={
                "label": "AI 單題錯題講解",
                "description": "開啟後，複習頁選擇一題時可使用「AI 助手」針對該題講解（會呼叫付費 LLM）。預設關閉。",
                "enabled": False,
            },
        )
        created_count += int(created)

        # 學習記憶（路線圖 #21）：預設【關閉】。打開後學生還要在「我的學習記憶」頁自己勾選同意才會啟用；
        # 關閉旗標不會刪資料，學生仍可檢視與清除自己的記憶。後端 fail-closed（查不到這一列也視為關閉）。
        _, created = FeatureFlag.objects.get_or_create(
            key="ai_learner_memory_enabled",
            defaults={
                "label": "AI 學習記憶",
                "description": "開啟後，學生可在「我的學習記憶」頁勾選同意，讓 AI 助手記住學習狀況（會增加 LLM 用量）。預設關閉。",
                "enabled": False,
            },
        )
        created_count += int(created)

        # 後台 AI 產生題目草稿（路線圖 #23）：預設【關閉】（會呼叫付費 LLM）。產生的題目一律是草稿，要送審、
        # 由另一位審核者核可才會出現在學生題庫。後端 fail-closed（查不到這一列也視為關閉）。
        _, created = FeatureFlag.objects.get_or_create(
            key="ai_quiz_draft_enabled",
            defaults={
                "label": "AI 產生題目草稿",
                "description": "開啟後，後台編輯者可挑辭典詞條請 AI 產生情境題草稿（會呼叫付費 LLM）；草稿須送審並由其他審核者核可才會上線。預設關閉。",
                "enabled": False,
            },
        )
        created_count += int(created)

        # AI 助手圖片提問（路線圖 #24）：預設【關閉】（圖片的 token 成本較高，且可能拍到個資）。
        # 後端 fail-closed（查不到這一列也視為關閉）；圖片只用於該次請求，不保存。
        _, created = FeatureFlag.objects.get_or_create(
            key="ai_image_input_enabled",
            defaults={
                "label": "AI 助手圖片提問",
                "description": "開啟後，學生可在 AI 助手拍照或選圖提問（會呼叫付費 LLM，圖片 token 成本較高）；圖片只用於該次回答，不會保存。預設關閉。",
                "enabled": False,
            },
        )
        created_count += int(created)

        # AI 助手回覆的讚／倒讚（路線圖 #30）：預設【關閉】。學生按下時會把「這一則問答」傳給管理者檢視
        # （只有 owner／admin 看得到、去識別化、保存 180 天），開放前請先在隱私政策頁補上說明。
        _, created = FeatureFlag.objects.get_or_create(
            key="ai_feedback_enabled",
            defaults={
                "label": "AI 助手意見回饋",
                "description": "開啟後，學生可對 AI 助手的每則回覆按讚或倒讚（倒讚可選原因）。按下時會把該則問答存給管理者檢視（不含身分、保存 180 天）。預設關閉。",
                "enabled": False,
            },
        )
        created_count += int(created)

        # 訪客翻譯試用（C-2）：預設【關閉】。要在後台「功能開關」頁手動打開，才會讓未登入的訪客
        # 以每瀏覽器每日 10 次的額度使用翻譯。後端判斷是 fail-closed（查不到這一列也視為關閉），
        # 所以即使沒跑種子，訪客也不會被放行。需要另外設定 GUEST_TRIAL_SECRET，見 .env.example。
        _, created = FeatureFlag.objects.get_or_create(
            key="guest_translation_enabled",
            defaults={
                "label": "訪客翻譯試用",
                "description": "開啟後，未登入的訪客每個瀏覽器每日可試用翻譯 10 次（台灣時間午夜重置）；關閉則訪客一律需登入。",
                "enabled": False,
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

        # 雲端筆記同步（D-2）：預設【開啟】。前端會問後端這個旗標（GET /api/v1/features），
        # 管理者關閉時筆記完全維持原本的「只存在瀏覽器」行為。種入前請先部署 firestore.rules（users/{uid}/notes）。
        _, created = FeatureFlag.objects.get_or_create(
            key="notes_cloud_sync",
            defaults={
                "label": "雲端筆記同步",
                "description": "開啟後，登入的使用者筆記會自動同步到雲端（停止輸入約 2 秒後儲存），換裝置登入也看得到；"
                               "首次開啟時會自動把本機舊筆記上傳。關閉則維持只存在瀏覽器。部署 Firestore 規則後才會正常運作。",
                "enabled": True,
            },
        )
        created_count += int(created)

        total = len(TRIBES) + 17
        self.stdout.write(self.style.SUCCESS(
            f"功能開關種子完成：共 {total} 筆（族語測驗開關 {len(TRIBES)} + 族語翻譯開關 1 + AI 助手開關 1 + 訪客翻譯試用 1 + 詞形分析器 2 + 測驗詞形干擾項 1 "
            f"+ 詞素學習 4 + 待專家驗證佇列 1 + 雲端筆記同步 1 + AI 單題錯題講解 1 + AI 學習記憶 1 + AI 產生題目草稿 1 + AI 助手圖片提問 1 + AI 助手意見回饋 1，除了族語測驗、翻譯與 AI 助手開關，其餘預設關閉（含訪客翻譯試用）），"
            f"新增 {created_count} 筆，其餘已存在維持原值。"
        ))
