import json
import logging
import os
import random
import re
import threading
from django.http import HttpResponse, JsonResponse
from django_ratelimit.core import is_ratelimited
from sqlalchemy import text
from .crossword import Crossword, Word as CrosswordWord
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from config.tribes import TRIBE_IDS as _ALL_TRIBE_IDS
from core.firebase_auth import verify_firebase_token
from dictionary_db.connect import SessionLocal
from adminapi.game_config_service import get_crossword_config
from adminapi.rate_limits import get_configured_rate
from . import puzzle_token
from .serializers import SubmitAnsSerializer

logger = logging.getLogger(__name__)

# 稽核 BE5-03：排字是同步的 CPU 忙等（最長 compute_time_limit_seconds 秒），同時跑太多會吃滿這個行程的 worker。
# 每個行程同時最多幾份；超過就請使用者稍後再試（每個 gunicorn worker 各自計算）。
_MAX_CONCURRENT_GENERATIONS = max(1, int(os.getenv("CROSSWORD_MAX_CONCURRENT_GENERATIONS", "2")))
_generation_slots = threading.BoundedSemaphore(_MAX_CONCURRENT_GENERATIONS)


def _rate_limited_response(request, decoded, group, rate, method):
    """依已登入使用者的 uid 限速，邏輯與 AIModel/views.py 一致。"""
    uid = decoded.get("uid", "anon")
    effective_rate = get_configured_rate(group, rate)
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=effective_rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


# 長度篩選下推到 SQL 是效能考量（減少傳輸筆數），不是唯一的把關——
# _eligible_words() 仍然會在 Python 端複查一次，見該函式的說明。
_WORD_TREE_SQL = '''SELECT w.name, we.chinese_explanation
                    FROM words w
                    JOIN word_explanation we ON we.word_id = w.id AND we.sort_order = 0
                    WHERE w.tribe_id = :tribe_id
                      AND LENGTH(w.name) BETWEEN :min_length AND :max_length'''


def _eligible_words(rows, min_length, max_length, limit):
    """套用純英文字母、長度介於範圍內、有中文解釋三個條件，取前 limit 筆。
    長度篩選同時也下推到 SQL（見 _WORD_TREE_SQL，減少傳輸筆數），這裡
    保留一份是防禦性複查，不是信任呼叫端一定先過濾好——純英文字母／非空
    解釋這兩個條件本來就無法可攜地下推到 SQL（SQLite／Postgres 語法不同），
    留在 Python 端做，順手把長度也一起查一次成本很低。"""
    results = []
    for name, cn in rows:
        if not re.match(r'^[a-zA-Z]+$', name):
            continue
        if not (min_length <= len(name) <= max_length):
            continue
        if not cn:
            continue
        results.append([name.lower(), cn])
        if len(results) >= limit:
            break
    return results


def _get_words_from_db(tribe_id: str, min_length: int, max_length: int, limit: int):
    """從 dictionary.db 取出純英文字母、長度介於 min_length/max_length 之間、
    有中文解釋的詞彙。explanation_items 已經拆到 word_explanation 表，這裡
    改成 JOIN 取第一筆解釋（sort_order = 0，對應原本 exp[0]），INNER JOIN
    本身就篩掉沒有解釋的字。

    候選詞先用 ORDER BY RANDOM() LIMIT 抓一批「遠多於 limit」的隨機樣本
    （原本沒有 ORDER BY／LIMIT，永遠固定拿到資料庫回傳順序的前 limit 筆，
    每一局的候選詞完全相同，且不管詞庫多大都會整族語掃過一遍）。抽樣批次
    篩完不夠 limit 筆時（純英文字母／非空解釋這兩個條件是隨機批次抽到之後
    才知道的，可能剛好篩掉太多），退回不限筆數查詢整個族語＋洗牌，保證
    「詞庫真的不夠」時的降級行為跟原本一致，不會因為隨機批次沒抽好就誤判
    詞庫不足。

    走 dictionary_db.connect 共用的 SessionLocal（而非原生 sqlite3.connect），
    這樣才會走 SQLAlchemy 的 QueuePool，且連線時自動套用該 engine 的
    connect event listener（PRAGMA foreign_keys / journal_mode = WAL），
    避免高流量下和其他 SQLAlchemy 連線競爭 WAL 鎖。"""
    oversample = max(limit * 8, 200)
    db = SessionLocal()
    try:
        rows = db.execute(
            text(_WORD_TREE_SQL + ' ORDER BY RANDOM() LIMIT :oversample'),
            {"tribe_id": tribe_id, "min_length": min_length, "max_length": max_length, "oversample": oversample}
        ).fetchall()
        results = _eligible_words(rows, min_length, max_length, limit)

        if len(results) < limit:
            # 隨機批次篩完不夠，退回族語全量查詢（不限筆數）保底，Python
            # 端洗牌後再篩——確保「不夠」是詞庫真的不夠，不是隨機批次沒抽中。
            all_rows = db.execute(text(_WORD_TREE_SQL), {
                "tribe_id": tribe_id, "min_length": min_length, "max_length": max_length,
            }).fetchall()
            all_rows = list(all_rows)
            random.shuffle(all_rows)
            results = _eligible_words(all_rows, min_length, max_length, limit)
    except Exception as e:
        # 原本把 str(e) 一路往上傳、直接回給前端，可能洩漏資料庫查詢細節。
        # 錯誤只留在伺服器端的 log，呼叫端只拿到「有沒有失敗」這個布林資訊。
        logger.error("[CrosswordPuzzle] 查詢詞庫失敗: %s", e)
        return [], True
    finally:
        db.close()

    return results, None


