# vi: set ft=python sts=4 ts=4 sw=4 et:

import random
import re
import time

from CrosswordPuzzle import crossword_display


class Crossword(object):
    def __init__(self, cols, rows, empty='-', maxloops=2000, available_words=None, rng=None):
        """rng：排字演算法（randomize_word_list／sort_coordlist／fit_and_add
        用到的 random.shuffle／random.randrange）要用的亂數來源，預設是
        random 模組本身（跟原本沒有這個參數時的行為完全一樣——都是共用
        process 全域的亂數狀態）。傳入 random.Random(seed) 這種獨立實例可以
        讓同一組候選字在同一顆種子下每次都排出同一個結果，方便幫排字演算法
        寫可重現的測試（P4 review BE-26），不需要真的固定 process 全域的
        random 狀態去影響到程式裡其他無關的地方。"""
        self.cols = cols
        self.rows = rows
        self.empty = empty
        self.maxloops = maxloops
        self.available_words = list(available_words) if available_words else []
        self._rng = rng if rng is not None else random
        self.randomize_word_list()
        self.current_word_list = []
        self.clear_grid()
        self.debug = 0

    def clear_grid(self):
        """Initialize grid and fill with empty character."""
        self.grid = []
        for i in range(self.rows):
            ea_row = []
            for j in range(self.cols):
                ea_row.append(self.empty)
            self.grid.append(ea_row)

    def randomize_word_list(self):
        """Reset words and sort by length."""
        temp_list = []
        for word in self.available_words:
            if isinstance(word, Word):
                temp_list.append(Word(word.word, word.clue))
            else:
                temp_list.append(Word(word[0], word[1]))
        # randomize word list
        self._rng.shuffle(temp_list)
        # sort by length
        temp_list.sort(key=lambda i: len(i.word), reverse=True)
        self.available_words = temp_list

    def compute_crossword(self, time_permitted=1.00, spins=2, max_rounds=None):
        """隨機重開搜尋，保留放進最多字的盤面。預設跑 time_permitted 秒（正式環境的行為）；
        給 max_rounds 時改成固定跑這麼多輪、忽略時間——結果只由亂數種子決定，與機器快慢無關（測試用）。"""
        copy = Crossword(self.cols, self.rows, self.empty,
                         self.maxloops, self.available_words, rng=self._rng)

        count = 0
        time_permitted = float(time_permitted)
        start_full = float(time.time())

        # only run for x seconds
        while (count < max_rounds) if max_rounds is not None else ((float(time.time()) - start_full) < time_permitted or count == 0):
            self.debug += 1
            copy.randomize_word_list()
            copy.current_word_list = []
            copy.clear_grid()

            x = 0
            placed = set()  # 已放進盤面的字（用物件 id；只有 fit_and_add 會把這個字放進 current_word_list）
            # spins; 2 seems to be plenty
            while x < spins:
                for word in copy.available_words:
                    if id(word) not in placed:
                        before = len(copy.current_word_list)
                        copy.fit_and_add(word)
                        if len(copy.current_word_list) > before:
                            placed.add(id(word))
                x += 1
            #print(copy.solution())
            #print(len(copy.current_word_list), len(self.current_word_list), self.debug)
            # buffer the best crossword by comparing placed words
            if len(copy.current_word_list) > len(self.current_word_list):
                self.current_word_list = copy.current_word_list
                self.grid = copy.grid
            count += 1
        return

    def suggest_coord(self, word):
        #count = 0
        coordlist = []
        glc = -1

        # 字母 -> 它在盤面上的位置們（列優先、由上而下由左而右）。盤面只掃一次，
        # 而不是每個字母各掃一遍整個盤面；候選座標加入的順序與原本逐字母掃描完全相同
        # （先依單字的字母順序，同一個字母再依盤面位置順序），後面的亂數與排序結果不變。
        positions = {}
        for rowc, row in enumerate(self.grid, start=1):
            for colc, cell in enumerate(row, start=1):
                if cell != self.empty:
                    positions.setdefault(cell, []).append((colc, rowc))

        # cycle through letters in word
        for given_letter in word.word:
            glc += 1
            # 盤面上有這個字母的每個位置
            for colc, rowc in positions.get(given_letter, ()):
                # suggest vertical placement
                # make sure we're not suggesting a starting point off the grid
                if rowc - glc > 0:
                    # make sure word doesn't go off of grid
                    if ((rowc - glc) + word.length) <= self.rows:
                        coordlist.append([colc, rowc-glc, 1, colc+(rowc-glc),0])

                # suggest horizontal placement
                # make sure we're not suggesting a starting point off the grid
                if colc - glc > 0:
                    # make sure word doesn't go off of grid
                    if ((colc - glc) + word.length) <= self.cols:
                        coordlist.append([colc-glc, rowc, 0, rowc+(colc-glc),0])

        # example: coordlist[0] = [col, row, vertical, col + row, score]
        #print(word.word)
        #print(coordlist)
        new_coordlist = self.sort_coordlist(coordlist, word)
        #print(new_coordlist)

        return new_coordlist

    def sort_coordlist(self, coordlist, word):
        """Give each coordinate a score, then sort."""
        new_coordlist = []
        for coord in coordlist:
            col, row, vertical = coord[0], coord[1], coord[2]
            # checking scores
            coord[4] = self.check_fit_score(col, row, vertical, word)
            # 0 scores are filtered
            if coord[4]:
                new_coordlist.append(coord)
        # randomize coord list; why not?
        self._rng.shuffle(new_coordlist)
        # put the best scores first
        new_coordlist.sort(key=lambda i: i[4], reverse=True)
        return new_coordlist

    def fit_and_add(self, word):
        """Doesn't really check fit except for the first word;
        otherwise just adds if score is good.
        """
        # maxloops 是嘗試次數的上限；< 1 代表一次都不試（原本的 while 迴圈進不去），第一個字也一樣。
        if self.maxloops < 1:
            return

        fit = False
        count = 0
        coordlist = self.suggest_coord(word)

        # 第一個字（種子）固定從左上角出發、只有「橫」「直」兩種放法：先試隨機選到的方向，
        # 不行再試另一個，兩個都放不下就直接放棄（以前會在這裡空轉到 maxloops 次，每次都是
        # 同樣的兩種答案）。第一次抽到的方向就放得下時，行為與亂數用量跟原本完全相同。
        if len(self.current_word_list) == 0:
            first_direction = self._rng.randrange(0, 2)
            for vertical in (first_direction, 1 - first_direction):
                if self.check_fit_score(1, 1, vertical, word):
                    self.set_word(1, 1, vertical, word, force=True)
                    break
            return

        # 第二個字起：依分數排好的候選座標，由最好的開始試，第一個可放的就放。
        # （原本在這個迴圈裡還有處理「第一個字」的分支，現在已搬到上面，這裡不會再遇到。）
        while not fit and count < self.maxloops:
            try:
                col, row, vertical = coordlist[count][0], coordlist[count][1], coordlist[count][2]
            # no more cordinates, stop trying to fit
            except IndexError:
                return

            # already filtered these out, but double check
            if coordlist[count][4]:
                fit = True
                self.set_word(col, row, vertical, word, force=True)

            count += 1

        return

    def check_fit_score(self, col, row, vertical, word):
        """Return score: 0 signifies no fit, 1 means a fit, 2+ means a cross.
        The more crosses the better.
        """
        if col < 1 or row < 1:
            return 0

        # give score a standard value of 1, will override with 0 if collisions detected
        count, score = 1, 1
        for letter in word.word:
            try:
                active_cell = self.get_cell(col, row)
            except IndexError:
                return 0

            if active_cell == self.empty or active_cell == letter:
                pass
            else:
                return 0

            if active_cell == letter:
                score += 1

            if vertical:
                # check surroundings
                if active_cell != letter: # don't check surroundings if cross point
                    if not self.check_if_cell_clear(col+1, row): # check right cell
                        return 0

                    if not self.check_if_cell_clear(col-1, row): # check left cell
                        return 0

                if count == 1: # check top cell only on first letter
                    if not self.check_if_cell_clear(col, row-1):
                        return 0

                if count == len(word.word): # check bottom cell only on last letter
                    if not self.check_if_cell_clear(col, row+1):
                        return 0
            else: # else horizontal
                # check surroundings
                if active_cell != letter: # don't check surroundings if cross point
                    if not self.check_if_cell_clear(col, row-1): # check top cell
                        return 0

                    if not self.check_if_cell_clear(col, row+1): # check bottom cell
                        return 0

                if count == 1: # check left cell only on first letter
                    if not self.check_if_cell_clear(col-1, row):
                        return 0

                if count == len(word.word): # check right cell only on last letter
                    if not self.check_if_cell_clear(col+1, row):
                        return 0

            if vertical: # progress to next letter and position
                row += 1
            else: # else horizontal
                col += 1

            count += 1

        return score

    def set_word(self, col, row, vertical, word, force=False):
        """Set word in the grid, and adds word to word list."""
        if force:
            # 先確認整個字都在盤面內，再改任何狀態：寫到一半才丟錯會留下半成品。
            # （一般排字路徑已先經 check_fit_score，這裡是 force=True 直接呼叫時的保護。）
            length = len(word.word)
            if length:
                last_col = col if vertical else col + length - 1
                last_row = row + length - 1 if vertical else row
                for c, r in ((col, row), (last_col, last_row)):
                    if not (1 <= c <= self.cols and 1 <= r <= self.rows):
                        raise IndexError(f"word {word.word!r} does not fit inside the {self.cols}x{self.rows} grid")
            word.col = col
            word.row = row
            word.vertical = vertical
            self.current_word_list.append(word)

            for letter in word.word:
                self.set_cell(col, row, letter)
                if vertical:
                    row += 1
                else:
                    col += 1

        return

    def set_cell(self, col, row, value):
        if not (1 <= col <= self.cols and 1 <= row <= self.rows):
            raise IndexError(f"cell ({col}, {row}) is outside the {self.cols}x{self.rows} grid")
        self.grid[row-1][col-1] = value

    def get_cell(self, col, row):
        # 座標是 1-based。必須主動檢查四個方向：Python 的 -1 不會丟 IndexError，
        # 座標 0 會悄悄讀到對面那一側的格子。
        if not (1 <= col <= self.cols and 1 <= row <= self.rows):
            raise IndexError(f"cell ({col}, {row}) is outside the {self.cols}x{self.rows} grid")
        return self.grid[row-1][col-1]

    def check_if_cell_clear(self, col, row):
        try:
            cell = self.get_cell(col, row)
            return cell == self.empty
        except IndexError:
            # 盤面外不會有字，所以貼邊的字，盤外那一側的鄰格算「乾淨」。
            # （字本身超出盤面由 check_fit_score 對 get_cell 的 IndexError 擋下。）
            return True

    def solution(self):
        """Return solution grid."""
        return crossword_display.solution(self)

    def word_find(self):
        """Return solution grid."""
        return crossword_display.word_find(self)

    def order_number_words(self):
        """Orders words and applies numbering system to them."""
        # 一般填字的編號順序：由上而下、由左而右。起點相同的字排序後必定相鄰，
        # 下面「只比相鄰兩個字」的共用題號邏輯才成立（col+row 做不到這點）。
        self.current_word_list.sort(key=lambda i: (i.row, i.col))
        count, icount = 1, 1
        for word in self.current_word_list:
            word.number = count
            if icount < len(self.current_word_list):
                if word.col == self.current_word_list[icount].col and word.row == self.current_word_list[icount].row:
                    pass
                else:
                    count += 1
            icount += 1

    def display(self, order=True):
        """返回顯示用的網格，將字母替換為空格並標上數字。"""
        return crossword_display.display(self, order=order)

    def word_bank(self):
        return crossword_display.word_bank(self)

    def legend(self):
        """Must order first."""
        return crossword_display.legend(self)


