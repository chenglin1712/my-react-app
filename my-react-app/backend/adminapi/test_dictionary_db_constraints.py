"""P4 review BE-21／BE-22：word_source／word_explanation_category／
word_explanation_pos／word_explanation_focus 這四張多對多 junction table
的 (parent_id, term_id) unique constraint，以及 grammar_example_word.word_id
的 FK，是否真的在資料庫層生效——不是只測「應用層的 _sync_id_junction()
會去重」（那份行為已經有 test_dictionary_words.py／test_dictionary_grammar.py
覆蓋），而是直接繞過應用層、用最原始的 SQLAlchemy insert 證明資料庫本身會
拒絕違反這兩個不變量的寫入，就算完全不經過 dictionary_write 那一層。
"""
from sqlalchemy.exc import IntegrityError

from dictionary_db import connect as connect_module
from dictionary_db import model as m

from .dictionary_test_base import DictionaryDbTestCase


class JunctionTableUniqueConstraintTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.tribe_id = self.seed_tribe()
        self.word_id = self.seed_word()

    def test_duplicate_word_source_pair_rejected_by_database(self):
        db = connect_module.SessionLocal()
        try:
            source = m.Source(name="測試來源")
            db.add(source)
            db.flush()
            db.add(m.WordSource(word_id=self.word_id, source_id=source.id, sort_order=0))
            db.commit()

            db.add(m.WordSource(word_id=self.word_id, source_id=source.id, sort_order=1))
            with self.assertRaises(IntegrityError):
                db.commit()
        finally:
            db.rollback()
            db.close()

    def _seed_explanation(self, db):
        explanation = m.WordExplanation(word_id=self.word_id, chinese_explanation="測試釋義")
        db.add(explanation)
        db.flush()
        return explanation.id

    def test_duplicate_word_explanation_category_pair_rejected_by_database(self):
        db = connect_module.SessionLocal()
        try:
            explanation_id = self._seed_explanation(db)
            category = m.Category(name="測試分類")
            db.add(category)
            db.flush()
            db.add(m.WordExplanationCategory(explanation_id=explanation_id, category_id=category.id))
            db.commit()

            db.add(m.WordExplanationCategory(explanation_id=explanation_id, category_id=category.id))
            with self.assertRaises(IntegrityError):
                db.commit()
        finally:
            db.rollback()
            db.close()

    def test_duplicate_word_explanation_pos_pair_rejected_by_database(self):
        db = connect_module.SessionLocal()
        try:
            explanation_id = self._seed_explanation(db)
            pos = m.PartOfSpeech(name="測試詞類")
            db.add(pos)
            db.flush()
            db.add(m.WordExplanationPos(explanation_id=explanation_id, pos_id=pos.id))
            db.commit()

            db.add(m.WordExplanationPos(explanation_id=explanation_id, pos_id=pos.id))
            with self.assertRaises(IntegrityError):
                db.commit()
        finally:
            db.rollback()
            db.close()

    def test_duplicate_word_explanation_focus_pair_rejected_by_database(self):
        db = connect_module.SessionLocal()
        try:
            explanation_id = self._seed_explanation(db)
            focus = m.Focus(name="測試焦點")
            db.add(focus)
            db.flush()
            db.add(m.WordExplanationFocus(explanation_id=explanation_id, focus_id=focus.id))
            db.commit()

            db.add(m.WordExplanationFocus(explanation_id=explanation_id, focus_id=focus.id))
            with self.assertRaises(IntegrityError):
                db.commit()
        finally:
            db.rollback()
            db.close()


class GrammarExampleWordForeignKeyTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.tribe_id = self.seed_tribe()
        self.word_id = self.seed_word()

    def _seed_grammar_example(self, db):
        section = m.GrammarSection(tribe_id=self.tribe_id, section_order=0)
        db.add(section)
        db.flush()
        rule = m.GrammarRule(section_id=section.id, rule_order=0)
        db.add(rule)
        db.flush()
        example = m.GrammarExample(rule_id=rule.id, example_order=0)
        db.add(example)
        db.flush()
        return example.id

    def test_linking_to_nonexistent_word_id_rejected_by_database(self):
        db = connect_module.SessionLocal()
        try:
            example_id = self._seed_grammar_example(db)
            db.add(m.GrammarExampleWord(example_id=example_id, word_id="word-does-not-exist"))
            with self.assertRaises(IntegrityError):
                db.commit()
        finally:
            db.rollback()
            db.close()

    def test_linking_to_existing_word_id_succeeds(self):
        db = connect_module.SessionLocal()
        try:
            example_id = self._seed_grammar_example(db)
            db.add(m.GrammarExampleWord(example_id=example_id, word_id=self.word_id))
            db.commit()

            count = db.query(m.GrammarExampleWord).filter_by(example_id=example_id).count()
            self.assertEqual(count, 1)
        finally:
            db.close()
