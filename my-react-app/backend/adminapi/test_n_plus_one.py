"""O12：後台多處 N+1 查詢改成整批載入。這裡驗證兩件事：
(1) 查詢次數不隨資料筆數增加；(2) 組出來的內容與逐筆查詢時相同。"""
from django.test import TestCase
from sqlalchemy import event

from dictionary_db import connect as connect_module
from dictionary_db import model as m

from . import dictionary_write as dw
from . import review_queue_views as rq
from .dictionary_test_base import DictionaryDbTestCase
from .models import Announcement, PendingRevision, QuizVocabItem


class _SqlCounter:
    """數 SQLAlchemy 這個 engine 實際送出的 SQL 筆數。"""

    def __init__(self, engine):
        self.engine = engine
        self.count = 0

    def _before(self, *args, **kwargs):
        self.count += 1

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._before)
        return self

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._before)


class GrammarSectionTreeQueryCountTest(DictionaryDbTestCase):
    def setUp(self):
        super().setUp()
        self.tribe_id = self.seed_tribe()

    def _seed_section(self, rule_count, examples_per_rule, words_per_example):
        db = connect_module.SessionLocal()
        try:
            words = []
            for i in range(words_per_example):
                db.add(m.Word(id=f"w{i}", tribe_id=self.tribe_id, name=f"word{i}"))
                words.append(f"w{i}")
            affixes = []
            for i in range(3):
                a = m.GrammarAffix(tribe_id=self.tribe_id, affix=f"af{i}-", affix_type="prefix")
                db.add(a)
                affixes.append(a)
            db.flush()
            section = m.GrammarSection(tribe_id=self.tribe_id, section_order=0, title="章節")
            db.add(section)
            db.flush()
            for r in range(rule_count):
                rule = m.GrammarRule(section_id=section.id, rule_order=r, title=f"規則{r}")
                db.add(rule)
                db.flush()
                for a in affixes[: (r % 3) + 1]:
                    db.add(m.GrammarRuleAffix(rule_id=rule.id, affix_id=a.id))
                for e in range(examples_per_rule):
                    ex = m.GrammarExample(rule_id=rule.id, example_order=e, tribe_text=f"r{r}e{e}")
                    db.add(ex)
                    db.flush()
                    for w in words:
                        db.add(m.GrammarExampleWord(example_id=ex.id, word_id=w))
            db.commit()
            return section.id
        finally:
            db.close()

    def _tree(self, section_id):
        db = connect_module.SessionLocal()
        try:
            with _SqlCounter(self.__class__._test_engine) as counter:
                tree = dw.get_grammar_section_tree(db, section_id)
            return tree, counter.count
        finally:
            db.close()

    def test_query_count_does_not_grow_with_rules_examples_or_linked_words(self):
        small_id = self._seed_section(rule_count=1, examples_per_rule=1, words_per_example=1)
        _, small = self._tree(small_id)
        # 另一個章節：3 條規則、每條 4 個例句、每個例句連 5 個詞
        big_id = self._seed_section_again(rule_count=3, examples_per_rule=4, words_per_example=5)
        _, big = self._tree(big_id)
        self.assertEqual(big, small)       # 舊寫法：1 + 1 + 規則數 × (2 + 例句數 × 2) 次，會大很多
        self.assertLessEqual(big, 8)

    def _seed_section_again(self, rule_count, examples_per_rule, words_per_example):
        db = connect_module.SessionLocal()
        try:
            for i in range(words_per_example):
                if not db.query(m.Word.id).filter(m.Word.id == f"w{i}").first():
                    db.add(m.Word(id=f"w{i}", tribe_id=self.tribe_id, name=f"word{i}"))
            db.commit()
        finally:
            db.close()
        return self._seed_section_only(rule_count, examples_per_rule, words_per_example)

    def _seed_section_only(self, rule_count, examples_per_rule, words_per_example):
        db = connect_module.SessionLocal()
        try:
            affix_ids = [a.id for a in db.query(m.GrammarAffix).all()]
            section = m.GrammarSection(tribe_id=self.tribe_id, section_order=1, title="大章節")
            db.add(section)
            db.flush()
            for r in range(rule_count):
                rule = m.GrammarRule(section_id=section.id, rule_order=r, title=f"規則{r}")
                db.add(rule)
                db.flush()
                for a_id in affix_ids[: (r % 3) + 1]:
                    db.add(m.GrammarRuleAffix(rule_id=rule.id, affix_id=a_id))
                for e in range(examples_per_rule):
                    ex = m.GrammarExample(rule_id=rule.id, example_order=e, tribe_text=f"r{r}e{e}")
                    db.add(ex)
                    db.flush()
                    for i in range(words_per_example):
                        db.add(m.GrammarExampleWord(example_id=ex.id, word_id=f"w{i}"))
            db.commit()
            return section.id
        finally:
            db.close()

    def test_tree_content_is_grouped_by_the_right_rule_and_example_in_order(self):
        section_id = self._seed_section(rule_count=3, examples_per_rule=2, words_per_example=2)
        tree, _ = self._tree(section_id)
        self.assertEqual([r["title"] for r in tree["rules"]], ["規則0", "規則1", "規則2"])
        self.assertEqual([len(r["affix_ids"]) for r in tree["rules"]], [1, 2, 3])
        for r, rule in enumerate(tree["rules"]):
            self.assertEqual([e["tribe_text"] for e in rule["examples"]], [f"r{r}e0", f"r{r}e1"])
            for example in rule["examples"]:
                self.assertEqual(sorted(w["word_name"] for w in example["linked_words"]), ["word0", "word1"])

    def test_chunked_in_queries_give_the_same_tree(self):
        from unittest import mock
        from .dictionary_write import tree_reader
        section_id = self._seed_section(rule_count=3, examples_per_rule=3, words_per_example=3)
        whole, _ = self._tree(section_id)
        with mock.patch.object(tree_reader, "_IN_CHUNK", 2):
            chunked, _ = self._tree(section_id)
        self.assertEqual(chunked, whole)

    def test_section_without_rules_still_works(self):
        db = connect_module.SessionLocal()
        try:
            section = m.GrammarSection(tribe_id=self.tribe_id, section_order=0, title="空章節")
            db.add(section)
            db.commit()
            sid = section.id
        finally:
            db.close()
        tree, count = self._tree(sid)
        self.assertEqual(tree["rules"], [])
        self.assertLessEqual(count, 2)


