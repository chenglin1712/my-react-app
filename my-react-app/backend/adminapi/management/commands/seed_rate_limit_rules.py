"""把目前程式碼裡實際存在的全部限流呼叫點，一次性種入 RateLimitRule。

用法：
    python manage.py seed_rate_limit_rules

Django 端 61+ 個呼叫點（adminapi/_shared.py、crawler/views.py、
AIModel/views.py、CrosswordPuzzle/views.py 四個共用限流函式各自的呼叫端）
與 FastAPI 端 12 個 @limiter.limit(...) 呼叫點，值全部設成目前程式碼裡
寫死的原始值——這樣後台列表一開始就完整可見/可編輯，不必等呼叫端逐一
登錄。用 get_or_create()，已存在的 key 完全不動（只在新建時設定初始值），
可重複執行、冪等；之後程式碼新增呼叫點時重跑這支指令即可補上新的，不會
覆蓋掉已經被後台改過的既有值。
"""
from django.core.management.base import BaseCommand

from adminapi.models import RateLimitRule

# 5 種題庫內容型別（quizbank_views._make_content_views 工廠）共用同一組
# 8 個動作，group 名稱在執行期用 f"{target_type}_{action}" 動態組成——
# 這裡靜態列舉出全部 40 種組合，而不是照抄程式碼跑一次動態產生，因為這是
# 「目前程式碼長怎樣」的快照，跟程式碼本身的產生方式無關。
_CONTENT_TYPE_LABELS = {
    "quiz_vocab_item": "配合題詞彙",
    "quiz_cloze_passage": "克漏字短文",
    "quiz_situation_item": "情境題",
    "quiz_true_false_item": "初級是非題",
    "quiz_choice_item": "中級選擇題",
}
_CONTENT_ACTION_RATES = {
    "create": "30/m", "update": "60/m", "delete": "30/m",
    "submit": "60/m", "withdraw": "60/m", "approve": "60/m",
    "reject": "60/m", "unpublish": "60/m",
}
_ACTION_LABELS = {
    "create": "建立", "update": "編輯", "delete": "刪除",
    "submit": "送審", "withdraw": "撤回送審", "approve": "核准",
    "reject": "退件", "unpublish": "下架",
}

# 同一批內容型別 + 公告，另外共用「編輯已發布內容」機制（revisions.py），
# 3 個動作全部沿用 rate_limited_response() 的預設值 60/m（呼叫端沒有傳
# rate= 參數）。
_REVISION_TARGET_LABELS = {**_CONTENT_TYPE_LABELS, "announcement": "公告"}
_REVISION_ACTION_LABELS = {
    "edit_published": "編輯已發布內容",
    "approve_revision": "核准已發布內容的修改",
    "reject_revision": "退件已發布內容的修改",
}

DJANGO_RULES = [
    ("dictionary_taxonomy_write", "30/m", "辭典主檔（分類/詞類/焦點/來源/詞綴）建立/改名/刪除"),
    ("dictionary_taxonomy_merge", "20/m", "辭典主檔合併"),
    ("usage_event_create", "120/m", "公開事件回報端點（依 IP）"),
    ("user_create", "10/m", "後台建立使用者"),
    ("user_role", "30/m", "指派/收回角色"),
    ("user_profile", "30/m", "編輯使用者資料"),
    ("user_password", "10/m", "管理員變更使用者密碼"),
    ("user_suspend", "30/m", "停權/解除停權"),
    ("user_force_logout", "30/m", "強制登出"),
    ("user_export", "10/m", "匯出個資"),
    ("user_delete", "10/m", "刪除使用者帳號"),
    ("announcement_create", "30/m", "建立公告"),
    ("public_announcement_list", "120/m", "公開公告列表（依 IP）"),
    ("announcement_update", "60/m", "編輯公告"),
    ("announcement_delete", "30/m", "刪除公告"),
    ("announcement_submit", "60/m", "公告送審"),
    ("announcement_withdraw", "60/m", "公告撤回送審"),
    ("announcement_approve", "60/m", "公告核准"),
    ("announcement_reject", "60/m", "公告退件"),
    ("announcement_unpublish", "60/m", "公告下架"),
    ("announcement_republish", "60/m", "公告重新上架"),
    ("announcement_sync_crawler", "5/m", "同步爬蟲活動成公告"),
    ("exam_schedule_refresh", "10/m", "手動重新爬取考試時程"),
    ("exam_schedule_override_write", "30/m", "考試時程人工覆寫"),
    ("homepage_config_update", "30/m", "首頁版位設定更新"),
    ("public_homepage_config", "120/m", "公開首頁版位設定（依 IP）"),
    ("dictionary_import_upload", "10/m", "辭典批次匯入上傳"),
    ("dictionary_import_preflight", "20/m", "辭典批次匯入預檢"),
    ("dictionary_import_autocreate", "10/m", "批次匯入自動建立缺漏主檔"),
    ("dictionary_import_submit", "60/m", "批次匯入送審"),
    ("dictionary_import_withdraw", "60/m", "批次匯入撤回"),
    ("dictionary_import_approve", "10/m", "批次匯入核准套用"),
    ("dictionary_import_reject", "60/m", "批次匯入退件"),
    ("dictionary_export", "10/m", "辭典族語匯出"),
    ("note_toggle_deleted", "30/m", "分享筆記下架/恢復"),
    ("recording_delete", "30/m", "發音錄音刪除"),
    ("report_resolve", "30/m", "檢舉核結/駁回"),
    ("quiz_source_config_update", "30/m", "外部題源設定更新"),
    ("irt_config_update", "30/m", "IRT 參數更新"),
    ("public_irt_config", "120/m", "公開 IRT 參數（依 IP，供 FastAPI 輪詢）"),
    ("dictionary_word_create", "30/m", "辭典新建詞條提案"),
    ("dictionary_word_propose", "60/m", "辭典既有詞條修改提案"),
    ("dictionary_word_delete_proposal", "30/m", "辭典詞條刪除提案"),
    ("dictionary_revision_update", "60/m", "辭典詞條修改提案更新"),
    ("dictionary_revision_submit", "60/m", "辭典修改提案送審"),
    ("dictionary_revision_withdraw", "60/m", "辭典修改提案撤回"),
    ("dictionary_revision_approve", "60/m", "辭典修改提案核准"),
    ("dictionary_revision_reject", "60/m", "辭典修改提案退件"),
    ("dictionary_grammar_create", "30/m", "文法章節新建提案"),
    ("dictionary_grammar_propose", "60/m", "文法章節修改提案"),
    ("dictionary_grammar_delete_proposal", "30/m", "文法章節刪除提案"),
    ("dictionary_grammar_reorder", "30/m", "文法章節排序"),
    ("tayal_chat", "10/m", "AI 對話（泰雅語聊天）"),
    ("review_tayal_chat", "10/m", "AI 對話（複習模式）"),
    ("generate_crossword", "30/m", "產生填字遊戲"),
    ("submit_ans", "30/m", "填字遊戲繳交答案"),
    ("get_situation_quiz_data", "30/m", "情境題出題"),
    ("get_quiz_data", "30/m", "官方等級測驗出題"),
    ("get_tayal_imformation", "60/m", "首頁消息（活動快訊）爬取"),
    ("get_exam_schedule", "60/m", "考試時程爬取"),
    ("game_config_update", "30/m", "遊戲參數設定更新"),
    ("public_game_config", "120/m", "公開遊戲參數（依 IP，供 FastAPI 輪詢）"),
    ("rate_limit_rule_update", "30/m", "限流規則更新"),
    ("public_fastapi_rate_limit_rules", "120/m", "公開 FastAPI 限流規則（依 IP，供 FastAPI 輪詢）"),
    ("feature_flag_update", "30/m", "功能開關切換"),
    ("system_cache_clear_django", "10/m", "清除 Django 具名快取"),
    ("system_cache_clear_fastapi", "10/m", "清除 FastAPI 快取（通知 /internal/cache/invalidate）"),
]

