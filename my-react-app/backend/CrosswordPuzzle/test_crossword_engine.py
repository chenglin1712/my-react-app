"""Crossword.__init__ 的 available_words 引數（P4 review BE-25）：原本預設值
是 available_words=[]，是 Python 眾所皆知的危險介面——預設的 list 物件在
函式定義當下就建立一次，之後每個沒有明確傳入 available_words 的呼叫都會
共用同一個物件；如果任何程式碼路徑對它做了原地修改（例如 .append()），
會悄悄污染下一個沒有明確傳入引數的 Crossword instance。目前唯一的呼叫點
（CrosswordPuzzle/views.py）永遠明確傳入 available_words，所以還沒有實際
發生過污染，但這裡直接測這個介面本身的安全性，不依賴呼叫端有沒有踩到雷。
"""
from django.test import SimpleTestCase

from CrosswordPuzzle.crossword import Crossword, Word


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


class CrosswordBoundaryTest(SimpleTestCase):
    """E2：座標是 1-based，盤面外（含座標 0／負數）不能被當成「有字」，
    也不能因為 Python 負索引而讀到對面那一側的格子。"""

    def _board(self, cols=5, rows=5):
        return Crossword(cols, rows, "-", 10, [])

    def test_get_cell_outside_the_grid_raises_index_error_in_every_direction(self):
        board = self._board()
        for col, row in [(0, 1), (1, 0), (-1, 3), (3, -1), (6, 1), (1, 6)]:
            with self.subTest(col=col, row=row):
                with self.assertRaises(IndexError):
                    board.get_cell(col, row)

    def test_zero_coordinate_does_not_read_the_opposite_edge(self):
        board = self._board()
        board.set_cell(5, 3, "x")  # 第 5 欄、第 3 列：座標 0 舊寫法會誤讀到這一格
        self.assertTrue(board.check_if_cell_clear(0, 3))

    def test_cells_outside_the_grid_count_as_clear_neighbours(self):
        board = self._board()
        for col, row in [(0, 1), (6, 1), (1, 0), (1, 6)]:
            with self.subTest(col=col, row=row):
                self.assertTrue(board.check_if_cell_clear(col, row))

    def test_occupied_cell_inside_the_grid_is_not_clear(self):
        board = self._board()
        board.set_cell(2, 2, "x")
        self.assertFalse(board.check_if_cell_clear(2, 2))

    def test_words_flush_against_every_edge_can_be_placed(self):
        board = self._board()
        self.assertGreaterEqual(board.check_fit_score(1, 1, False, Word("abcde", "")), 1)  # 剛好填滿一列
        self.assertGreaterEqual(board.check_fit_score(2, 3, False, Word("abcd", "")), 1)   # 貼右邊
        self.assertGreaterEqual(board.check_fit_score(3, 2, True, Word("abcd", "")), 1)    # 貼底
        self.assertGreaterEqual(board.check_fit_score(1, 1, True, Word("abcde", "")), 1)   # 剛好填滿一欄

    def test_word_that_sticks_out_of_the_grid_still_scores_zero(self):
        board = self._board()
        self.assertEqual(board.check_fit_score(2, 1, False, Word("abcde", "")), 0)  # 右邊超出
        self.assertEqual(board.check_fit_score(1, 2, True, Word("abcde", "")), 0)   # 下面超出
        self.assertEqual(board.check_fit_score(0, 1, False, Word("abc", "")), 0)
        self.assertEqual(board.check_fit_score(1, 0, True, Word("abc", "")), 0)
        self.assertEqual(board.check_fit_score(1, 1, False, Word("abcdef", "")), 0)  # 比盤面還長


class CrosswordNumberingTest(SimpleTestCase):
    """E3：題號依「由上而下、由左而右」，起點相同的橫、直兩個字共用同一個題號。"""

    def _placed(self, text, col, row, vertical):
        word = Word(text, "")
        word.col, word.row, word.vertical = col, row, vertical
        return word

    def _numbered(self, words):
        board = Crossword(13, 13, "-", 10, [])
        board.current_word_list = list(words)
        board.order_number_words()
        return board.current_word_list

    def test_words_sharing_a_start_cell_share_a_number_even_if_listed_apart(self):
        aaa = self._placed("aaa", 1, 3, False)
        bbb = self._placed("bbb", 3, 1, False)
        ccc = self._placed("ccc", 1, 3, True)
        ordered = self._numbered([aaa, bbb, ccc])
        self.assertEqual(aaa.number, ccc.number)
        self.assertNotEqual(aaa.number, bbb.number)
        self.assertEqual(len(ordered), 3)

    def test_numbers_follow_reading_order_row_first_then_column(self):
        first = self._placed("one", 9, 1, False)    # 第 1 列最右
        second = self._placed("two", 1, 1, False)   # 第 1 列最左
        third = self._placed("three", 1, 2, False)  # 第 2 列
        self._numbered([first, second, third])
        self.assertEqual((second.number, first.number, third.number), (1, 2, 3))

    def test_diagonal_neighbours_are_not_mistaken_for_the_same_start(self):
        # col+row 相同但起點不同：(2,1)、(1,2)，舊的排序鍵會把它們視為同一等級。
        a = self._placed("aa", 2, 1, False)
        b = self._placed("bb", 1, 2, False)
        self._numbered([b, a])
        self.assertEqual((a.number, b.number), (1, 2))


class CrosswordForcedPlacementTest(SimpleTestCase):
    """set_word(force=True) 自己也要保證不寫出盤面，且失敗時不留下半成品。"""

    def _board(self):
        return Crossword(5, 5, "-", 10, [])

    def test_word_that_does_not_fit_is_rejected_without_touching_the_board(self):
        board = self._board()
        for col, row, vertical, text in [
            (3, 1, False, "abcde"),   # 右邊超出
            (1, 3, True, "abcde"),    # 下面超出
            (0, 1, False, "abc"),     # 座標 0
            (1, -1, True, "abc"),     # 負座標
            (1, 1, False, "abcdef"),  # 比盤面長
        ]:
            with self.subTest(col=col, row=row, vertical=vertical):
                with self.assertRaises(IndexError):
                    board.set_word(col, row, vertical, Word(text, ""), force=True)
        self.assertEqual(board.current_word_list, [])
        self.assertTrue(all(cell == "-" for line in board.grid for cell in line))

    def test_word_flush_with_the_edges_is_accepted(self):
        board = self._board()
        board.set_word(1, 5, False, Word("abcde", ""), force=True)  # 整列貼底
        board.set_word(5, 1, True, Word("vwxyz", ""), force=True)   # 整欄貼右（與上一個字交叉在 (5,5)）
        self.assertEqual(len(board.current_word_list), 2)
        self.assertEqual(board.get_cell(1, 5), "a")
        self.assertEqual(board.get_cell(5, 1), "v")

    def test_set_cell_rejects_coordinates_that_would_wrap_around(self):
        board = self._board()
        for col, row in [(0, 1), (1, 0), (-1, 1), (6, 1), (1, 6)]:
            with self.subTest(col=col, row=row):
                with self.assertRaises(IndexError):
                    board.set_cell(col, row, "x")