class ReviewQueueRevisionQueryCountTest(TestCase):
    def test_pending_revisions_load_each_content_type_with_one_query(self):
        announcements = [Announcement.objects.create(title=f"公告{i}", created_by="u", status=Announcement.STATUS_PUBLISHED)
                         for i in range(6)]
        vocab = [QuizVocabItem.objects.create(tribe="tayal", category="noun", foreign_word=f"w{i}", chinese_gloss=f"g{i}",
                                              created_by="u", status=QuizVocabItem.STATUS_PUBLISHED) for i in range(4)]
        for a in announcements:
            PendingRevision.objects.create(target_type="announcement", target_id=a.pk, payload={}, submitted_by="u")
        for v in vocab:
            PendingRevision.objects.create(target_type="quiz_vocab_item", target_id=v.pk, payload={}, submitted_by="u")
        PendingRevision.objects.create(target_type="announcement", target_id=999999, payload={}, submitted_by="u")  # 原始內容已刪除

        # 1 次取修訂 + 2 種內容類型各 1 次；舊寫法是 1 + 11 次
        with self.assertNumQueries(3):
            items = rq._collect_revisions()

        self.assertEqual(len(items), 11)
        titles = {i["title"] for i in items}
        self.assertIn("公告0", titles)
        self.assertTrue(any("原始內容已刪除" in t for t in titles))
        self.assertEqual(sum(1 for i in items if i["content_type"] == "quiz_vocab_item"), 4)
