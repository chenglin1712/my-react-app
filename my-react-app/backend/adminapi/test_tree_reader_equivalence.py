"""O26：get_word_tree（單筆）改成與整批版共用同一份實作（_build_word_trees）。
這裡把「改動前」的逐層查詢版原樣放進來當對照基準，證明新單筆版回傳的整棵樹（含 content_hash、meta）
與舊版完全相同，並驗證查詢次數不再隨解釋、例句、標註數量增加。"""
from sqlalchemy.orm import Session

from dictionary_db import connect as connect_module
from dictionary_db import model as m

from . import dictionary_write as dw
from .dictionary_test_base import DictionaryDbTestCase
from .dictionary_write.content_hash import word_content_hash
from .dictionary_write.exceptions import WordNotFoundError
from .test_n_plus_one import _SqlCounter


# ---- 改動前的單筆實作（原樣）----
def old_get_word_tree(db: Session, word_id: str) -> dict:
    """組出單一詞條的完整巢狀 JSON（見規劃文件 P4 §2 的回應形狀）。給後台
    編輯器 GET 用；資料量以「單一詞條」為界，本機最極端的詞條（9 解釋／
    129 例句／1,265 標註項目）仍在合理範圍內，不需要另外分頁或延遲載入。
    """
    word = db.query(m.Word).filter(m.Word.id == word_id).one_or_none()
    if word is None:
        raise WordNotFoundError(f"詞條不存在：{word_id}")

    # 以下每個 .order_by() 都在 sort_order 之後加上 .id 當次要排序鍵——
    # sort_order 相同或為 NULL 時，資料庫不保證原本的順序，單筆查詢跟批次
    # 查詢（get_word_trees_for_tribe）可能因為執行計畫不同而排出不同順序，
    # 導致同一棵樹在兩個查詢路徑算出不同的 content_hash（獨立審查找到的
    # 問題）。.id 是遞增主鍵，順序穩定且跟兩個函式共用同一份排序規則。
    source_ids = [
        row.source_id for row in
        db.query(m.WordSource).filter(m.WordSource.word_id == word_id)
        .order_by(m.WordSource.sort_order, m.WordSource.id).all()
    ]
    audios = [
        {"id": a.id, "external_id": a.external_id, "file_id": a.file_id, "audio_class": a.audio_class}
        for a in db.query(m.WordAudio).filter(m.WordAudio.word_id == word_id)
        .order_by(m.WordAudio.sort_order, m.WordAudio.id).all()
    ]

    explanations = []
    explanation_rows = (
        db.query(m.WordExplanation)
        .filter(m.WordExplanation.word_id == word_id)
        .order_by(m.WordExplanation.sort_order, m.WordExplanation.id)
        .all()
    )
    for exp in explanation_rows:
        category_ids = [r.category_id for r in db.query(m.WordExplanationCategory)
                         .filter(m.WordExplanationCategory.explanation_id == exp.id)
                         .order_by(m.WordExplanationCategory.id).all()]
        pos_ids = [r.pos_id for r in db.query(m.WordExplanationPos)
                   .filter(m.WordExplanationPos.explanation_id == exp.id)
                   .order_by(m.WordExplanationPos.id).all()]
        focus_ids = [r.focus_id for r in db.query(m.WordExplanationFocus)
                     .filter(m.WordExplanationFocus.explanation_id == exp.id)
                     .order_by(m.WordExplanationFocus.id).all()]
        images = [
            {"id": img.id, "image_url": img.image_url}
            for img in db.query(m.WordExplanationImage)
            .filter(m.WordExplanationImage.explanation_id == exp.id)
            .order_by(m.WordExplanationImage.sort_order, m.WordExplanationImage.id).all()
        ]

        sentences = []
        sentence_rows = (
            db.query(m.WordExplanationSentence)
            .filter(m.WordExplanationSentence.explanation_id == exp.id)
            .order_by(m.WordExplanationSentence.sort_order, m.WordExplanationSentence.id)
            .all()
        )
        for sent in sentence_rows:
            sent_audios = [
                {"id": a.id, "external_id": a.external_id, "file_id": a.file_id, "audio_class": a.audio_class}
                for a in db.query(m.WordExplanationSentenceAudio)
                .filter(m.WordExplanationSentenceAudio.sentence_id == sent.id)
                .order_by(m.WordExplanationSentenceAudio.sort_order, m.WordExplanationSentenceAudio.id).all()
            ]

            anaphoras = []
            anaphora_rows = (
                db.query(m.WordExplanationAnaphora)
                .filter(m.WordExplanationAnaphora.sentence_id == sent.id)
                .order_by(m.WordExplanationAnaphora.sort_order, m.WordExplanationAnaphora.id)
                .all()
            )
            for ana in anaphora_rows:
                item_rows = (
                    db.query(m.WordExplanationAnaphoraItem)
                    .filter(m.WordExplanationAnaphoraItem.anaphora_id == ana.id)
                    .order_by(m.WordExplanationAnaphoraItem.sort_order, m.WordExplanationAnaphoraItem.id)
                    .all()
                )
                linked_ids = [i.word_id for i in item_rows if i.word_id]
                name_map = {}
                if linked_ids:
                    name_map = {
                        w.id: w.name for w in
                        db.query(m.Word.id, m.Word.name).filter(m.Word.id.in_(linked_ids)).all()
                    }
                anaphoras.append({
                    "id": ana.id, "is_highlight": bool(ana.is_highlight), "is_symbol": bool(ana.is_symbol),
                    "items": [
                        {
                            "id": item.id, "word_id": item.word_id, "name": item.name,
                            "word_name": name_map.get(item.word_id) if item.word_id else None,
                        }
                        for item in item_rows
                    ],
                })

            sentences.append({
                "id": sent.id, "external_id": sent.external_id,
                "original_sentence": sent.original_sentence,
                "chinese_sentence": sent.chinese_sentence, "english_sentence": sent.english_sentence,
                "audios": sent_audios, "anaphoras": anaphoras,
            })

        explanations.append({
            "id": exp.id, "external_id": exp.external_id,
            "chinese_explanation": exp.chinese_explanation, "english_explanation": exp.english_explanation,
            "category_ids": category_ids, "pos_ids": pos_ids, "focus_ids": focus_ids,
            "images": images, "sentences": sentences,
        })

    anaphora_item_refs = (
        db.query(m.WordExplanationAnaphoraItem)
        .filter(m.WordExplanationAnaphoraItem.word_id == word_id).count()
    )
    grammar_example_refs = (
        db.query(m.GrammarExampleWord)
        .filter(m.GrammarExampleWord.word_id == word_id).count()
    )

    tree = {
        "id": word.id, "tribe_id": word.tribe_id,
        "dialect": word.dialect or "", "name": word.name or "", "pinyin": word.pinyin or "",
        "variant": word.variant or "", "formation_word": word.formation_word or "",
        "derivative_root": word.derivative_root or "",
        "frequency": word.frequency or 0, "hit": word.hit or 0,
        "dictionary_note": word.dictionary_note or "", "word_img": word.word_img or "",
        "is_derivative_root": bool(word.is_derivative_root), "is_image": bool(word.is_image),
        "is_zuzucidian": bool(word.is_zuzucidian), "is_other_dialect": bool(word.is_other_dialect),
        "source_ids": source_ids, "audios": audios, "explanations": explanations,
    }
    tree["content_hash"] = word_content_hash(tree)
    tree["meta"] = {
        "referenced_by_anaphora_items": anaphora_item_refs,
        "referenced_by_grammar_examples": grammar_example_refs,
    }
    return tree


class SingleWordTreeEquivalenceTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.tribe_id = self.seed_tribe()

    def _seed_rich(self, word_id, explanations, sentences, items):
        db = connect_module.SessionLocal()
        try:
            for model, kwargs in (
                (m.PartOfSpeech, {"name": f"詞類{word_id}"}),
                (m.Focus, {"name": f"焦點{word_id}"}),
                (m.Source, {"name": f"來源{word_id}"}),
                (m.Category, {"name": f"分類{word_id}"}),
            ):
                db.add(model(**kwargs))
            db.flush()
            pos, focus, source, category = (db.query(x).filter(x.name.like(f"%{word_id}")).one()
                                            for x in (m.PartOfSpeech, m.Focus, m.Source, m.Category))
            if not db.query(m.Word.id).filter(m.Word.id == "linked").first():
                db.add(m.Word(id="linked", tribe_id=self.tribe_id, name="kolong"))
            word = m.Word(id=word_id, tribe_id=self.tribe_id, name=word_id, frequency=3, hit=2, is_image=True)
            db.add(word)
            db.flush()
            db.add(m.WordSource(word_id=word_id, source_id=source.id, sort_order=0))
            db.add(m.WordAudio(word_id=word_id, external_id="a", file_id="f", audio_class="word", sort_order=1))
            db.add(m.WordAudio(word_id=word_id, external_id="b", file_id="g", audio_class="word", sort_order=1))  # sort_order 相同
            for e in range(explanations):
                exp = m.WordExplanation(word_id=word_id, chinese_explanation=f"解釋{e}", sort_order=0)  # 全部同 sort_order
                db.add(exp)
                db.flush()
                db.add(m.WordExplanationCategory(explanation_id=exp.id, category_id=category.id))
                db.add(m.WordExplanationPos(explanation_id=exp.id, pos_id=pos.id))
                db.add(m.WordExplanationFocus(explanation_id=exp.id, focus_id=focus.id))
                db.add(m.WordExplanationImage(explanation_id=exp.id, image_url=f"https://x/{e}.png", sort_order=0))
                for s in range(sentences):
                    sent = m.WordExplanationSentence(explanation_id=exp.id, original_sentence=f"s{e}-{s}", sort_order=0)
                    db.add(sent)
                    db.flush()
                    db.add(m.WordExplanationSentenceAudio(sentence_id=sent.id, external_id="x", file_id="y", audio_class="c", sort_order=0))
                    for a in range(2):
                        ana = m.WordExplanationAnaphora(sentence_id=sent.id, sort_order=0, is_highlight=bool(a))
                        db.add(ana)
                        db.flush()
                        for i in range(items):
                            db.add(m.WordExplanationAnaphoraItem(
                                anaphora_id=ana.id, word_id="linked" if i % 2 == 0 else None, name=f"n{i}", sort_order=0))
            db.commit()
        finally:
            db.close()

    def _old_and_new(self, word_id):
        db = connect_module.SessionLocal()
        try:
            return old_get_word_tree(db, word_id), dw.get_word_tree(db, word_id)
        finally:
            db.close()

    def test_new_single_tree_is_identical_to_the_old_one(self):
        self._seed_rich("rich-a", explanations=3, sentences=2, items=3)
        self._seed_rich("rich-b", explanations=2, sentences=1, items=2)
        db = connect_module.SessionLocal()
        try:
            db.add(m.Word(id="bare", tribe_id=self.tribe_id, name="bare"))
            db.commit()
        finally:
            db.close()
        for word_id in ("rich-a", "rich-b", "bare", "linked"):
            old, new = self._old_and_new(word_id)
            self.assertEqual(new, old, word_id)

    def test_references_meta_counts_match(self):
        self._seed_rich("rich-a", explanations=1, sentences=1, items=2)
        old, new = self._old_and_new("linked")
        self.assertEqual(new["meta"], old["meta"])
        self.assertGreater(new["meta"]["referenced_by_anaphora_items"], 0)

    def test_missing_word_still_raises(self):
        db = connect_module.SessionLocal()
        try:
            with self.assertRaises(WordNotFoundError):
                dw.get_word_tree(db, "nope")
        finally:
            db.close()

    def test_query_count_is_constant_regardless_of_tree_size(self):
        self._seed_rich("small", explanations=1, sentences=1, items=1)
        self._seed_rich("big", explanations=4, sentences=3, items=4)
        counts, old_counts = {}, {}
        for word_id in ("small", "big"):
            db = connect_module.SessionLocal()
            try:
                with _SqlCounter(self.__class__._test_engine) as c:
                    dw.get_word_tree(db, word_id)
                counts[word_id] = c.count
                with _SqlCounter(self.__class__._test_engine) as c:
                    old_get_word_tree(db, word_id)
                old_counts[word_id] = c.count
            finally:
                db.close()
        self.assertEqual(counts["big"], counts["small"])
        self.assertLess(counts["big"], old_counts["big"])
