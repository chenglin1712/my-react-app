import requests
from django.http import JsonResponse
from bs4 import BeautifulSoup
from . import tayal_bank
from . import amis_bank
from . import bunun_bank
from . import kavalan_bank

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
}

#爬取線上測驗題目(初級/中級)，中高級/高級改用本地題庫（見下方說明）
def get_quiz_data(request):
    #取得族語與等級，預設泰雅語/1
    tribe = request.GET.get("tribe", "tayal")
    level = request.GET.get("level", "1")

    config = TRIBE_CONFIG.get(tribe)
    if not config:
        return JsonResponse({"Error": f"不支援的族語: {tribe}"}, status=400)

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
        return JsonResponse({"Error": f"不支援的等級: {level}"}, status=400)

    url = f"https://api.lokahsu.org.tw/api/front_end/start_exam?dialect_id={config['dialect_id']}&level={level}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    response = requests.get(url,headers=headers)

    if response.status_code == 200:
        data = response.json()

        if level == "1":
            format_data = format_quiz_data_1(data)
        else:
            format_data = format_quiz_data_2(data)
        return JsonResponse(format_data, safe=False)
    else:
        return JsonResponse({"Error: ": "讀取資料失敗"}, status=500)

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

# 爬取活動及族語認證資料（使用 tacp.gov.tw 官方 API）
def get_tayal_imformation(request):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "zh-TW",
    }

    data = []

    # 原住民族文化發展中心最新消息（官方 API）
    try:
        res = requests.get(
            "https://event.tacp.gov.tw/api/frontend/announcements/latest",
            headers=headers,
            timeout=10
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
    except Exception as e:
        print(f"tacp API error: {e}")

    # 族語認證（師範大學原住民族語言認證考試）
    try:
        url_exam = "https://exam.sce.ntnu.edu.tw/abst/"
        res_exam = requests.get(url_exam, headers={**headers, "Accept": "text/html"}, timeout=10)
        soup_exam = BeautifulSoup(res_exam.text, "html.parser")
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
    except Exception as e:
        print(f"exam API error: {e}")

    return JsonResponse(data, safe=False, json_dumps_params={'ensure_ascii': False, 'indent': 2})