@require_GET
def generate_crossword(request):
    # 每次呼叫最長要花 2 秒 CPU 運算（見下方 compute_crossword(time_permitted=2)），
    # 且原本匿名可打、無限流，可被重複呼叫拿來耗盡伺服器資源，故加上登入 + 限流。
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="generate_crossword", rate="6/m", method="GET")
    if limited_resp:
        return limited_resp

    tribe = request.GET.get('tribe', 'tayal')

    # 先前沒有驗證：不支援的族語值會落到 else 分支，靜默回傳泰雅語填字遊戲
    # 而非報錯。listening.py／sentence.py／quiz.py 對同一種情況會正確回傳
    # 400，這裡補上同樣的驗證。
    if tribe not in _ALL_TRIBE_IDS:
        return JsonResponse({'detail': f'不支援的族語：{tribe}'}, status=400)

    game_config = get_crossword_config()
    min_length = game_config.min_word_length
    max_length = game_config.max_word_length
    words_per_round = game_config.words_per_round

    # 5 個族語統一即時查辭典資料庫選字——泰雅語原本有一份後台可編輯的
    # 專屬詞庫（CrosswordTayalWord），這是唯一跟其他 4 個族語不同的地方；
    # 使用者決定移除這個特例，統一成同一套邏輯，簡化維護、也讓「調整詞長
    # 範圍」這類設定對 5 個族語一視同仁地生效（先前泰雅語如果詞庫筆數不夠
    # 得手動回後台加詞，其他族語則是辭典本身收錄的詞不夠才會不足，兩種
    # 「不足」原因不一樣，統一後只剩一種）。
    selected_words, err = _get_words_from_db(_ALL_TRIBE_IDS[tribe], min_length, max_length, words_per_round)
    if err:
        return JsonResponse({'detail': '資料庫讀取失敗，請稍後再試'}, status=500)
    if len(selected_words) < 5:
        return JsonResponse({'detail': f'詞庫不足，無法生成填字遊戲（僅找到 {len(selected_words)} 筆）'}, status=500)

    available_words_for_generator = []
    for item in selected_words:
        available_words_for_generator.append(
            CrosswordWord(item[0], item[1])   #[單字, 提示] 的列表
        )

    #設定填字遊戲格子大小（後台可調，見 GameConfig.crossword_grid_size）
    grid_cols = game_config.grid_size
    grid_rows = game_config.grid_size

    #計算填字遊戲
    if not _generation_slots.acquire(blocking=False):
        return JsonResponse({'detail': '系統忙碌，請稍後再試'}, status=503)
    try:
        crossword_generator = Crossword(
            grid_cols, grid_rows, empty='-', maxloops=5000, available_words=available_words_for_generator,
        )
        crossword_generator.compute_crossword(time_permitted=game_config.compute_time_limit_seconds)
    finally:
        _generation_slots.release()

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
    
    # 稽核 BE5-09：完整解答與答案單字只放在加密的題目憑證裡（綁這位使用者、兩小時有效），
    # 前端拿到的網格只剩「哪些格子可以填」，提示不含答案單字，也不再送出單字庫列表。
    token = puzzle_token.issue(decoded.get('uid', 'anon'), grid_solution, legend_data)
    public_solution = [re.sub(r'[^\s-]', '_', row) for row in grid_solution]
    public_legend = [{key: value for key, value in item.items() if key != 'word'} for item in legend_data]

    #將結果組合成JSON
    response_data = {
        'puzzle_token': token,                  #提交作答時原樣送回，伺服器用它判分
        'grid_solution': public_solution,       #遮蔽後的網格（只看得出哪些格子可填）
        'grid_display': grid_display,           #數字和空格的填字格子
        'legend': public_legend,                #數字、提示、方向與位置（不含答案單字）
        'info': {
            'placed_words_count': len(crossword_generator.current_word_list),
            'total_words_available': len(available_words_for_generator),
            # debug_loops（內部運算迴圈次數，純除錯用）不對外回傳。
        }
    }

    return JsonResponse(response_data)