for _target_type, _type_label in _CONTENT_TYPE_LABELS.items():
    for _action, _rate in _CONTENT_ACTION_RATES.items():
        DJANGO_RULES.append((
            f"{_target_type}_{_action}", _rate, f"{_type_label}{_ACTION_LABELS[_action]}",
        ))

for _target_type, _type_label in _REVISION_TARGET_LABELS.items():
    for _action, _action_label in _REVISION_ACTION_LABELS.items():
        DJANGO_RULES.append((
            f"{_target_type}_{_action}", "60/m", f"{_type_label}{_action_label}",
        ))

FASTAPI_RULES = [
    ("vision_analyze_image", "10/minute", "Google Cloud Vision 圖片辨識"),
    ("crawler_search_tayal_dictionary", "10/minute", "外部詞典比對放大請求"),
    ("quiz_compare_audio", "20/minute", "發音評分（wav2vec2 推論）"),
    ("dictionary_audio_proxy_proxy_audio", "60/minute", "辭典音檔代理"),
    ("dictionary_audio_proxy_get_sentence_audio", "60/minute", "例句音檔查詢"),
    ("dictionary_grammar_get_grammar", "60/minute", "文法章節查詢"),
    ("dictionary_grammar_search_grammar", "20/minute", "文法搜尋（全表掃描）"),
    ("dictionary_grammar_get_grammar_affixes", "60/minute", "詞綴查詢"),
    ("dictionary_grammar_get_grammar_quiz_material", "60/minute", "文法測驗選題"),
    ("dictionary_search_multiword", "60/minute", "辭典多關鍵字搜尋"),
    ("dictionary_search_all_words", "60/minute", "辭典全詞條查詢"),
    ("dictionary_search_allsearch", "60/minute", "辭典單字搜尋"),
    ("translation_translate", "10/minute", "族語翻譯（含 LLM 呼叫）"),
    ("translation_capabilities", "60/minute", "翻譯能力資訊查詢"),
]


class Command(BaseCommand):
    help = "把目前程式碼裡實際存在的全部限流呼叫點，一次性種入 RateLimitRule（冪等，可重複執行）"

    def handle(self, *args, **options):
        created_count = 0
        for key, rate, description in DJANGO_RULES:
            _, created = RateLimitRule.objects.get_or_create(
                key=key,
                defaults={
                    "backend": RateLimitRule.BACKEND_DJANGO,
                    "rate": rate,
                    "default_rate": rate,
                    "description": description,
                },
            )
            created_count += int(created)
        for key, rate, description in FASTAPI_RULES:
            _, created = RateLimitRule.objects.get_or_create(
                key=key,
                defaults={
                    "backend": RateLimitRule.BACKEND_FASTAPI,
                    "rate": rate,
                    "default_rate": rate,
                    "description": description,
                },
            )
            created_count += int(created)

        total = len(DJANGO_RULES) + len(FASTAPI_RULES)
        self.stdout.write(self.style.SUCCESS(
            f"限流規則種子完成：共 {total} 筆呼叫點（Django {len(DJANGO_RULES)} + "
            f"FastAPI {len(FASTAPI_RULES)}），新增 {created_count} 筆，其餘已存在維持原值。"
        ))
