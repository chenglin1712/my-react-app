"""Crossword.__init__ 的 available_words 引數（P4 review BE-25）：原本預設值
是 available_words=[]，是 Python 眾所皆知的危險介面——預設的 list 物件在
函式定義當下就建立一次，之後每個沒有明確傳入 available_words 的呼叫都會
共用同一個物件；如果任何程式碼路徑對它做了原地修改（例如 .append()），
會悄悄污染下一個沒有明確傳入引數的 Crossword instance。目前唯一的呼叫點
（CrosswordPuzzle/views.py）永遠明確傳入 available_words，所以還沒有實際
發生過污染，但這裡直接測這個介面本身的安全性，不依賴呼叫端有沒有踩到雷。
"""
from django.test import SimpleTestCase

from CrosswordPuzzle.crossword import Crossword


class CrosswordDefaultAvailableWordsTest(SimpleTestCase):
    def test_two_default_constructed_instances_do_not_share_word_list(self):
        first = Crossword(5, 5)
        second = Crossword(5, 5)
        self.assertIsNot(first.available_words, second.available_words)

    def test_default_constructed_instance_starts_with_no_words(self):
        crossword = Crossword(5, 5)
        self.assertEqual(crossword.available_words, [])

    def test_mutating_one_instances_word_list_does_not_affect_another(self):
        first = Crossword(5, 5)
        second = Crossword(5, 5)
        first.available_words.append(("test", "測試"))
        self.assertEqual(second.available_words, [])

    def test_explicit_word_list_is_still_honored(self):
        crossword = Crossword(5, 5, available_words=[("apple", "蘋果")])
        self.assertEqual(len(crossword.available_words), 1)
        self.assertEqual(crossword.available_words[0].word, "apple")
