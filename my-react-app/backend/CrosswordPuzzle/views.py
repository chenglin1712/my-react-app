import json
import re
import sqlite3
from pathlib import Path
from django.http import HttpResponse, JsonResponse
from .crossword import Crossword, Word as CrosswordWord, word_list
from django.views.decorators.csrf import csrf_exempt

# dictionary.db 路徑（與 fastAPI routes 共用同一個 DB）
_DB_PATH = Path(__file__).resolve().parent.parent / 'fastAPI' / 'routes' / 'dictionary.db'

# 各族語對應的 tribe_id（UUID）
_TRIBE_IDS = {
    'amis':    'e68273b9-1f2b-4c42-8d95-f52189ab24b7',
    'bunun':   '865a96e3-3384-45b3-8bd0-e1f799b75515',
    'kavalan': 'c5974f37-b49d-466a-ab24-6893ab4ef6a5',
    'paiwan':  '19c77a3b-3a81-496f-b0f4-afe6d9155edd',
}

def _get_words_from_db(tribe_id: str, limit: int = 30):
    """從 dictionary.db 取出純英文字母、長度 4-10、有中文解釋的詞彙。"""
    try:
        conn = sqlite3.connect(str(_DB_PATH))
        cursor = conn.cursor()
        cursor.execute(
            'SELECT name, explanation_items FROM words WHERE tribe_id = ? AND explanation_items IS NOT NULL',
            (tribe_id,)
        )
        rows = cursor.fetchall()
        conn.close()
    except Exception as e:
        return [], str(e)

    results = []
    for name, exp_json in rows:
        if not re.match(r'^[a-zA-Z]+$', name):
            continue
        if not (4 <= len(name) <= 10):
            continue
        try:
            exp = json.loads(exp_json)
        except Exception:
            continue
        cn = exp[0].get('chineseExplanation', '') if exp else ''
        if not cn:
            continue
        results.append([name.lower(), cn])
        if len(results) >= limit:
            break

    return results, None


def generate_crossword(request):
    tribe = request.GET.get('tribe', 'tayal')

    # 依族語選擇詞庫
    if tribe in _TRIBE_IDS:
        selected_words, err = _get_words_from_db(_TRIBE_IDS[tribe])
        if err:
            return JsonResponse({'error': f'資料庫讀取失敗：{err}'}, status=500)
        if len(selected_words) < 5:
            return JsonResponse({'error': f'詞庫不足，無法生成填字遊戲（僅找到 {len(selected_words)} 筆）'}, status=500)
    else:
        selected_words = [[item[0], item[1]] for item in word_list]

    available_words_for_generator = []
    for item in selected_words:
        available_words_for_generator.append(
            CrosswordWord(item[0], item[1])   #[單字, 提示] 的列表
        )

    #設定填字遊戲格子=13*13
    grid_cols = 13
    grid_rows = 13

    #計算填字遊戲
    crossword_generator = Crossword(grid_cols, grid_rows, empty='-', maxloops=5000, available_words=available_words_for_generator)
    crossword_generator.compute_crossword(time_permitted=2) #2秒找填字遊戲

    # 獲取生成的填字遊戲資料進行編號排序
    crossword_generator.order_number_words()

    # 獲取解答網格（包含字母）
    grid_solution = crossword_generator.solution().strip().split('\n')
    
    # 獲取顯示網格（包含數字和空格）
    grid_display = crossword_generator.display(order=False) 
    
    # 準備提示數據
    legend_data = []
    for word_obj in crossword_generator.current_word_list:
        legend_data.append({
            'number': word_obj.number,
            'word': word_obj.word,
            'clue': word_obj.clue,
            'direction': word_obj.down_across(),
            'start_col': word_obj.col,
            'start_row': word_obj.row,
            'length': word_obj.length,
        })
    
    #單字庫列表
    word_bank_list = [word.word for word in crossword_generator.current_word_list]

    #將結果組合成JSON
    response_data = {
        'grid_solution': grid_solution,         #遊戲網格 (解答)
        'grid_display': grid_display,           #數字和空格的填字格子
        'legend': legend_data,                  #數字和方向的提示
        'word_bank': word_bank_list,            #填字遊戲中使用的單字列表
        'info': {
            'placed_words_count': len(crossword_generator.current_word_list), 
            'total_words_available': len(available_words_for_generator),    
            'debug_loops': crossword_generator.debug,                       
        }
    }

    return JsonResponse(response_data)

@csrf_exempt
def submit_ans(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        user_answers = data.get('user_answers')
        crossword_solution = data.get('crossword_solution')
        crossword_legend = data.get('crossword_legend')
        
        # 移除空格，使其與 user_answers 的格式一致
        cleaned_solution = [row.replace(' ', '') for row in crossword_solution]

        results = {
            'total_words': len(crossword_legend),
            'correct_words_count': 0,
            'word_details': []
        }
        
        for clue in crossword_legend:
            word_number = clue['number']
            word_clue = clue['clue']
            word_direction = clue['direction']
            word_length = clue['length']
            start_col = clue['start_col']
            start_row = clue['start_row']
            
            correct_word = clue['word'].lower()
            user_word_chars = []
            is_correct = True 

            # 橫向單字比對
            if word_direction == 'across':
                for i in range(word_length):
                    row, col = start_row - 1, start_col - 1 + i
                    if (row < len(user_answers) and col < len(user_answers[row]) and
                            row < len(cleaned_solution) and col < len(cleaned_solution[row])):

                        user_char = user_answers[row][col].lower()
                        user_word_chars.append(user_char)

                        correct_char_from_grid = cleaned_solution[row][col].lower()
                        if correct_char_from_grid not in ('-', ''):
                            if correct_char_from_grid != user_char:
                                is_correct = False
                                break
                    else:
                        print(f"Warning: Index out of bounds for word {word_number} (across).")
                        is_correct = False
                        break

            # 縱向單字比對
            elif word_direction == 'down':
                for i in range(word_length):
                    row, col = start_row - 1 + i, start_col - 1
                    if (row < len(user_answers) and col < len(user_answers[row]) and
                            row < len(cleaned_solution) and col < len(cleaned_solution[row])):

                        user_char = user_answers[row][col].lower()
                        user_word_chars.append(user_char)

                        correct_char_from_grid = cleaned_solution[row][col].lower()
                        if correct_char_from_grid not in ('-', ''):
                            if correct_char_from_grid != user_char:
                                is_correct = False
                                break
                    else:
                        print(f"Warning: Index out of bounds for word {word_number} (down).")
                        is_correct = False
                        break
            
            # 如果單字被判斷為正確，增加答對數
            if is_correct:
                results['correct_words_count'] += 1

            results['word_details'].append({
                'number': word_number,
                'clue': word_clue,
                'direction': word_direction,
                'is_correct': is_correct,
                # 將正確答案欄位legend 中取出的完整單字
                'correct_word': correct_word,
                'user_word': "".join(user_word_chars)
            })
        
        return JsonResponse(results)
    
    return JsonResponse({'error': 'Invalid request method'}, status=405)
