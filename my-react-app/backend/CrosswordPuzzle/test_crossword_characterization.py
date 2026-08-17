"""P4 review BE-26 的安全網：在拆分 display／legend／word_bank 這些序列化
方法、以及加入可注入的 RNG 之前，先用固定亂數種子把「目前」的實際輸出鎖住
（characterization test）。拆分完成後這份測試必須原封不動繼續通過，證明
純粹是搬程式碼位置／改內部怎麼取亂數，選字與排版演算法本身的行為完全沒變。
"""
import random

from django.test import SimpleTestCase

from CrosswordPuzzle.crossword import Crossword, word_list


class CrosswordDeterministicOutputTest(SimpleTestCase):
    def _build(self):
        random.seed(12345)
        crossword = Crossword(13, 13, "-", 5000, word_list)
        crossword.compute_crossword(time_permitted=0.3)
        crossword.order_number_words()
        return crossword

    def test_placement_count_and_solution_are_deterministic_for_fixed_seed(self):
        crossword = self._build()
        self.assertEqual(len(crossword.current_word_list), 11)
        self.assertEqual(
            crossword.solution(),
            "i - k a w c i y a - - - - \n"
            "y - - - - - - - p - - - - \n"
            "a - - - k i n g a h u l - \n"
            "n - k - b - - - h - - - - \n"
            "g - i - a - - - - i - - - \n"
            "h o n g w a y s e n - - - \n"
            "w - s - l - - - - t - - - \n"
            "a - r - u - l l y u n g - \n"
            "t - u - n - - - - y - - - \n"
            "a - y - g - k a g a n g - \n"
            "n - u - - - - - - n - - - \n"
            "- - n - m k s i n g u t - \n"
            "- - - - - - - - - - - - - \n",
        )

    def test_display_matches_locked_snapshot(self):
        crossword = self._build()
        self.assertEqual(
            crossword.display(),
            [
                "1-2     6----",
                " ------- ----",
                " ---5       -",
                " -4- --- ----",
                " - - ----7---",
                "3         ---",
                " - - ---- ---",
                " - - -8     -",
                " - - ---- ---",
                " - - -10     -",
                " - ------ ---",
                "-- -9       -",
                "-------------",
            ],
        )

    def test_word_bank_and_legend_line_counts_match_locked_snapshot(self):
        crossword = self._build()
        self.assertEqual(len(crossword.word_bank().splitlines()), 11)
        self.assertEqual(len(crossword.legend().splitlines()), 11)
