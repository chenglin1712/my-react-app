"""重建族語翻譯功能的『語料實際出現過的詞形』佐證表（translation_attested_form）。

族語翻譯功能（backend/fastAPI/routes/translation/）的佐證檢核分四層，第二層
"attested" 靠的就是這張表：words.name 只收錄詞條原形，例句裡用的常是詞綴
變化過的形式（這五個族語詞綴變化重）——只拿 words.name 當驗證詞表，在人工
正確句子上覆蓋率只有 69~91%，加上這張表收錄的「語料裡有、字典詞條沒有」的
詞形後才到 91~99%（見這個功能的設計討論紀錄，數字是拿 90% 語料建表、在未見
過的 10% 上實測得出）。

掃描每個族語全部 word_explanation_sentence.original_sentence，用
config.translation_lexicon 的 tokenize()／normalize_token() 切詞、正規化
（這兩個函式也是翻譯功能本身處理使用者輸入/LLM 輸出時用的同一套，兩邊用
同一套正規化規則，查表才會一致——這個模組原本放在 FastAPI 的 route 層底下，
搬到 backend/config 共用層之前，這支 Django command 得反過來 import FastAPI
的內部模組），排除掉本來就是字典詞條本身的詞形（那些已經被 Tier A 覆蓋，
不需要在這張表重複一份）。

用法：
    python manage.py rebuild_translation_attested_forms [--tribe SLUG]

冪等、整批重算：每次執行先清空目標族語既有列再重新計算寫入，不是增量更新
——語料資料改動後理應整批重算，不會有「殘留舊詞形」的問題。目前沒有排程
自動執行，辭典資料異動後（P4 後台辭典管理新增/修改例句）要手動重跑一次；
之後若需要自動化可以掛進 backend/fastAPI/routes/internal.py 的快取失效流程，
現況先手動執行即可，翻譯功能不是即時反映辭典編輯的高頻寫入場景。
"""
from django.core.management.base import BaseCommand, CommandError

from config.tribes import TRIBES
from dictionary_db.connect import dictionary_write_session
from dictionary_db.model import Word, WordExplanation, WordExplanationSentence, TranslationAttestedForm
from config.translation_lexicon import normalize_token, tokenize


class Command(BaseCommand):
    help = "重建族語翻譯功能的『語料實際出現過的詞形』佐證表（translation_attested_form）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--tribe", default=None,
            help="只重建單一族語（用 slug，例如 tayal）；不指定則重建全部五族",
        )

    def handle(self, *args, **options):
        tribe_slug = options.get("tribe")
        targets = TRIBES
        if tribe_slug:
            targets = [t for t in TRIBES if t.slug == tribe_slug]
            if not targets:
                raise CommandError(f"不支援的族語 slug：{tribe_slug}")

        for tribe in targets:
            count = self._rebuild_one(tribe.id, tribe.full_name)
            self.stdout.write(self.style.SUCCESS(
                f"{tribe.full_name}（{tribe.slug}）：寫入 {count} 筆語料詞形"
            ))

    def _rebuild_one(self, tribe_id: str, tribe_full_name: str) -> int:
        with dictionary_write_session() as db:
            # 已有字典詞條本身的正規化詞形——Tier A（headword）已經覆蓋，
            # 這張表只收錄「語料裡有、字典詞條沒有」的詞形，避免大部分內容
            # 只是字典詞條的重複。
            headword_norms = {
                normalize_token(name)
                for (name,) in db.query(Word.name).filter(Word.tribe_id == tribe_id).all()
                if name
            }

            rows = (
                db.query(WordExplanationSentence.id, WordExplanationSentence.original_sentence)
                .join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
                .join(Word, Word.id == WordExplanation.word_id)
                .filter(Word.tribe_id == tribe_id)
                .filter(WordExplanationSentence.original_sentence.isnot(None))
                .all()
            )

            # 詞形 -> 第一個出現它的句子 id。佐證要能引用真正的例句給使用者看，
            # 不能只回一個「有出現過」的布林值；同一詞形在多句出現時取第一個
            # 即可，不需要記錄全部句子。
            attested: dict[str, int] = {}
            for sentence_id, original in rows:
                for token in tokenize(original or ""):
                    norm = normalize_token(token)
                    if not norm or norm in headword_norms or norm in attested:
                        continue
                    attested[norm] = sentence_id

            db.query(TranslationAttestedForm).filter(
                TranslationAttestedForm.tribe_id == tribe_id
            ).delete(synchronize_session=False)

            if attested:
                db.bulk_save_objects([
                    TranslationAttestedForm(
                        tribe_id=tribe_id, surface_form_norm=norm, source_sentence_id=sentence_id,
                    )
                    for norm, sentence_id in attested.items()
                ])

            return len(attested)
