import json
import requests
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from bs4 import BeautifulSoup

router = APIRouter()

BASE_URL = "https://e-dictionary.ilrdf.org.tw"

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
        content["word_audio"] = f"{BASE_URL}{word_audio['src']}" if word_audio and word_audio.has_attr("src") else None
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
            example_data["ex_tay_audio"] = f"{BASE_URL}{ex_tay_audio['src']}" if ex_tay_audio and ex_tay_audio.has_attr("src") else None

            examples.append(example_data)
        
        word_data["examples"] = examples
        content["defins"].append(word_data)
    
    return content

def query(keyword):
    """ 發送請求並爬取 Tayal 詞彙的內容 """
    cookie_value = "{\"til\":\"tay\",\"words\":\"@@\",\"isRelatedSantance\":false,\"charS\":\"0\",\"charE\":\"0\",\"category\":\"\",\"frequency\":\"\",\"dialect\":\"\",\"search\":\"\",\"source\":\"\",\"sourceYear\":null,\"filterDesc\":null,\"page\":1,\"crossTribes\":false}"
    cookie_value = cookie_value.replace("@@", misencode_word(keyword))

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
    response = session.get(url, headers=headers)
    soup = BeautifulSoup(response.text, 'html5lib')

    # 找到第一個詞彙連結
    res = soup.find('div', class_="area_block bg-white panel1")
    link_tag = res.find("a", href=True) if res else None

    if link_tag:
        word_url = f"{BASE_URL}{link_tag['href']}"
        word_response = session.get(word_url)
        word_soup = BeautifulSoup(word_response.text, 'html5lib')
        return parse_word_html(word_soup)
    
    return None

@router.post("/dictionary/")
async def search_tayal_dictionary(request: Request):
    """ 查詢 Tayal 字典 API """
    try:
        data = await request.json()
        words = data.get("words", [])

        if not words:
            return JSONResponse({"error": "查詢字詞不可為空"}, status_code=400)

        results = {word: query(word) for word in words}

        return JSONResponse({"definitions": results}, status_code=200)

    except json.JSONDecodeError:
        return JSONResponse({"error": "無效的 JSON 格式"}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)