class Word(object):
    def __init__(self, word=None, clue=None):
        self.word = re.sub(r'\s', '', word.lower())
        self.clue = clue
        self.length = len(self.word)
        # the below are set when placed on board
        self.row = None
        self.col = None
        self.vertical = None
        self.number = None

    def down_across(self):
        """Return down or across."""
        if self.vertical:
            return 'down'
        else:
            return 'across'

    def __repr__(self):
        return self.word


#start_full = float(time.time())

word_list = [
    ['apah', '糯米飯'],
    ['bahat', '西瓜'],
    ['banan', '高粱'],
    ['bazing', '蛋'],
    ['hlahuy', '森林、山林'],
    ['hongwaysen', '紅外線'],
    ['iyanghwatan', '一氧化炭'],
    ['kagang', '螃蟹'],
    ['kawciya', '高氣壓'],
    ['hugal', '都市'],
    ['intuyang', '印度洋'],
    ['kbawlung', '蝦子'],
    ['kbzyan', '平埔族'],
    ['kensackang', '檢察官'],
    ['khelang', '客家人'],
    ['kingahul', '獨角仙'],
    ['kinsruyun','地鼠'],
    ['llyung', '河流、溪流'],
    ['mhitung', '百步蛇'],
    ['mksingut', '小黑人'],
]

if __name__ == "__main__":
    a = Crossword(13, 13, '-', 5000, word_list)
    a.compute_crossword(2)
    print(a.word_bank())
    print(a.solution())
    print(a.word_find())
    print(a.display())
    print(a.legend())
    print(len(a.current_word_list), 'out of', len(word_list))
    print(a.debug)
#end_full = float(time.time())
#print(end_full - start_full)