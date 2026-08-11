import logging
import random
import re
from datetime import datetime
from urllib.parse import urljoin
import requests
from django.core.cache import cache
from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited
from bs4 import BeautifulSoup
from config.firebase_auth import verify_firebase_token
from config.tribes import TRIBE_IDS, TRIBE_MAP
from adminapi.models import (
    ExamScheduleCrawlStatus, ExamScheduleOverride, FeatureFlag, QuizChoiceItem, QuizClozePassage,
    QuizSituationItem, QuizTrueFalseItem, QuizVocabItem,
)
from adminapi.rate_limits import get_configured_rate

logger = logging.getLogger(__name__)

# 外部 API 呼叫的逾時秒數（get_quiz_data 原本完全沒設，一個掛住的上游請求
# 會佔用 worker 到系統預設逾時甚至永遠不回應）。
_EXTERNAL_TIMEOUT = 10


def _rate_limited_response(request, key, group, rate, method):
    """依 key（已登入使用者 uid 或 IP）限速，邏輯與 AIModel/views.py 一致。"""
    effective_rate = get_configured_rate(group, rate)
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: key,
        rate=effective_rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None

# 中高級（level 3）配合題選題公式的配額——原本分散寫死在五個 *_bank.py
# 各自的 CATEGORY_QUOTA，內容完全一致（見 P2 題庫管理調查結論），集中成
# 一份常數。BOARD_COUNT * PAIRS_PER_BOARD 必須等於配額總和，才能均分到
# 每個題組裡。
MATCHING_CATEGORY_QUOTA = {
    "noun": 8,       # 40%：延續初中級具象詞彙
    "verb": 5,       # 25%：中高級新增動詞
    "time": 3,       # 15%：中高級新增時間詞
    "function": 2,   # 10%：抽象代詞/功能詞
    "kin": 2,        # 10%：親屬與人物稱謂
}
MATCHING_BOARD_COUNT = 5
MATCHING_PAIRS_PER_BOARD = 4

# 高級（level 4）閱讀填空每次測驗抽幾篇短文——隨題庫擴充，抽樣篇數也會是
# min(CLOZE_PASSAGE_COUNT, 該族語目前已啟用的篇數)，不是每次都全部出。
CLOZE_PASSAGE_COUNT = 3


def _pick_matching_vocab_from_db(tribe):
    """依 MATCHING_CATEGORY_QUOTA 對每個類別做不放回抽樣，只從 status=published
    （已通過族語老師審定）的 QuizVocabItem 抽——草稿／待審核／已退件的內容
    不能被學生抽到，這是這次把題庫搬進資料庫、接上審定流程的核心目的。"""
    picked = []
    for category, quota in MATCHING_CATEGORY_QUOTA.items():
        pool = list(QuizVocabItem.objects.filter(
            tribe=tribe, category=category, status=QuizVocabItem.STATUS_PUBLISHED,
        ))
        quota = min(quota, len(pool))
        picked.extend(random.sample(pool, quota))
    random.shuffle(picked)
    return picked


