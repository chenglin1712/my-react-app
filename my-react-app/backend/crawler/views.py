import logging
import re
from datetime import datetime
import requests
from django.core.cache import cache
from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited
from bs4 import BeautifulSoup
from . import tayal_bank
from . import amis_bank
from . import bunun_bank
from . import kavalan_bank
from . import paiwan_bank
from config.firebase_auth import verify_firebase_token

logger = logging.getLogger(__name__)

# 外部 API 呼叫的逾時秒數（get_quiz_data 原本完全沒設，一個掛住的上游請求
# 會佔用 worker 到系統預設逾時甚至永遠不回應）。
_EXTERNAL_TIMEOUT = 10

# get_quiz_data 第 1/2 級題目原本每次都重打第三方 API（get_tayal_imformation
# 的新聞已有 15 分鐘快取，這裡原本沒有）。同一 tribe+level 組合對應同一份固定
# 題庫（start_exam 只依 dialect_id/level 決定內容，非個人化、非隨機），快取
# 可以直接降低對第三方站的請求量，也降低被當成打第三方 API 的放大器的風險。
_QUIZ_DATA_CACHE_TTL = 900


def _rate_limited_response(request, key, group, rate, method):
    """依 key（已登入使用者 uid 或 IP）限速，邏輯與 AIModel/views.py 一致。"""
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: key,
        rate=rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None

# 各族語對應的官方練習介面 dialect_id、顯示名稱、以及中高級/高級本地題庫的
# 選題公式進入點。要新增族語時只需在這裡多加一個 key，不用動 get_quiz_data 邏輯。
TRIBE_CONFIG = {
    "tayal": {
        "dialect_id": 6,
        "display_name": "泰雅語 - 賽考利克泰雅語",
        "matching_test": tayal_bank.build_matching_test,
        "cloze_test": tayal_bank.build_cloze_test,
    },
    "amis": {
        "dialect_id": 2,
        "display_name": "阿美語 - 秀姑巒阿美語",
        "matching_test": amis_bank.build_matching_test,
        "cloze_test": amis_bank.build_cloze_test,
    },
    "bunun": {
        "dialect_id": 22,
        "display_name": "布農語 - 郡群布農語",
        "matching_test": bunun_bank.build_matching_test,
        "cloze_test": bunun_bank.build_cloze_test,
    },
    "kavalan": {
        "dialect_id": 34,
        "display_name": "噶瑪蘭語 - 噶瑪蘭語",
        "matching_test": kavalan_bank.build_matching_test,
        "cloze_test": kavalan_bank.build_cloze_test,
    },
    "paiwan": {
        "dialect_id": 25,
        "display_name": "排灣語 - 中排灣語",
        "matching_test": paiwan_bank.build_matching_test,
        "cloze_test": paiwan_bank.build_cloze_test,
    },
}

#爬取線上測驗題目(初級/中級)，中高級/高級改用本地題庫（見下方說明）
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

    config = TRIBE_CONFIG.get(tribe)
    if not config:
        return JsonResponse({"detail": f"不支援的族語: {tribe}"}, status=400)

    # 中高級(3)、高級(4)：官方練習介面 start_exam 對這兩個等級一律回傳
    # part1~part4 = null（實測過阿美語 dialect_id 1~5、泰雅語 dialect_id 1~10
    # 皆同），代表該 demo API 根本沒有開放這兩級的題目資料，因此不打外部API，
    # 改走本地題庫的選題公式（tayal_bank.py／amis_bank.py 內有完整命題邏輯說明）。
    if level == "3":
        format_data = {"chapter_name": config["display_name"], "parts": [config["matching_test"]()]}
        return JsonResponse(format_data, safe=False)
    elif level == "4":
        format_data = {"chapter_name": config["display_name"], "parts": [config["cloze_test"]()]}
        return JsonResponse(format_data, safe=False)
    elif level not in ("1", "2"):
        return JsonResponse({"detail": f"不支援的等級: {level}"}, status=400)

    cache_key = f"crawler_quiz_data:{tribe}:{level}"
    cached = cache.get(cache_key)
    if cached is not None:
        return JsonResponse(cached, safe=False)

    url = f"https://api.lokahsu.org.tw/api/front_end/start_exam?dialect_id={config['dialect_id']}&level={level}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    try:
        response = requests.get(url, headers=headers, timeout=_EXTERNAL_TIMEOUT)
    except requests.RequestException as e:
        logger.error("get_quiz_data 上游請求失敗: %s", e)
        return JsonResponse({"detail": "讀取資料失敗，請稍後再試"}, status=502)

    if response.status_code == 200:
        data = response.json()

        if level == "1":
            format_data = format_quiz_data_1(data)
        else:
            format_data = format_quiz_data_2(data)
        cache.set(cache_key, format_data, _QUIZ_DATA_CACHE_TTL)
        return JsonResponse(format_data, safe=False)
    else:
        return JsonResponse({"detail": "讀取資料失敗"}, status=500)

#把爬的資料用成我要的格式(第一部分)
def format_quiz_data_1(data):
    format_data = {
        "chapter_name":data["data"]["display_dialect_name"],
        "parts":[]
    }
    part1 = data["data"]["part1"]
    format_part1 = {
        "type": "true_false",
        "title": part1["title"],
        "intro": part1["intro"],
        "questions":[
            {
                "question_ab" : question["question_ab"],
                "question_ch": question["question_ch"],
                "audio" : question["audio"],
                "image": question["image"],
                "answer": part1["answers"][index]
            }
            for index, question in enumerate(part1["questions"])
        ]
    }
    format_data["parts"].append(format_part1)
    return format_data

