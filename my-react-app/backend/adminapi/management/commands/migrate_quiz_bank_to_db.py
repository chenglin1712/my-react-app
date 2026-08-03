"""把 backend/crawler/*_bank.py 五個族語的中高級/高級題庫（VOCAB_BANK／
CATEGORY_TARGETS＋dictionary.db／CLOZE_PASSAGES）搬進資料庫，並把
TRIBE_CONFIG 的 5 筆值種進 QuizSourceConfig。

用法：
    python manage.py migrate_quiz_bank_to_db

遷移進去的資料狀態一律是 pending_review（待審核），不是 published——五個
*_bank.py 檔案的開頭都寫著同一句警語：「部署為正式教材前，建議請族語老師
或通過族語認證的師資再次審定用字與語感」，遷移完直接讓學生看到等於跳過
這一步，違背檔案自己寫的警語。

冪等：重複執行不會產生重複資料——QuizVocabItem 用 (tribe, foreign_word,
chinese_gloss) 判斷是否已存在，QuizClozePassage 用 (tribe, passage_foreign)，
QuizSourceConfig 直接 update_or_create（每次執行都會把值同步成 TRIBE_CONFIG
目前的內容）。
"""
from django.core.management.base import BaseCommand

from adminapi.models import QuizClozePassage, QuizSourceConfig, QuizVocabItem
from crawler import amis_bank, bunun_bank, dictionary_source, kavalan_bank, paiwan_bank, tayal_bank

MIGRATED_BY = "system:migration"

# 原本 crawler/views.py 的 TRIBE_CONFIG 字典值——那個字典已經被這次的
# QuizSourceConfig 取代並整個移除，這裡只是把同一組歷史值原樣種進資料庫，
# 種完之後這份常數就沒有其他用途，不需要考慮之後同步更新的問題。
_SOURCE_CONFIG_SEED = {
    "tayal": {"dialect_id": 6, "display_name": "泰雅語 - 賽考利克泰雅語"},
    "amis": {"dialect_id": 2, "display_name": "阿美語 - 秀姑巒阿美語"},
    "bunun": {"dialect_id": 22, "display_name": "布農語 - 郡群布農語"},
    "kavalan": {"dialect_id": 34, "display_name": "噶瑪蘭語 - 噶瑪蘭語"},
    "paiwan": {"dialect_id": 25, "display_name": "排灣語 - 中排灣語"},
}

# tayal 是唯一還把外語拼寫直接寫死在 VOCAB_BANK 的族語，其餘四個只有
# CATEGORY_TARGETS（要考哪些中文詞義），實際拼寫要即時查 dictionary.db。
_DB_BACKED_BANKS = {
    "amis": amis_bank,
    "bunun": bunun_bank,
    "kavalan": kavalan_bank,
    "paiwan": paiwan_bank,
}


class Command(BaseCommand):
    help = "把 crawler/*_bank.py 五個族語的題庫內容搬進資料庫（狀態為待審核）"

    def handle(self, *args, **options):
        vocab_created, vocab_skipped = self._migrate_vocab()
        cloze_created, cloze_skipped = self._migrate_cloze()
        source_count = self._migrate_source_config()

        self.stdout.write(self.style.SUCCESS(
            f"配合題詞彙：新增 {vocab_created} 筆、略過已存在 {vocab_skipped} 筆\n"
            f"克漏字短文：新增 {cloze_created} 筆、略過已存在 {cloze_skipped} 筆\n"
            f"外部題源設定：{source_count} 筆（tribe/dialect_id/display_name 皆同步為最新值）"
        ))

    def _migrate_vocab(self):
        created = skipped = 0

        # tayal：VOCAB_BANK 本身就是完整的 {tayal, chinese, category} 清單，直接搬。
        for item in tayal_bank.VOCAB_BANK:
            _, was_created = QuizVocabItem.objects.get_or_create(
                tribe="tayal", foreign_word=item["tayal"], chinese_gloss=item["chinese"],
                defaults={
                    "category": item["category"],
                    "status": QuizVocabItem.STATUS_PENDING_REVIEW,
                    "created_by": MIGRATED_BY,
                },
            )
            created += was_created
            skipped += not was_created

        # amis/bunun/kavalan/paiwan：CATEGORY_TARGETS 只有中文詞義清單，
        # 逐類別呼叫 fetch_words_by_glosses 把「這一類要考哪些詞義」全部
        # 解析成實際詞條——用「全部解析」而不是 sample_matching_vocab 的
        # 隨機抽樣，因為遷移要保留完整的既有課程設計廣度，不是凍結某一次
        # 隨機抽到的子集合。
        for tribe, bank_module in _DB_BACKED_BANKS.items():
            for category, glosses in bank_module.CATEGORY_TARGETS.items():
                resolved = dictionary_source.fetch_words_by_glosses(tribe, glosses)
                for gloss, entry in resolved.items():
                    _, was_created = QuizVocabItem.objects.get_or_create(
                        tribe=tribe, foreign_word=entry["word"], chinese_gloss=gloss,
                        defaults={
                            "category": category,
                            "status": QuizVocabItem.STATUS_PENDING_REVIEW,
                            "created_by": MIGRATED_BY,
                        },
                    )
                    created += was_created
                    skipped += not was_created

        return created, skipped

    def _migrate_cloze(self):
        created = skipped = 0
        all_banks = {"tayal": tayal_bank, **_DB_BACKED_BANKS}

        for tribe, bank_module in all_banks.items():
            for passage in bank_module.CLOZE_PASSAGES:
                _, was_created = QuizClozePassage.objects.get_or_create(
                    tribe=tribe, passage_foreign=passage["passage_ab"],
                    defaults={
                        "passage_chinese": passage["passage_ch"],
                        "blanks": passage["blanks"],
                        "status": QuizClozePassage.STATUS_PENDING_REVIEW,
                        "created_by": MIGRATED_BY,
                    },
                )
                created += was_created
                skipped += not was_created

        return created, skipped

    def _migrate_source_config(self):
        count = 0
        for tribe, config in _SOURCE_CONFIG_SEED.items():
            QuizSourceConfig.objects.update_or_create(
                tribe=tribe,
                defaults={
                    "dialect_id": config["dialect_id"],
                    "display_name": config["display_name"],
                    "updated_by": MIGRATED_BY,
                },
            )
            count += 1
        return count