def build_matching_test_from_db(tribe):
    """組出中高級「配合題」的 part 資料，改讀資料庫（取代原本各族語
    *_bank.py 的 build_matching_test()），選題演算法完全比照原本邏輯不變。"""
    picked = _pick_matching_vocab_from_db(tribe)
    tribe_full_name = TRIBE_MAP.get(tribe, tribe)

    # 只組出「完整」的題組（每組固定 MATCHING_PAIRS_PER_BOARD 筆）——原本
    # 固定跑 MATCHING_BOARD_COUNT 次，題庫不足時最後一組會拿到不滿 4 筆
    # 甚至完全空的 chunk，產生學生看到但完全無法作答的空題（獨立審查找到
    # 的問題）。跟 build_cloze_test_from_db() 的 min(quota, len(pool)) 降級
    # 同一種精神：題庫不足時題數就是變少，不製造殘缺的題目。
    board_count = min(MATCHING_BOARD_COUNT, len(picked) // MATCHING_PAIRS_PER_BOARD)

    questions = []
    for i in range(board_count):
        chunk = picked[i * MATCHING_PAIRS_PER_BOARD: (i + 1) * MATCHING_PAIRS_PER_BOARD]
        questions.append({
            "pairs": [
                {
                    "cn": item.chinese_gloss, "word": {"word": item.foreign_word, "audio": item.audio_file_id},
                    # P5.3 題目品質分析用——配合題一「題」（一個題組）其實是
                    # MATCHING_PAIRS_PER_BOARD 個不同 QuizVocabItem 的組合，
                    # 沒有單一 pk 可以代表整題；item_id 放在每個 pair 上，
                    # 前端送出作答追蹤事件時逐 pair 各記一筆，用整個題組的
                    # 對錯（見下方 answer 說明）當作每個 pair 的近似結果——
                    # 不是完美的逐詞歸因，但同一個詞會在多次測驗、多個不同
                    # 題組組合裡重複出現，統計上仍能反映出「這個詞經常出現在
                    # 答錯的題組裡」，比完全沒有 id 可追蹤好。
                    "item_id": item.id,
                }
                for item in chunk
            ],
            # 配合題採「全對/有錯」二元計分，比照初級是非題的 1/2 編碼。
            "answer": 1,
        })

    return {
        "type": "matching",
        "title": "第一部分：配合題",
        "intro": (
            f"本部分共{board_count}題，每題會出現4組{tribe_full_name}詞彙與中文意思，"
            "請將左右兩側配對正確；配對全部正確即為答對，"
            "配對錯誤任何一組即為答錯。"
        ),
        "questions": questions,
    }


def build_cloze_test_from_db(tribe):
    """組出高級「閱讀填空」的 part 資料，改讀資料庫（取代原本各族語
    *_bank.py 的 build_cloze_test()），只從 status=published 的
    QuizClozePassage 抽，選題演算法完全比照原本邏輯不變。"""
    passages = list(QuizClozePassage.objects.filter(tribe=tribe, status=QuizClozePassage.STATUS_PUBLISHED))
    k = min(CLOZE_PASSAGE_COUNT, len(passages))
    picked_passages = random.sample(passages, k)

    questions = []
    for passage in picked_passages:
        for blank_key, blank in passage.blanks.items():
            options = blank["options"][:]
            answer_word = options[blank["answer"] - 1]

            # 選項順序也要打散，避免每次正解都固定在同一個位置
            shuffled = options[:]
            random.shuffle(shuffled)
            new_answer_index = shuffled.index(answer_word) + 1

            display_passage = passage.passage_foreign.replace(f"{{{blank_key}}}", "＿＿＿")
            for other_key, other_blank in passage.blanks.items():
                if other_key != blank_key:
                    other_correct = other_blank["options"][other_blank["answer"] - 1]
                    display_passage = display_passage.replace(f"{{{other_key}}}", other_correct)

            questions.append({
                "passage_ab": display_passage,
                "passage_ch": passage.passage_chinese,
                "options": shuffled,
                "answer": new_answer_index,
                # P5.3 題目品質分析用——克漏字一「題」是一個空格，不是一整篇
                # 短文，複合字串鍵（passage pk + blank 標記）才能唯一代表它，
                # 跟 P4.4 匯入精靈處理 {blankN} 標記時同一種複合鍵慣例。
                "item_id": f"{passage.id}:{blank_key}",
            })

    return {
        "type": "cloze",
        "title": "第一部分：閱讀填空",
        "intro": (
            "本部分為短文克漏字，請依文意選出最適合填入空格「＿＿＿」的詞彙，"
            "每題4個選項，僅有1個最適合。"
        ),
        "questions": questions,
    }


# 初級（是非題）/中級（三選一圖片選擇題）每次測驗抽幾題——對照對方官方
# 介面原本「本部份共5題」的既有題量，遷移後維持相同體驗。
LEVEL1_QUESTION_COUNT = 5
LEVEL2_QUESTION_COUNT = 5


def build_true_false_test_from_db(tribe):
    """組出初級「是非題」的 part 資料，改讀資料庫（取代原本 get_quiz_data
    對 level=1 即時代理外部 API 的做法），只從 status=published 的
    QuizTrueFalseItem 抽。"""
    pool = list(QuizTrueFalseItem.objects.filter(tribe=tribe, status=QuizTrueFalseItem.STATUS_PUBLISHED))
    k = min(LEVEL1_QUESTION_COUNT, len(pool))
    picked = random.sample(pool, k)

    return {
        "type": "true_false",
        "title": "第一部分：是非題",
        "intro": (
            "本部份共5題，每題都有一個圖片，請聆聽播放的族語句子，"
            "若與該圖片所描述的內容符合，請選「O」；若不符合，請選「X」。"
        ),
        "questions": [
            {
                "question_ab": item.question_ab, "question_ch": item.question_ch,
                "audio": item.audio_url, "image": item.image_url, "answer": item.answer,
                "item_id": item.id,  # P5.3 題目品質分析用
            }
            for item in picked
        ],
    }


def build_choice_test_from_db(tribe):
    """組出中級「三選一圖片選擇題」的 part 資料，改讀資料庫（取代原本
    get_quiz_data 對 level=2 即時代理外部 API 的做法），只從
    status=published 的 QuizChoiceItem 抽。"""
    pool = list(QuizChoiceItem.objects.filter(tribe=tribe, status=QuizChoiceItem.STATUS_PUBLISHED))
    k = min(LEVEL2_QUESTION_COUNT, len(pool))
    picked = random.sample(pool, k)

    return {
        "type": "choice",
        "title": "第二部分：選擇題(一)",
        "intro": (
            "本部份共5題，每題有三個圖片，請依族語句子的語意，"
            "選一個與句子語意最相符的圖片。"
        ),
        "questions": [
            {
                "question_ab": item.question_ab, "question_ch": item.question_ch,
                "imageA": item.image_a_url, "imageB": item.image_b_url, "imageC": item.image_c_url,
                "answer": item.answer,
                "item_id": item.id,  # P5.3 題目品質分析用
            }
            for item in picked
        ],
    }


# 情境題每次抽幾題——跟 LEVEL1/LEVEL2_QUESTION_COUNT 同一種「對照官方介面
# 既有題量」精神抽個合理值，這是全新題型沒有既有介面可以對照，先跟初級/
# 中級一樣抽 5 題。
SITUATION_QUESTION_COUNT = 5


def build_situation_test_from_db(tribe):
    """組出「情境題」的 part 資料——P2 新增的 QuizSituationItem 到 P5.3 之前
    完全沒有學生端出題路徑（只有後台內容管理），這是第一次真的把它接上
    學生端。情境題不對應官方認證的 1-4 等級（見規劃文件 P5 §4(a)），故意
    不掛進 get_quiz_data 的 level_builders，用獨立的 get_situation_quiz_data
    端點供應，呼應「獨立練習入口、不掛在 level 1-4 系統裡」的既有決策。

    題庫全空時回傳空題目陣列而不是報錯——跟 build_matching_test_from_db／
    build_cloze_test_from_db 遇到題庫全空時的既有降級行為一致（見
    test_empty_vocab_pool_produces_zero_questions_not_error），前端
    ScenarioQuiz.jsx 已經有專屬的「目前沒有可練習的情境題」畫面接住這個
    情況。跟 _quiz_disabled_response() 的 403 是不同性質：那是管理者
    主動關閉，這裡是題庫本身還沒有內容，兩者不該用同一種「拒絕靜默」
    邏輯處理。"""
    pool = list(QuizSituationItem.objects.filter(tribe=tribe, status=QuizSituationItem.STATUS_PUBLISHED))
    k = min(SITUATION_QUESTION_COUNT, len(pool))
    picked = random.sample(pool, k)

    return {
        "type": "situation",
        "title": "情境對話練習",
        "intro": "本部份會描述一個生活情境，請從 4 個族語對話選項中選出最適合回應的一個。",
        "questions": [
            {
                "scenario_ch": item.scenario_chinese,
                "options": item.options,
                "answer": item.answer,
                "item_id": item.id,
            }
            for item in picked
        ],
    }


def _quiz_disabled_response(tribe):
    """族語測驗總開關（見 adminapi.models.FeatureFlag）——族語老師審定
    未完成前，管理者可以先關閉該族語的測驗，get_quiz_data／
    get_situation_quiz_data 共用同一份檢查。回 403 附清楚訊息，不是靜默
    回傳空題目陣列：空陣列會讓學生以為「題庫剛好是空的」，403 才能讓
    前端明確顯示「這個族語的測驗目前暫停開放」而不是誤導成系統故障。
    找不到對應 FeatureFlag 紀錄時視為未關閉（維持現況行為，見
    seed_feature_flags 管理指令的說明）。"""
    flag = FeatureFlag.objects.filter(key=f"quiz_enabled_{tribe}").first()
    if flag is not None and not flag.enabled:
        return JsonResponse({"detail": "這個族語的測驗目前暫停開放，請稍後再試。"}, status=403)
    return None


def get_situation_quiz_data(request):
    """情境題的獨立出題端點——跟 get_quiz_data 同一套認證/限流標準，
    但刻意不共用同一個 URL/函式：情境題沒有 level 概念，混進
    get_quiz_data 的 level 白名單檢查會讓語意變得混亂（level="5" 看起來
    像是官方認證的第五級，但情境題根本不是那個系統的一部分）。"""
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(
        request, decoded.get("uid", "anon"), group="get_situation_quiz_data", rate="30/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    tribe = request.GET.get("tribe", "tayal")
    if tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語: {tribe}"}, status=400)

    disabled_resp = _quiz_disabled_response(tribe)
    if disabled_resp:
        return disabled_resp

    display_name = TRIBE_MAP.get(tribe, tribe)
    format_data = {"chapter_name": display_name, "parts": [build_situation_test_from_db(tribe)]}
    return JsonResponse(format_data, safe=False)


#爬取線上測驗題目——四個等級皆已改用本地題庫（見上方 build_*_from_db 函式），
#不再即時代理外部 API
def get_quiz_data(request):
    # 會對外打第三方 API（無逾時風險）且完全沒有認證/限流保護，可被匿名重複呼叫，
    # 故加上登入 + 限流，與 CrosswordPuzzle.generate_crossword 同標準。
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(
        request, decoded.get("uid", "anon"), group="get_quiz_data", rate="30/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    #取得族語與等級，預設泰雅語/1
    tribe = request.GET.get("tribe", "tayal")
    level = request.GET.get("level", "1")

    if tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語: {tribe}"}, status=400)
    if level not in ("1", "2", "3", "4"):
        return JsonResponse({"detail": f"不支援的等級: {level}"}, status=400)

    disabled_resp = _quiz_disabled_response(tribe)
    if disabled_resp:
        return disabled_resp

    # 四個等級都已經改讀本地題庫（QuizTrueFalseItem／QuizChoiceItem／
    # QuizVocabItem／QuizClozePassage，見 adminapi/quizbank_views.py），
    # 不再即時代理外部 API（P2.5 遷移，見規劃文件）：中高級/高級是因為對方
    # API 對這兩級一律回傳 null；初級/中級則是因為對方是隨機出題、且長期
    # 依賴第三方網址有穩定性風險，兩種情況都改成「族語老師審定過的內容才
    # 會被抽到」。
    display_name = TRIBE_MAP.get(tribe, tribe)
    level_builders = {
        "1": build_true_false_test_from_db,
        "2": build_choice_test_from_db,
        "3": build_matching_test_from_db,
        "4": build_cloze_test_from_db,
    }
    format_data = {"chapter_name": display_name, "parts": [level_builders[level](tribe)]}
    return JsonResponse(format_data, safe=False)

# get_tayal_imformation（族語認證最新公告區塊）跟 get_exam_schedule（完整時程）
# 都需要解析 exam.sce.ntnu.edu.tw/abst/ 這同一個頁面，原本各自獨立 requests.get，
# 首頁一次載入等於對同一個外部網站發送兩次請求；雖然兩支各自有 15 分鐘快取，
# 但快取沒命中時（例如剛啟動後端、或剛好 TTL 過期）兩個請求會疊加，使用者會感覺
# 首頁載入變慢。這裡把「抓原始 HTML」抽成共用快取，兩支各自的解析邏輯不變，
# 只是不用各自重打一次外部網站。
EXAM_SITE_HTML_CACHE_KEY = "crawler_exam_site_html"
EXAM_SITE_HTML_CACHE_TTL = 900  # 15 分鐘，跟兩支端點自己的資料快取一致


def _fetch_exam_site_html(force_refresh=False):
    """回傳 exam.sce.ntnu.edu.tw/abst/ 的原始 HTML（有共用快取）。連線/逾時等例外
    交給呼叫端各自的 try/except 處理，這裡不吞例外。

    force_refresh=True 給後台「手動重爬」用：get_exam_schedule_data 的
    force_refresh 只略過它自己那層 EXAM_SCHEDULE_CACHE_KEY 快取，如果這裡
    的共用 HTML 快取還沒過期，_scrape_exam_schedule 內部呼叫的還是舊 HTML，
    對外實際上完全沒有重新請求——手動重爬必須連這一層也一起略過，才是
    真的重新爬一次，不是「看起來重爬、其實還是吃 15 分鐘前的內容」。
    """
    if not force_refresh:
        cached = cache.get(EXAM_SITE_HTML_CACHE_KEY)
        if cached is not None:
            return cached
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
    }
    res = requests.get("https://exam.sce.ntnu.edu.tw/abst/", headers=headers, timeout=_EXTERNAL_TIMEOUT)
    res.raise_for_status()
    cache.set(EXAM_SITE_HTML_CACHE_KEY, res.text, EXAM_SITE_HTML_CACHE_TTL)
    return res.text


# 爬取活動及族語認證資料（使用 tacp.gov.tw 官方 API）
NEWS_CACHE_KEY = "crawler_news_data"
NEWS_CACHE_TTL = 900  # 15 分鐘，避免每次開首頁都重新爬 tacp 公告 + 師大考試網站


def _safe_external_url(value):
    """只放行 http(s) 開頭的網址，其餘（含 javascript: 這類危險 scheme）一律
    丟棄成 None。這裡的網址最終會被存進 Announcement.link_url／
    cover_image_url，再由公開首頁當 <a href>／<img src> 渲染給任何訪客，
    跟 adminapi/serializers.py 的 validate_hero_link_url 是同一種威脅、
    同一種防法——差別是那邊擋的是後台人員自己填的值，這裡擋的是外部網站
    回傳的、我們無法控制的資料。"""
    if value and (value.startswith("http://") or value.startswith("https://")):
        return value
    return None


def _scrape_news(force_refresh=False):
    """實際去對外抓 tacp 活動消息 + 族語認證最新公告，不含 NEWS_CACHE_KEY
    這層快取。回傳 (data, error)：只要有一個來源這次有跑完（即使該來源本身
    回傳 0 筆），就仍視為部分成功，data 是目前抓到的清單、error 是 None；
    兩個來源都真的丟例外失敗，才回 (None, error)，跟 _scrape_exam_schedule
    同一種 (data, error) 回傳慣例，讓呼叫端不需要重寫一次 try/except 就能
    分辨「今天真的沒新聞」跟「爬蟲已經壞掉」。

    每筆資料多帶一個 source_key：crawler_sync.sync_crawler_announcements()
    拿它當「這則活動之前是不是已經匯入過」的去重鍵，依來源加上命名空間
    前綴（"tacp:<id>"／"ntnu-abst:<url>"），避免兩個來源的 id 剛好撞在一起；
    找不到穩定 id 的項目給 None，呼叫端會直接略過不匯入（無法安全去重）。
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "zh-TW",
    }

    data = []
    # 原本兩個來源都用 bare except 吞掉例外、只記 log 就繼續，最後一律回 200，
    # 呼叫端（前端首頁）沒辦法分辨「今天真的沒新聞」跟「爬蟲已經壞掉」。
    # 用這兩個旗標分別記錄「這個來源這次有沒有跑完」，只要有一個來源正常跑完
    # （即使該來源本身回傳 0 筆），就仍視為部分成功、回 200；只有兩個來源
    # 都真的丟例外失敗，才回 502 讓呼叫端知道整個功能目前不可用。
    tacp_ok = False
    exam_ok = False

    # 原住民族文化發展中心最新消息（官方 API）
    try:
        res = requests.get(
            "https://event.tacp.gov.tw/api/frontend/announcements/latest",
            headers=headers,
            timeout=_EXTERNAL_TIMEOUT
        )
        # 原本用 if res.status_code == 200 判斷要不要解析內容，但 tacp_ok = True
        # 寫在 if 區塊外面，不管狀態碼是不是 200 都會執行到——TACP 回傳
        # 500/403 等非 200 時不會進到解析區塊、data 完全沒有新增，但
        # tacp_ok 仍然被設成 True，等於「上游全面故障」被誤判成「正常但
        # 沒有新資料」，連續失敗告警與同步狀態頁都會失真（獨立審查找到的
        # 問題）。改用 raise_for_status()，非 2xx 直接丟例外，交給下面的
        # except 處理，tacp_ok 只在真正解析成功後才會是 True。
        res.raise_for_status()
        result = res.json()
        for item in result.get("data", []):
            import json as _json
            raw_images = item.get("images", [])
            images = _json.loads(raw_images) if isinstance(raw_images, str) else raw_images
            img_url = images[0].get("url") if isinstance(images, list) and images and isinstance(images[0], dict) else None
            item_id = item.get("id")
            data.append({
                "title": item.get("title"),
                "detail": _safe_external_url(f"https://www.tacp.gov.tw/news/{item.get('category_id')}/{item_id}"),
                "image": _safe_external_url(img_url),
                "start_date": item.get("start_date") or item.get("published_at"),
                "end_date": item.get("end_date"),
                "tag": item.get("category", {}).get("title") if isinstance(item.get("category"), dict) else None,
                "isExam": "F",
                "source_key": f"tacp:{item_id}" if item_id is not None else None,
            })
        tacp_ok = True
    except Exception as e:
        logger.error("tacp API error: %s", e)

    # 族語認證（師範大學原住民族語言認證考試）
    try:
        url_exam = "https://exam.sce.ntnu.edu.tw/abst/"
        soup_exam = BeautifulSoup(_fetch_exam_site_html(force_refresh=force_refresh), "html.parser")
        count = 0
        for info in soup_exam.select(".pnlArticles li"):
            if count >= 5:
                break
            date_tag = info.select_one("small")
            date = date_tag.get_text(strip=True) if date_tag else None
            detail_tag = info.select_one("a")
            title = detail_tag.get_text(strip=True) if detail_tag else None
            href = detail_tag.get("href") if detail_tag else None
            # urljoin 正確處理相對路徑（原本的字串接法 url_exam + href 在
            # href 本身是絕對路徑「/abst/x」時會產生重複路徑），但如果上游
            # HTML 被竄改成 href="javascript:..." 這類危險 scheme，urljoin
            # 對絕對 scheme 會直接回傳原值、不會被 base 蓋掉——所以還是要靠
            # _safe_external_url 再擋一層，不能只換掉字串拼接就當作修好了。
            detail = _safe_external_url(urljoin(url_exam, href)) if href else None
            data.append({
                "title": title,
                "detail": detail,
                "image": None,
                "start_date": date,
                "end_date": None,
                "tag": None,
                "isExam": "T",
                "source_key": f"ntnu-abst:{detail}" if detail else None,
            })
            count += 1
        exam_ok = True
    except Exception as e:
        logger.error("exam API error: %s", e)

    if not tacp_ok and not exam_ok:
        return None, "最新消息暫時無法取得，請稍後再試"

    return data, None


def get_news_data(force_refresh=False):
    """回傳新聞資料（含 NEWS_CACHE_KEY 這層 15 分鐘快取），data 為 None 代表
    這次爬取失敗。force_refresh=True 略過快取，強制重新爬一次（後台「同步
    爬蟲活動」用），並依樣把 force_refresh 往下傳給 _fetch_exam_site_html，
    否則共用的官網 HTML 快取沒過期時，看起來重爬、其實還是吃舊內容
    （同一個坑 get_exam_schedule_data 的說明已經記過一次）。"""
    if not force_refresh:
        cached = cache.get(NEWS_CACHE_KEY)
        if cached is not None:
            return cached

    data, error = _scrape_news(force_refresh=force_refresh)
    if data is None:
        logger.error("get_news_data 爬取失敗: %s", error)
        return None

    cache.set(NEWS_CACHE_KEY, data, NEWS_CACHE_TTL)
    return data


def get_tayal_imformation(request):
    """首頁新聞（族語認證最新公告 + tacp 活動消息）公開端點。

    注意：新增「爬蟲內容匯入後台公告」機制（見 adminapi/crawler_sync.py）
    之後，首頁本身已改為只讀 /adminapi/public/announcements/，不再直接打
    這支端點——這支端點刻意保留，供後台「同步爬蟲活動」與直接驗證爬蟲
    目前實際抓到什麼內容使用，不是死代碼。
    """
    # 維持公開（不要求登入），但仍加 IP 限流防止匿名濫用；已有 15 分鐘快取，
    # 即使被打穿限流，實際對外部網站的請求量也有上限。
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited_resp = _rate_limited_response(
        request, client_ip, group="get_tayal_imformation", rate="60/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    data = get_news_data()
    if data is None:
        return JsonResponse({"detail": "最新消息暫時無法取得，請稍後再試"}, status=502)

    return JsonResponse(data, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})


# 族語認證考試時程（取代首頁原本寫死在前端 dateReminder.jsx 的 examSchedule 假資料）。
# 官網日程表本身就是一份乾淨的靜態 HTML table，每列是「期程名稱 + 可加入 Google
# 行事曆的連結」，連結的 dates= 參數就是機讀的 YYYYMMDDTHHMMSS 起訖時間，不需要
# 自己解析民國年中文日期文字，直接從這個參數取值最穩定。
EXAM_SCHEDULE_CACHE_KEY = "crawler_exam_schedule_data"
EXAM_SCHEDULE_CACHE_TTL = 900  # 15 分鐘，跟 news 一致

# 官方日程表的期程名稱 -> 前端沿用的簡短 phase 代稱（對應 dateReminder.jsx 的 icon/連結判斷）
EXAM_SCHEDULE_PHASE_MAP = {
    "報名日期": "報名",
    "准考證下載、寄發": "准考證",
    "測驗日期": "測驗",
    "成績公告日期": "成績",
    "申請成績複查": "複查",
    "寄發成績通知單": "成績單寄發",
    "寄發合格證書": "證書",
}


def _scrape_exam_schedule(force_refresh=False):
    """實際去對外抓 + 解析考試時程，不含 EXAM_SCHEDULE_CACHE_KEY 這層快取、
    不含狀態記錄、不套用覆寫。

    回傳 (data, error)：成功時 error 是 None；失敗（連線錯誤或解析不出任何
    期程）時 data 是 None、error 是可讀的失敗原因字串。用回傳值而不是丟例外，
    因為呼叫端（公開端點、後台重爬端點）都需要同一套「失敗時記錄原因」的
    邏輯，用例外的話兩邊各自要重寫一次 try/except。
    """
    try:
        html = _fetch_exam_site_html(force_refresh=force_refresh)
    except requests.RequestException as e:
        return None, f"上游請求失敗：{e}"

    soup = BeautifulSoup(html, "html.parser")

    # 官網目前置頂顯示的梯次（排除「最新消息」tab 後的第一個），日程表在同一個
    # tab-pane 底下的 table 裡；用官網目前把「最新消息」排在最前面、後面接梯次
    # tab 的既有頁面結構，選第一個梯次 tab 取得標題文字。
    session_tab = soup.select_one(".nav-tabs button.nav-link[id$='-tab']:not(#news-tab)")
    session_name = session_tab.get_text(strip=True) if session_tab else None

    phases = []
    table_body = soup.select_one(".tab-pane table tbody")
    if table_body:
        for row in table_body.select("tr"):
            label_el = row.select_one("td span.fw-bold")
            link_el = row.select_one("td a[href*='dates=']")
            if not label_el or not link_el:
                continue
            m = re.search(r"dates=(\d{8}T\d{6})/(\d{8}T\d{6})", link_el.get("href", ""))
            if not m:
                continue
            label = label_el.get_text(strip=True)
            start_dt = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
            end_dt = datetime.strptime(m.group(2), "%Y%m%dT%H%M%S")
            phases.append({
                "phase": EXAM_SCHEDULE_PHASE_MAP.get(label, label),
                "label": label,
                "start_date": start_dt.date().isoformat(),
                "end_date": end_dt.date().isoformat() if end_dt.date() != start_dt.date() else None,
            })

    if not phases:
        return None, "解析結果為空（官網頁面結構可能已變更）"

    return {"source_url": "https://exam.sce.ntnu.edu.tw/abst/", "session": session_name, "phases": phases}, None


def get_exam_schedule_data(force_refresh=False):
    """回傳爬蟲抓到的原始資料（data 為 None 代表這次爬取失敗），不套用後台
    覆寫——覆寫一律由呼叫端透過 apply_exam_schedule_overrides() 疊加，
    確保覆寫永遠讀最新狀態，不會被 15 分鐘的爬蟲快取一起卡住。

    force_refresh=True 時略過快取，強制重新爬一次（後台「手動重爬」用）。
    只有真的觸發爬取（快取沒命中，或 force_refresh）才更新
    ExamScheduleCrawlStatus，單純的快取命中不算一次「爬蟲執行」。
    """
    if not force_refresh:
        cached = cache.get(EXAM_SCHEDULE_CACHE_KEY)
        if cached is not None:
            return cached

    data, error = _scrape_exam_schedule(force_refresh=force_refresh)
    status = ExamScheduleCrawlStatus.load()
    if data is None:
        logger.error("get_exam_schedule 爬取失敗: %s", error)
        status.record_failure(error)
        return None

    status.record_success()
    cache.set(EXAM_SCHEDULE_CACHE_KEY, data, EXAM_SCHEDULE_CACHE_TTL)
    return data


def apply_exam_schedule_overrides(phases):
    """把生效中（is_active=True）的人工覆寫套進爬到的 phases 清單：phase
    代稱相同就取代該筆，爬蟲沒抓到的 phase（例如剛好爬蟲失敗、或官網當下
    真的沒有這個期程）則附加在後面。回傳新的 list，不修改傳入的參數。
    """
    merged = list(phases)
    index_by_phase = {p["phase"]: i for i, p in enumerate(merged)}
    for override in ExamScheduleOverride.objects.filter(is_active=True):
        entry = {
            "phase": override.phase,
            "label": override.label or override.phase,
            "start_date": override.start_date.isoformat(),
            "end_date": override.end_date.isoformat() if override.end_date else None,
        }
        if override.phase in index_by_phase:
            merged[index_by_phase[override.phase]] = entry
        else:
            merged.append(entry)
    return merged


def get_exam_schedule(request):
    # 首頁行事曆維持公開（不要求登入），比照 get_tayal_imformation 加 IP 限流 + 快取。
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited_resp = _rate_limited_response(
        request, client_ip, group="get_exam_schedule", rate="60/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    data = get_exam_schedule_data()

    if data is None:
        # 爬蟲這次失敗，但如果後台有人工鎖定的期程資料，仍然可以只靠覆寫
        # 資料撐住畫面，不用整個 502——這正是「覆寫」這個功能存在的意義：
        # 官網改版讓爬蟲解析不出結果時，後台填過的資料還是能正常顯示。
        override_only = apply_exam_schedule_overrides([])
        if not override_only:
            return JsonResponse({"detail": "考試時程暫時無法取得，請稍後再試"}, status=502)
        fallback = {"source_url": "https://exam.sce.ntnu.edu.tw/abst/", "session": None, "phases": override_only}
        return JsonResponse(fallback, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})

    merged = {**data, "phases": apply_exam_schedule_overrides(data["phases"])}
    return JsonResponse(merged, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})
