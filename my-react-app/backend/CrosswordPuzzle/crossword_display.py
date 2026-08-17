"""填字遊戲「已經算好的結果」怎麼轉成各種輸出格式（解答網格文字、挖空後
給玩家看的網格、後台除錯用的填字表、單字列表、線索列表），從
crossword.py 抽出來（P4 review BE-26）：原本這幾個純序列化方法混在
Crossword 這個同時也負責排字演算法（suggest_coord／fit_and_add／
check_fit_score 等）的類別裡，演算法本身要不要動、輸出格式要不要調整是
兩件完全獨立的事，混在同一個檔案裡讓兩者難以分開看。

這裡的函式全部只讀 Crossword 實例已經算好的公開狀態（.grid／.current_word_list
／.rows／.cols／.empty），不會改動它、也不會觸發任何排字演算法，純粹是
「已經有的資料 → 字串」的轉換。Crossword 本身保留同名的方法（solution()／
word_find()／display()／word_bank()／legend()）當作薄薄一層委派，
CrosswordPuzzle/views.py 既有呼叫點不必更動。
"""
import random
import string


def solution(crossword) -> str:
    """回傳解答網格。"""
    out_str = ""
    for r in range(crossword.rows):
        for c in crossword.grid[r]:
            out_str += "%s " % c
        out_str += "\n"
    return out_str


def word_find(crossword) -> str:
    """回傳解答網格，但空格用隨機字母填滿（給玩家看的「找字」版本）。"""
    out_str = ""
    for r in range(crossword.rows):
        for c in crossword.grid[r]:
            if c == crossword.empty:
                out_str += "%s " % string.ascii_lowercase[random.randint(0, len(string.ascii_lowercase) - 1)]
            else:
                out_str += "%s " % c
        out_str += "\n"
    return out_str


def display(crossword, order=True) -> list:
    """返回顯示用的網格，將字母替換為空格並標上數字。"""
    if order:
        crossword.order_number_words()

    # 建立一個新的網格，用來顯示數字和空格
    # 從現有的網格複製，但只保留數字和 '-'
    display_grid = [
        [' ' if cell not in ('-') else '-' for cell in row]
        for row in crossword.grid
    ]

    for word in crossword.current_word_list:
        number_str = str(word.number)
        start_col = word.col
        start_row = word.row

        # 確保座標在網格範圍內
        if 0 <= start_row - 1 < crossword.rows and 0 <= start_col - 1 < crossword.cols:
            # 取得起始格的現有內容
            current_cell_content = display_grid[start_row - 1][start_col - 1]

            # 如果該格不是黑格，將其設定為數字字串
            if current_cell_content != '-':
                display_grid[start_row - 1][start_col - 1] = number_str

    # 將網格轉換為字串列表
    return [''.join(row) for row in display_grid]


def word_bank(crossword) -> str:
    """回傳打亂順序的單字列表（純文字，一行一個字）。"""
    from copy import copy as duplicate

    out_str = ''
    temp_list = duplicate(crossword.current_word_list)
    random.shuffle(temp_list)
    for word in temp_list:
        out_str += '%s\n' % word.word
    return out_str


def legend(crossword) -> str:
    """回傳題號＋座標＋方向＋線索的清單。呼叫前必須先排過號（見
    Crossword.order_number_words()）。"""
    out_str = ''
    for word in crossword.current_word_list:
        out_str += '%d. (%d,%d) %s: %s\n' % (word.number, word.col, word.row, word.down_across(), word.clue)
    return out_str
