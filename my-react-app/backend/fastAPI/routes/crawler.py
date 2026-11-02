"""即時爬取 ILRDF 線上辭典網站（e-dictionary.ilrdf.org.tw）的詞彙查詢頁面，
直接解析回傳的 HTML（parse_word_html）取得詞義/例句/音檔連結。

跟 routes/dictionary/ 套件的差異：dictionary/ 查的是本機 dictionary.db
（ILRDF 資料已預先同步進來的 SQLite 副本），是主要辭典搜尋功能（前端 /search
頁面）實際在用的路徑，走行程內快取，不必每次都對外發請求。這支檔案則是每次
呼叫都即時對 ILRDF 網站送出請求＋解析 HTML，用於本機 DB 還沒收錄、需要直接
從來源網站現查的情境；目前前端沒有呼叫這支端點（無對應的 fetch 呼叫），是
獨立於主要搜尋功能之外、供手動查驗或未來收錄新詞彙用的輔助工具。
"""
import json
import asyncio
import logging
from urllib.parse import urljoin, urlparse

import requests
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from bs4 import BeautifulSoup

from fastAPI import rate_limit_config
from fastAPI.rate_limit import limiter

router = APIRouter()
logger = logging.getLogger(__name__)

BASE_URL = "https://e-dictionary.ilrdf.org.tw"
_SITE_HOST = "e-dictionary.ilrdf.org.tw"
# 網站自己的重新導向最多跟幾跳（每一跳都重新檢查主機）
_MAX_REDIRECTS = 3


def site_url(href):
    """把網頁裡取出的連結組成完整網址，只接受 ILRDF 辭典網站自己的 https 網址，其餘回傳 None。

    稽核 FIL-3：原本是 f"{BASE_URL}{href}"，href 以 "@" 開頭時（"https://e-dictionary.ilrdf.org.tw@evil.test/"）
    實際主機會變成 evil.test；用 urljoin 解析後再比對主機，這類寫法與 "//evil.test/x" 之類的絕對網址都會被擋下。"""
    if not isinstance(href, str) or not href.strip():
        return None
    # 反斜線與控制字元：Python 的 urlparse、urllib3 與瀏覽器對它們的解讀不一致，這種連結不可能是正常的站內連結
    if "\\" in href or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in href.strip()):
        return None
    try:
        joined = urljoin(BASE_URL + "/", href.strip())
        parsed = urlparse(joined)
        port = parsed.port
    except ValueError:
        return None
    if (parsed.scheme != "https" or parsed.hostname != _SITE_HOST or port not in (None, 443)
            or parsed.username is not None or parsed.password is not None):
        return None
    return joined


def build_search_cookie(keyword):
    """組出查詢用的 cookie 值。用 json.dumps 產生 JSON，關鍵字裡的引號、反斜線、控制字元都會被跳脫，
    不能再跳出字串去改動其他欄位（稽核 FIL-3；原本是對字串做 replace）。

    格式刻意與原本的字串一致（無空白的緊湊分隔、非 ASCII 字元照原樣保留）。另外把分號換成 \\u003b：
    JSON 解析後是同一個字元，但 Cookie 標頭裡的分號會被當成下一個 cookie 的開頭。"""
    value = {
        "til": "tay", "words": misencode_word(keyword), "isRelatedSantance": False, "charS": "0", "charE": "0",
        "category": "", "frequency": "", "dialect": "", "search": "", "source": "", "sourceYear": None,
        "filterDesc": None, "page": 1, "crossTribes": False,
    }
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(";", "\\u003b")


def _get_within_site(session, url, **kwargs):
    """GET 並自己處理重新導向：requests 預設會跟著導去任何主機，這裡每一跳都重新用 site_url 檢查。
    被導去網站以外的地方、或跳數太多就回傳 None。"""
    for _ in range(_MAX_REDIRECTS + 1):
        response = session.get(url, allow_redirects=False, **kwargs)
        if not response.is_redirect:
            return response
        url = site_url(response.headers.get("Location", ""))
        if url is None:
            return None
    return None

# 每個字都會對 ILRDF 網站發 2 次外部請求（query() 內部：先查搜尋列表頁，
# 再抓字詞詳情頁），且都丟進 loop.run_in_executor 的全域預設執行緒池執行
# （跟其他請求共用）。沒有上限的話，帶一個超大的 words 陣列就能對外部字典站
# 發起放大請求，同時占滿本機執行緒池。
MAX_WORDS_PER_REQUEST = 20

def misencode_word(word: str) -> str:
    """ 將詞彙進行錯誤編碼，模擬網站請求格式 """
    try:
        return word.encode('utf-8').decode('latin-1')
    except Exception as e:
        return f"Encoding error: {e}"

