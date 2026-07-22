import json
import logging
import re
from django.http import HttpResponse, JsonResponse
from django_ratelimit.core import is_ratelimited
from sqlalchemy import text
from .crossword import Crossword, Word as CrosswordWord, word_list
from django.views.decorators.csrf import csrf_exempt
from config.tribes import TRIBE_IDS as _ALL_TRIBE_IDS
from config.firebase_auth import verify_firebase_token
from fastAPI.routes.connect import SessionLocal
from .serializers import SubmitAnsSerializer

logger = logging.getLogger(__name__)


def _rate_limited_response(request, decoded, group, rate, method):
    """依已登入使用者的 uid 限速，邏輯與 AIModel/views.py 一致。"""
    uid = decoded.get("uid", "anon")
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


# 各族語對應的 tribe_id（UUID）。tayal 故意排除：泰雅語填字遊戲沿用內建
# word_list（見 generate_crossword 的 fallback 分支），不查資料庫。
_TRIBE_IDS = {slug: tid for slug, tid in _ALL_TRIBE_IDS.items() if slug != 'tayal'}

def _get_words_from_db(tribe_id: str, limit: int = 30):
    """從 dictionary.db 取出純英文字母、長度 4-10、有中文解釋的詞彙。
    explanation_items 已經拆到 word_explanation 表，這裡改成 JOIN 取第一筆解釋
    （sort_order = 0，對應原本 exp[0]），INNER JOIN 本身就篩掉沒有解釋的字。

    走 fastAPI.routes.connect 共用的 SessionLocal（而非原生 sqlite3.connect），
    這樣才會走 SQLAlchemy 的 QueuePool，且連線時自動套用該 engine 的
    connect event listener（PRAGMA foreign_keys / journal_mode = WAL），
    避免高流量下和其他 SQLAlchemy 連線競爭 WAL 鎖。"""
    db = SessionLocal()
    try:
        rows = db.execute(
            text('''SELECT w.name, we.chinese_explanation
                    FROM words w
                    JOIN word_explanation we ON we.word_id = w.id AND we.sort_order = 0
                    WHERE w.tribe_id = :tribe_id'''),
            {"tribe_id": tribe_id}
        ).fetchall()
    except Exception as e:
        # 原本把 str(e) 一路往上傳、直接回給前端，可能洩漏資料庫查詢細節。
        # 錯誤只留在伺服器端的 log，呼叫端只拿到「有沒有失敗」這個布林資訊。
        logger.error("[CrosswordPuzzle] 查詢詞庫失敗: %s", e)
        return [], True
    finally:
        db.close()

    results = []
    for name, cn in rows:
        if not re.match(r'^[a-zA-Z]+$', name):
            continue
        if not (4 <= len(name) <= 10):
            continue
        if not cn:
            continue
        results.append([name.lower(), cn])
        if len(results) >= limit:
            break

    return results, None


def generate_crossword(request):
    # 每次呼叫最長要花 2 秒 CPU 運算（見下方 compute_crossword(time_permitted=2)），
    # 且原本匿名可打、無限流，可被重複呼叫拿來耗盡伺服器資源，故加上登入 + 限流。
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="generate_crossword", rate="30/m", method="GET")
    if limited_resp:
        return limited_resp

    tribe = request.GET.get('tribe', 'tayal')

    # 依族語選擇詞庫
    if tribe in _TRIBE_IDS:
        selected_words, err = _get_words_from_db(_TRIBE_IDS[tribe])
        if err:
            return JsonResponse({'detail': '資料庫讀取失敗，請稍後再試'}, status=500)
        if len(selected_words) < 5:
            return JsonResponse({'detail': f'詞庫不足，無法生成填字遊戲（僅找到 {len(selected_words)} 筆）'}, status=500)
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
            # debug_loops（內部運算迴圈次數，純除錯用）不對外回傳。
        }
    }

    return JsonResponse(response_data)

# csrf_exempt 在這裡不是「豁免掉一項保護」，而是「這項保護原本就不適用」，永久生效，
# 不隨 DEBUG 變動：這是無狀態的 Bearer-token JSON API（見下方 verify_firebase_token），
# 前端從不帶 CSRF cookie/token，CSRF 保護針對的是瀏覽器自動夾帶 session cookie
# 的情境，跟這裡的認證機制無關（比照 AIModel/views.py 同樣的 Bearer-token 端點）。
@csrf_exempt
def submit_ans(request):
    if request.method == 'POST':
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        # 原本只有認證、完全沒限流；答案比對本身不貴，但沒有上限的話一樣能被
        # 重複呼叫拿來當簡單的濫用管道，跟 generate_crossword 用同一套標準。
        limited_resp = _rate_limited_response(request, decoded, group="submit_ans", rate="30/m", method="POST")
        if limited_resp:
            return limited_resp

        # 原本直接 json.loads(request.body) 後就用 dict.get()／list index 存取，
        # 完全沒驗證請求結構——欄位缺漏或型別不對時例外會一路往外拋，被 Django
        # 預設的 500 處理接住，正式環境回一頁 HTML，跟這個 API 統一回 JSON 的
        # 約定不一致。改成先安全解析 JSON，再用 SubmitAnsSerializer 驗證結構。
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'detail': '請求格式錯誤'}, status=400)

        serializer = SubmitAnsSerializer(data=data)
        if not serializer.is_valid():
            return JsonResponse({'detail': '請求參數錯誤', 'errors': serializer.errors}, status=400)
        validated = serializer.validated_data

        user_answers = validated['user_answers']
        crossword_solution = validated['crossword_solution']
        crossword_legend = validated['crossword_legend']

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
                        logger.warning("Index out of bounds for word %s (across).", word_number)
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
                        logger.warning("Index out of bounds for word %s (down).", word_number)
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
    
    return JsonResponse({'detail': 'Invalid request method'}, status=405)
