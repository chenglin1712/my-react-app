"""外部來源爬取——首頁最新消息（tacp 活動 + 族語認證公告）跟族語認證考試
時程，從 crawler/views.py 抽出來（P4 review BE-16）。兩者共用同一個
exam.sce.ntnu.edu.tw/abst/ 頁面的原始 HTML 快取（見 _fetch_exam_site_html），
放在同一個模組裡才能自然共用這層快取，不需要額外的跨模組協調。這裡的
函式全部吃純值、回傳純值（或 (data, error) tuple），不碰 Django
HttpRequest/JsonResponse——那是 views.py 的事。
"""
import logging
import re
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from django.core.cache import cache

from adminapi.exam_schedule_service import (
    get_active_schedule_overrides, record_crawl_failure, record_crawl_success,
)

logger = logging.getLogger(__name__)

# 外部 API 呼叫的逾時秒數（get_quiz_data 原本完全沒設，一個掛住的上游請求
# 會佔用 worker 到系統預設逾時甚至永遠不回應）。
_EXTERNAL_TIMEOUT = 10

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
    if data is None:
        logger.error("get_exam_schedule 爬取失敗: %s", error)
        record_crawl_failure(error)
        return None

    record_crawl_success()
    cache.set(EXAM_SCHEDULE_CACHE_KEY, data, EXAM_SCHEDULE_CACHE_TTL)
    return data


def apply_exam_schedule_overrides(phases):
    """把生效中（is_active=True）的人工覆寫套進爬到的 phases 清單：phase
    代稱相同就取代該筆，爬蟲沒抓到的 phase（例如剛好爬蟲失敗、或官網當下
    真的沒有這個期程）則附加在後面。回傳新的 list，不修改傳入的參數。
    """
    merged = list(phases)
    index_by_phase = {p["phase"]: i for i, p in enumerate(merged)}
    for override in get_active_schedule_overrides():
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
