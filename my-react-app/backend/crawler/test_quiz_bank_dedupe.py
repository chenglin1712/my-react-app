"""E7：中高級配合題抽樣時，同一次測驗裡同拼寫或同中文詞義的詞彙不能重複入選。
舊版 sample_matching_vocab 有這層保護，搬進資料庫（_pick_matching_vocab_from_db）時漏掉了。"""
import random
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from crawler import quiz_bank


def _item(pk, word, gloss):
    return SimpleNamespace(id=pk, foreign_word=word, chinese_gloss=gloss)


class MatchingVocabDedupeTest(SimpleTestCase):
    def _pick(self, pools, seed=1):
        random.seed(seed)
        with patch.object(quiz_bank, "get_published_vocab_items", side_effect=lambda tribe, category: pools.get(category, [])):
            return quiz_bank._pick_matching_vocab_from_db("tayal")

    def test_same_spelling_or_same_gloss_never_appears_twice(self):
        pools = {
            "noun": [_item(1, "su", "你"), _item(2, "su ", "你的"), _item(3, "SU", "您"),   # 同拼寫（空白、大小寫不同）
                     _item(4, "mami", "媽媽"), _item(5, "yaya", "媽媽"),                   # 同中文詞義
                     _item(6, "baki", "爺爺"), _item(7, "laqi", "孩子"), _item(8, "utux", "祖靈"),
                     _item(9, "hola", "房子"), _item(10, "wawa", "小孩子")],
            "verb": [_item(11, "su", "跑")],   # 跨類別的同拼寫也要擋
        }
        for seed in range(30):
            picked = self._pick(pools, seed)
            words = [quiz_bank._dedupe_key(i.foreign_word) for i in picked]
            glosses = [quiz_bank._dedupe_key(i.chinese_gloss) for i in picked]
            self.assertEqual(len(words), len(set(words)), f"seed={seed}")
            self.assertEqual(len(glosses), len(set(glosses)), f"seed={seed}")

    def test_duplicates_are_skipped_and_the_quota_is_refilled_from_the_rest_of_the_pool(self):
        # noun 配額 8：池子裡有 10 筆、其中 2 筆是重複，仍要湊滿 8 筆。
        pool = [_item(i, f"w{i}", f"g{i}") for i in range(8)]
        pool += [_item(100, "w0", "dup-word"), _item(101, "dupgloss", "g1")]
        for seed in range(20):
            picked = self._pick({"noun": pool}, seed)
            self.assertEqual(len(picked), 8, f"seed={seed}")
            self.assertEqual(len({quiz_bank._dedupe_key(i.foreign_word) for i in picked}), 8)
            self.assertEqual(len({quiz_bank._dedupe_key(i.chinese_gloss) for i in picked}), 8)

    def test_pool_smaller_than_quota_after_dedupe_just_returns_fewer_items(self):
        # (a,x) (a,y) (b,x)：互相衝突，最多只能選 2 筆（例如 (a,x) 與 (b,x) 衝突，(a,y) 與 (b,x) 可並存）。
        pool = [_item(1, "a", "x"), _item(2, "a", "y"), _item(3, "b", "x")]
        for seed in range(20):
            picked = self._pick({"noun": pool}, seed)
            self.assertLessEqual(len(picked), 2)
            self.assertGreaterEqual(len(picked), 1)

    def test_blank_values_do_not_block_each_other(self):
        pool = [_item(1, "a", ""), _item(2, "b", "")]
        self.assertEqual(len(self._pick({"noun": pool})), 2)
