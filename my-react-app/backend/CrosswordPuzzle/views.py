import json
from django.http import HttpResponse, JsonResponse
from .crossword import Crossword, Word as CrosswordWord, word_list 
from django.views.decorators.csrf import csrf_exempt

def generate_crossword(request):
    available_words_for_generator = []
    for item in word_list:  #匯入crossword.py的word_list
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
                    if (start_row - 1 < len(user_answers) and 
                        (start_col - 1 + i) < len(user_answers[start_row - 1])):
                        
                        user_char = user_answers[start_row - 1][start_col - 1 + i].lower()
                        user_word_chars.append(user_char)

                        correct_char_from_grid = cleaned_solution[start_row - 1][start_col - 1 + i].lower()
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
                    if ((start_row - 1 + i) < len(user_answers) and 
                        start_col - 1 < len(user_answers[start_row - 1 + i])):

                        user_char = user_answers[start_row - 1 + i][start_col - 1].lower()
                        user_word_chars.append(user_char)
                        
                        correct_char_from_grid = cleaned_solution[start_row - 1 + i][start_col - 1].lower()
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