def parse_word_html(soup):
    content = {}

    # 詞彙名稱
    try:
        word_tayal = soup.find(id="ctl00_CPH_content_WUC_DTYcontent_TribesName")
        content["word_tayal"] = word_tayal.text.strip() if word_tayal else "未找到"
        
        # 抓取詞彙的音頻
        word_audio = soup.find("audio")
        content["word_audio"] = site_url(word_audio["src"]) if word_audio and word_audio.has_attr("src") else None
    except Exception as e:
        content["word_tayal"] = f"未找到，錯誤: {str(e)}"
    
    # 詞頻
    try:
        word_fre = soup.select_one(".term_area span")
        content["word_fre"] = word_fre.text.strip() if word_fre else "未找到"
    except Exception as e:
        content["word_fre"] = f"未找到，錯誤: {str(e)}"
    
    # 詞語分類
    try:
        term_area = soup.find_all(class_="term_area")
        word_str = term_area[0].find_all("li") if term_area else []
        content["word_str"] = word_str[1].text.strip() if len(word_str) > 1 else "未找到"
    except Exception as e:
        content["word_str"] = f"未找到，錯誤: {str(e)}"
    
    # 定義與範例
    content["defins"] = []
    definitions = soup.find_all(class_="defin")
    
    for defin in definitions:
        word_data = {}
        spans = defin.find_all("span")
        lis = defin.find_all(class_="term_list")

        # 中文定義
        word_data["word_ch"] = spans[1].text.strip() if len(spans) > 1 else "未找到"
        
        # 詞類
        word_data["word_cate"] = lis[0].text.replace("詞類：", "").replace("範疇分類：", "").strip() if lis else "未找到"

        # 例句與音頻
        examples = []
        stcs = defin.find_all(class_="stc")  # 例句 Tayal
        trans = defin.find_all(class_="trans")  # 例句翻譯 Chinese
        
        for x in range(len(trans)):
            example_data = {}

            ex_tay_audio = stcs[x].find("audio")
            # 例句文本
            for tag in stcs[x](["audio", "script"]):  # 移除不必要的標籤
                tag.extract()
            example_data["ex_tay"] = stcs[x].text.strip() if stcs[x] else "未找到"
            example_data["ex_ch"] = trans[x].text.strip() if trans[x] else "未找到"

            # 例句音頻
            example_data["ex_tay_audio"] = site_url(ex_tay_audio["src"]) if ex_tay_audio and ex_tay_audio.has_attr("src") else None

            examples.append(example_data)
        
        word_data["examples"] = examples
        content["defins"].append(word_data)
    
    return content

def query(keyword):
    """ 發送請求並爬取 Tayal 詞彙的內容 """
    cookie_value = build_search_cookie(keyword)

    session = requests.Session()
    session.cookies.set(
        "e-dictionary_SsingCon",
        cookie_value,
        domain="e-dictionary.ilrdf.org.tw",
        path="/"
    )

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0"
    }

    # 取得查詢結果頁面
    url = f"{BASE_URL}/tay/search/list.htm"
    response = _get_within_site(session, url, headers=headers, timeout=10)
    if response is None:
        return None
    soup = BeautifulSoup(response.text, 'html5lib')

    # 找到第一個詞彙連結
    res = soup.find('div', class_="area_block bg-white panel1")
    link_tag = res.find("a", href=True) if res else None

    word_url = site_url(link_tag["href"]) if link_tag else None
    if word_url:
        word_response = _get_within_site(session, word_url, timeout=10)
        if word_response is None:
            return None
        word_soup = BeautifulSoup(word_response.text, 'html5lib')
        return parse_word_html(word_soup)
    
    return None

@router.post("/dictionary/")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("crawler_search_tayal_dictionary", "10/minute"))  # 對外部網站的放大請求，比照 vision.py 呼叫外部 API 的保守限流
async def search_tayal_dictionary(request: Request):
    """ 查詢 Tayal 字典 API """
    try:
        data = await request.json()
        words = data.get("words", [])

        if not words:
            return JSONResponse({"detail": "查詢字詞不可為空"}, status_code=400)
        if len(words) > MAX_WORDS_PER_REQUEST:
            return JSONResponse(
                {"detail": f"一次最多查詢 {MAX_WORDS_PER_REQUEST} 個字詞"},
                status_code=400,
            )

        loop = asyncio.get_event_loop()
        tasks = [loop.run_in_executor(None, query, word) for word in words]
        results_list = await asyncio.gather(*tasks)
        results = dict(zip(words, results_list))

        return JSONResponse({"definitions": results}, status_code=200)

    except json.JSONDecodeError:
        return JSONResponse({"detail": "無效的 JSON 格式"}, status_code=400)
    except Exception as e:
        # 原本直接把 str(e) 回給前端，可能洩漏爬蟲實作細節（目標網站結構、
        # 內部路徑等）；跟 dictionary.py 等其他端點的修正同一套做法，改成只
        # 記 log，回傳通用訊息。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)