def _grade_submission(user_answers, crossword_solution, crossword_legend):
    """逐字比對作答與解答，回傳結果 dict。解答與圖例必須來自伺服器簽發的題目憑證，不能是前端送來的值。"""
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
                # 0 <= row/col：序列化器已擋 start_* < 1，這裡再守一次，避免負索引繞到尾端。
                if (0 <= row < len(user_answers) and 0 <= col < len(user_answers[row]) and
                        0 <= row < len(cleaned_solution) and 0 <= col < len(cleaned_solution[row])):

                    user_char = user_answers[row][col].lower()
                    user_word_chars.append(user_char)

                    correct_char_from_grid = cleaned_solution[row][col].lower()
                    if correct_char_from_grid not in ('-', ''):
                        if correct_char_from_grid != user_char:
                            # 不能 break：user_word 要收集整個單字，結果頁才會顯示使用者實際填的完整答案
                            is_correct = False
                else:
                    logger.warning("Index out of bounds for word %s (across).", word_number)
                    is_correct = False
                    break

        # 縱向單字比對
        elif word_direction == 'down':
            for i in range(word_length):
                row, col = start_row - 1 + i, start_col - 1
                # 0 <= row/col：序列化器已擋 start_* < 1，這裡再守一次，避免負索引繞到尾端。
                if (0 <= row < len(user_answers) and 0 <= col < len(user_answers[row]) and
                        0 <= row < len(cleaned_solution) and 0 <= col < len(cleaned_solution[row])):

                    user_char = user_answers[row][col].lower()
                    user_word_chars.append(user_char)

                    correct_char_from_grid = cleaned_solution[row][col].lower()
                    if correct_char_from_grid not in ('-', ''):
                        if correct_char_from_grid != user_char:
                            # 不能 break：user_word 要收集整個單字，結果頁才會顯示使用者實際填的完整答案
                            is_correct = False
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

    # 四捨五入（與前端 Math.round 一致；Python 的 round 是銀行家捨入）
    results['score'] = int(100 * results['correct_words_count'] / results['total_words'] + 0.5) if results['total_words'] else 0
    return results


# 稽核 BE5-09：判分在伺服器端——解答與圖例從題目憑證（puzzle_token.py）取得，前端只送憑證與自己的作答。
# csrf_exempt 在這裡不是「豁免掉一項保護」，而是「這項保護原本就不適用」，永久生效，
# 不隨 DEBUG 變動：這是無狀態的 Bearer-token JSON API（見下方 verify_firebase_token），
# 前端從不帶 CSRF cookie/token，CSRF 保護針對的是瀏覽器自動夾帶 session cookie
# 的情境，跟這裡的認證機制無關（比照 AIModel/views.py 同樣的 Bearer-token 端點）。
@csrf_exempt
def submit_ans(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Invalid request method'}, status=405)

    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    # 原本只有認證、完全沒限流；答案比對本身不貴，但沒有上限的話一樣能被
    # 重複呼叫拿來當簡單的濫用管道，跟 generate_crossword 用同一套標準。
    limited_resp = _rate_limited_response(request, decoded, group="submit_ans", rate="30/m", method="POST")
    if limited_resp:
        return limited_resp

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'detail': '請求格式錯誤'}, status=400)

    serializer = SubmitAnsSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({'detail': '請求參數錯誤', 'errors': serializer.errors}, status=400)
    validated = serializer.validated_data

    puzzle = puzzle_token.read(validated['puzzle_token'], decoded.get('uid', 'anon'))
    if puzzle is None:
        return JsonResponse({'detail': '題目已過期或無效，請重新開始一局', 'code': 'puzzle_expired'}, status=400)

    return JsonResponse(_grade_submission(validated['user_answers'], puzzle['solution'], puzzle['legend']))
