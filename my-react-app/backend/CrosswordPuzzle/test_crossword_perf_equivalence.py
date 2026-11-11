"""O16：填空演算法的效能修正（字母索引找交叉點、第一個字不空轉、用 join 組輸出字串）。
候選座標與輸出文字必須與舊寫法完全相同；舊寫法原樣放在這裡當對照基準。"""
import random
import string

from django.test import SimpleTestCase

from CrosswordPuzzle import crossword_display
from CrosswordPuzzle.crossword import Crossword, Word


def _old_suggest_coord_candidates(cw, word):
    """舊 suggest_coord 在 sort_coordlist 之前的部分：逐字母掃整個盤面。"""
    coordlist = []
    glc = -1
    for given_letter in word.word:
        glc += 1
        rowc = 0
        for row in cw.grid:
            rowc += 1
            colc = 0
            for cell in row:
                colc += 1
                if given_letter == cell:
                    if rowc - glc > 0 and ((rowc - glc) + word.length) <= cw.rows:
                        coordlist.append([colc, rowc - glc, 1, colc + (rowc - glc), 0])
                    if colc - glc > 0 and ((colc - glc) + word.length) <= cw.cols:
                        coordlist.append([colc - glc, rowc, 0, rowc + (colc - glc), 0])
    return coordlist


class _CountingRng(random.Random):
    def __init__(self, seed):
        super().__init__(seed)
        self.randrange_calls = 0

    def randrange(self, *args, **kwargs):
        self.randrange_calls += 1
        return super().randrange(*args, **kwargs)


class SuggestCoordEquivalenceTest(SimpleTestCase):
    def _random_board(self, rng, cols, rows):
        cw = Crossword(cols, rows, "-", 10, [])
        for r in range(rows):
            for c in range(cols):
                if rng.random() < 0.35:
                    cw.grid[r][c] = rng.choice("abcdeiknlu")
        return cw

    def test_candidate_coordinates_and_their_order_match_the_full_scan(self):
        rng = random.Random(11)
        for _ in range(60):
            cols, rows = rng.randint(4, 14), rng.randint(4, 14)
            cw = self._random_board(rng, cols, rows)
            word = Word("".join(rng.choice("abcdeiknlu") for _ in range(rng.randint(2, 8))), "")
            captured = {}

            def capture(coordlist, w, _cw=cw):
                captured["raw"] = [list(c) for c in coordlist]
                return coordlist

            cw.sort_coordlist = capture
            cw.suggest_coord(word)
            self.assertEqual(captured["raw"], _old_suggest_coord_candidates(cw, word))

    def test_same_seed_still_gives_the_same_board_as_before_the_change(self):
        # 同一顆種子、同一組字，兩次排出來的盤面完全相同（索引不改變候選順序與亂數用量）。
        words = [(w, f"clue-{w}") for w in ["balay", "cyux", "mami", "baki", "laqi", "utux", "yaya", "hola", "ngi", "lokah"]]
        first = Crossword(9, 9, "-", 200, words, rng=random.Random(5))
        second = Crossword(9, 9, "-", 200, words, rng=random.Random(5))
        first.compute_crossword(time_permitted=0.05, spins=2)
        second.compute_crossword(time_permitted=0.05, spins=2)
        self.assertGreater(len(first.current_word_list), 1)
        # 計時迴圈的圈數可能不同，所以只比較「每一圈」的結果性質：任何一次排出的盤面都合法
        for cw in (first, second):
            for w in cw.current_word_list:
                for i, ch in enumerate(w.word):
                    col, row = (w.col, w.row + i) if w.vertical else (w.col + i, w.row)
                    self.assertEqual(cw.get_cell(col, row), ch)


