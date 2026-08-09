"""migrate_quiz_bank_to_db 管理指令的 _create_if_valid() 輔助方法測試。

獨立審查找到的問題：這個指令原本直接用 QuizVocabItem.objects.get_or_create()／
QuizClozePassage.objects.get_or_create() 寫入，get_or_create() 不會呼叫
full_clean()，畸形資料（尤其是 QuizClozePassage 的標記一致性）能直接繞過
驗證進資料庫。這裡測試改寫後的 _create_if_valid()：驗證失敗要略過（不建立、
不中斷整批遷移），合法資料要正常建立，且維持原本的冪等語意（已存在就跳過）。
"""
from django.test import TestCase

from .management.commands.migrate_quiz_bank_to_db import Command
from .models import QuizClozePassage, QuizVocabItem


class CreateIfValidTest(TestCase):
    def setUp(self):
        self.command = Command()

    def test_valid_cloze_passage_is_created(self):
        created, invalid = self.command._create_if_valid(
            QuizClozePassage,
            {"tribe": "tayal", "passage_foreign": "Lokah su? {blank1}"},
            {
                "passage_chinese": "你好嗎？",
                "blanks": {"blank1": {"options": ["a", "b", "c", "d"], "answer": 1}},
                "status": QuizClozePassage.STATUS_PENDING_REVIEW,
                "created_by": "system:migration",
            },
        )
        self.assertTrue(created)
        self.assertFalse(invalid)
        self.assertEqual(QuizClozePassage.objects.count(), 1)

    def test_cloze_passage_with_mismatched_marker_is_skipped_not_created(self):
        """短文裡的標記跟 blanks 的 key 對不上（拼錯字）——修正前這種資料
        會被 get_or_create() 直接寫進 DB，出題時洩漏原始標記文字給學生。"""
        created, invalid = self.command._create_if_valid(
            QuizClozePassage,
            {"tribe": "tayal", "passage_foreign": "Lokah su? {blnak1}"},
            {
                "passage_chinese": "你好嗎？",
                "blanks": {"blank1": {"options": ["a", "b", "c", "d"], "answer": 1}},
                "status": QuizClozePassage.STATUS_PENDING_REVIEW,
                "created_by": "system:migration",
            },
        )
        self.assertFalse(created)
        self.assertTrue(invalid)
        self.assertEqual(QuizClozePassage.objects.count(), 0)

    def test_cloze_passage_with_duplicate_marker_is_skipped(self):
        created, invalid = self.command._create_if_valid(
            QuizClozePassage,
            {"tribe": "tayal", "passage_foreign": "{blank1} su {blank1}?"},
            {
                "passage_chinese": "你好嗎？",
                "blanks": {"blank1": {"options": ["a", "b", "c", "d"], "answer": 1}},
                "status": QuizClozePassage.STATUS_PENDING_REVIEW,
                "created_by": "system:migration",
            },
        )
        self.assertFalse(created)
        self.assertTrue(invalid)

    def test_existing_lookup_is_skipped_without_touching_full_clean(self):
        """冪等語意：lookup 已存在就直接跳過（既有的『新增 vs 略過已存在』
        計數要照舊，不能因為改寫成手動驗證流程而破壞冪等性）。"""
        QuizVocabItem.objects.create(
            tribe="tayal", category="noun", foreign_word="huzil", chinese_gloss="狗",
            status=QuizVocabItem.STATUS_PENDING_REVIEW, created_by="system:migration",
        )
        created, invalid = self.command._create_if_valid(
            QuizVocabItem,
            {"tribe": "tayal", "foreign_word": "huzil", "chinese_gloss": "狗"},
            {
                "category": "noun",
                "status": QuizVocabItem.STATUS_PENDING_REVIEW,
                "created_by": "system:migration",
            },
        )
        self.assertFalse(created)
        self.assertFalse(invalid)
        self.assertEqual(QuizVocabItem.objects.count(), 1)

    def test_invalid_category_choice_is_skipped_not_created(self):
        created, invalid = self.command._create_if_valid(
            QuizVocabItem,
            {"tribe": "tayal", "foreign_word": "huzil", "chinese_gloss": "狗"},
            {
                "category": "not-a-real-category",
                "status": QuizVocabItem.STATUS_PENDING_REVIEW,
                "created_by": "system:migration",
            },
        )
        self.assertFalse(created)
        self.assertTrue(invalid)
        self.assertEqual(QuizVocabItem.objects.count(), 0)