def format_quiz_data_2(data):
    format_data = {
        "chapter_name": data["data"]["display_dialect_name"],
        "parts": []
    }

    part2 = data["data"].get("part2")
    if not part2:
        return format_data

    questions_raw = part2.get("questions", [])
    answers_raw = part2.get("answers", [])

    format_part2 = {
        "type": "choice",
        "title": part2.get("title", "第二部分：選擇題"),
        "intro": part2.get("intro", ""),
        "questions": [
            {
                "question_ab": q.get("question_ab", ""),
                "question_ch": q.get("question_ch", ""),
                "audio": q.get("audio", ""),
                "imageA": q.get("imageA") or q.get("image_a", ""),
                "imageB": q.get("imageB") or q.get("image_b", ""),
                "imageC": q.get("imageC") or q.get("image_c", ""),
                "answer": answers_raw[i] if i < len(answers_raw) else "",
            }
            for i, q in enumerate(questions_raw)
        ]
    }
    format_data["parts"].append(format_part2)
    return format_data

# get_tayal_imformation（族語認證最新公告區塊）跟 get_exam_schedule（完整時程）
# 都需要解析 exam.sce.ntnu.edu.tw/abst/ 這同一個頁面，原本各自獨立 requests.get，
# 首頁一次載入等於對同一個外部網站發送兩次請求；雖然兩支各自有 15 分鐘快取，
# 但快取沒命中時（例如剛啟動後端、或剛好 TTL 過期）兩個請求會疊加，使用者會感覺
# 首頁載入變慢。這裡把「抓原始 HTML」抽成共用快取，兩支各自的解析邏輯不變，
# 只是不用各自重打一次外部網站。
EXAM_SITE_HTML_CACHE_KEY = "crawler_exam_site_html"
EXAM_SITE_HTML_CACHE_TTL = 900  # 15 分鐘，跟兩支端點自己的資料快取一致


def _fetch_exam_site_html():
    """回傳 exam.sce.ntnu.edu.tw/abst/ 的原始 HTML（有共用快取）。連線/逾時等例外
    交給呼叫端各自的 try/except 處理，這裡不吞例外。"""
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


def get_tayal_imformation(request):
    # 首頁新聞維持公開（不要求登入），但仍加 IP 限流防止匿名濫用；已有 15 分鐘
    # 快取，即使被打穿限流，實際對外部網站的請求量也有上限。
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited_resp = _rate_limited_response(
        request, client_ip, group="get_tayal_imformation", rate="60/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    cached = cache.get(NEWS_CACHE_KEY)
    if cached is not None:
        return JsonResponse(cached, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})

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
        if res.status_code == 200:
            result = res.json()
            for item in result.get("data", []):
                import json as _json
                raw_images = item.get("images", [])
                images = _json.loads(raw_images) if isinstance(raw_images, str) else raw_images
                img_url = images[0].get("url") if isinstance(images, list) and images and isinstance(images[0], dict) else None
                data.append({
                    "title": item.get("title"),
                    "detail": f"https://www.tacp.gov.tw/news/{item.get('category_id')}/{item.get('id')}",
                    "image": img_url,
                    "start_date": item.get("start_date") or item.get("published_at"),
                    "end_date": item.get("end_date"),
                    "tag": item.get("category", {}).get("title") if isinstance(item.get("category"), dict) else None,
                    "isExam": "F"
                })
        tacp_ok = True
    except Exception as e:
        logger.error("tacp API error: %s", e)

    # 族語認證（師範大學原住民族語言認證考試）
    try:
        url_exam = "https://exam.sce.ntnu.edu.tw/abst/"
        soup_exam = BeautifulSoup(_fetch_exam_site_html(), "html.parser")
        count = 0
        for info in soup_exam.select(".pnlArticles li"):
            if count >= 5:
                break
            date_tag = info.select_one("small")
            date = date_tag.get_text(strip=True) if date_tag else None
            detail_tag = info.select_one("a")
            title = detail_tag.get_text(strip=True) if detail_tag else None
            detail = url_exam + detail_tag["href"] if detail_tag else None
            data.append({
                "title": title,
                "detail": detail,
                "image": None,
                "start_date": date,
                "end_date": None,
                "tag": None,
                "isExam": "T"
            })
            count += 1
        exam_ok = True
    except Exception as e:
        logger.error("exam API error: %s", e)

    if not tacp_ok and not exam_ok:
        return JsonResponse({"detail": "最新消息暫時無法取得，請稍後再試"}, status=502)

    cache.set(NEWS_CACHE_KEY, data, NEWS_CACHE_TTL)
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


def get_exam_schedule(request):
    # 首頁行事曆維持公開（不要求登入），比照 get_tayal_imformation 加 IP 限流 + 快取。
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited_resp = _rate_limited_response(
        request, client_ip, group="get_exam_schedule", rate="60/m", method="GET"
    )
    if limited_resp:
        return limited_resp

    cached = cache.get(EXAM_SCHEDULE_CACHE_KEY)
    if cached is not None:
        return JsonResponse(cached, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})

    try:
        html = _fetch_exam_site_html()
    except requests.RequestException as e:
        logger.error("get_exam_schedule 上游請求失敗: %s", e)
        return JsonResponse({"detail": "考試時程暫時無法取得，請稍後再試"}, status=502)

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
        return JsonResponse({"detail": "考試時程暫時無法取得，請稍後再試"}, status=502)

    data = {"source_url": "https://exam.sce.ntnu.edu.tw/abst/", "session": session_name, "phases": phases}
    cache.set(EXAM_SCHEDULE_CACHE_KEY, data, EXAM_SCHEDULE_CACHE_TTL)
    return JsonResponse(data, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})