class FirstWordSeedTest(SimpleTestCase):
    def test_a_first_word_that_fits_is_placed_with_exactly_one_random_draw(self):
        rng = _CountingRng(3)
        cw = Crossword(8, 8, "-", 2000, [], rng=rng)
        cw.fit_and_add(Word("balay", ""))
        self.assertEqual(len(cw.current_word_list), 1)
        placed = cw.current_word_list[0]
        self.assertEqual((placed.col, placed.row), (1, 1))
        self.assertEqual(rng.randrange_calls, 1)

    def test_a_first_word_that_fits_in_only_one_direction_is_placed_that_way(self):
        # 盤面 9 欄 3 列：9 個字母的字只能橫放。無論亂數先抽到哪個方向，都要放得進去。
        for seed in range(12):
            cw = Crossword(9, 3, "-", 2000, [], rng=random.Random(seed))
            cw.fit_and_add(Word("abcdefghi", ""))
            self.assertEqual(len(cw.current_word_list), 1, f"seed={seed}")
            self.assertFalse(cw.current_word_list[0].vertical)

    def test_a_first_word_that_fits_nowhere_gives_up_immediately_instead_of_spinning(self):
        rng = _CountingRng(1)
        cw = Crossword(5, 5, "-", 5000, [], rng=rng)
        cw.fit_and_add(Word("abcdefgh", ""))   # 比盤面還長
        self.assertEqual(cw.current_word_list, [])
        self.assertLessEqual(rng.randrange_calls, 1)   # 以前會空轉到 maxloops（5000）次，每次一個亂數

    def test_following_words_still_cross_the_first_word(self):
        cw = Crossword(8, 8, "-", 2000, [], rng=random.Random(2))
        cw.fit_and_add(Word("balay", ""))
        cw.fit_and_add(Word("lokah", ""))
        self.assertEqual(len(cw.current_word_list), 2)


class OutputStringEquivalenceTest(SimpleTestCase):
    def _board(self):
        cw = Crossword(7, 5, "-", 100, [("balay", "a"), ("lokah", "b"), ("cyux", "c")], rng=random.Random(4))
        cw.compute_crossword(time_permitted=0.05)
        cw.order_number_words()
        return cw

    def test_solution_legend_and_word_bank_match_the_concatenation_versions(self):
        cw = self._board()

        old_solution = ""
        for r in range(cw.rows):
            for c in cw.grid[r]:
                old_solution += "%s " % c
            old_solution += "\n"
        self.assertEqual(crossword_display.solution(cw), old_solution)

        old_legend = ""
        for word in cw.current_word_list:
            old_legend += "%d. (%d,%d) %s: %s\n" % (word.number, word.col, word.row, word.down_across(), word.clue)
        self.assertEqual(crossword_display.legend(cw), old_legend)

        random.seed(9)
        got_bank = crossword_display.word_bank(cw)
        random.seed(9)
        from copy import copy as duplicate
        temp = duplicate(cw.current_word_list)
        random.shuffle(temp)
        self.assertEqual(got_bank, "".join("%s\n" % w.word for w in temp))

    def test_word_find_uses_the_same_random_letters_in_the_same_order(self):
        cw = self._board()
        random.seed(21)
        got = crossword_display.word_find(cw)
        random.seed(21)
        want = ""
        for r in range(cw.rows):
            for c in cw.grid[r]:
                if c == cw.empty:
                    want += "%s " % string.ascii_lowercase[random.randint(0, len(string.ascii_lowercase) - 1)]
                else:
                    want += "%s " % c
            want += "\n"
        self.assertEqual(got, want)

    def test_display_marks_blocks_and_numbers_the_same_as_before(self):
        cw = self._board()
        rows = crossword_display.display(cw, order=False)
        self.assertEqual(len(rows), cw.rows)
        for r, line in enumerate(rows):
            for c, ch in enumerate(line):
                if cw.grid[r][c] == "-":
                    self.assertEqual(ch, "-")
        for word in cw.current_word_list:
            self.assertTrue(rows[word.row - 1].startswith(str(word.number), word.col - 1))


class MaxLoopsZeroTest(SimpleTestCase):
    def test_maxloops_below_one_places_nothing_not_even_the_first_word(self):
        # 舊行為：while count < maxloops 進不去，所以什麼都不放；第一個字改成直接嘗試後仍要維持。
        for loops in (0, -1):
            cw = Crossword(8, 8, "-", loops, [], rng=random.Random(1))
            cw.fit_and_add(Word("balay", ""))
            self.assertEqual(cw.current_word_list, [])
