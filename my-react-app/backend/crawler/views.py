import requests
from django.http import JsonResponse
from bs4 import BeautifulSoup

#爬取線上測驗題目(初級)
def get_quiz_data(request):
    #取得等級，預設1
    level = request.GET.get("level","1")
    url = "https://api.lokahsu.org.tw/api/front_end/start_exam?dialect_id=6&level=1"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    response = requests.get(url,headers=headers)

    if response.status_code == 200:
        data = response.json()

        if level == "1":
            format_data = format_quiz_data_1(data)
        elif level == "2":
            format_data = format_quiz_data_2(data)
        else:
            return JsonResponse({"Error": f"不支援的等級: {level}"}, status=400)
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
        "chapter_name":data["data"]["display_dialect_name"],
        "parts":[]
    }
    format_part2 = {
        "type": "choice",
        "title": "第二部分：選擇題",
        "intro": "試卷上每題有三個圖片，根據題目選一個與所聽到語意最相符的圖片",
        "questions":[
            {
                "question_ab": "cyux inu' kkyalan / renwa' nha'?",
                "question_ch": "他們的電話在哪裡？",
                "audio": "https://api.lokahsu.org.tw/public/junior/sound/6/4choiceOne/2_2_C.mp3",
                "imageA": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/2_2A.png",
                "imageB": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/2_2B.png",
                "imageC": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/2_2C.png",
                "answer": "3"
            },{
                "question_ab": "cyux matas biru' qu 'laqi' mlikuy qasa.",
                "question_ch": "那個男孩子正在畫圖。",
                "audio": "https://api.lokahsu.org.tw/public/junior/sound/6/4choiceOne/3_5_A.mp3",
                "imageA": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/3_5A.png",
                "imageB": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/3_5B.png",
                "imageC": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/3_5C.png",
                "answer": "1"
            },{
                "question_ab": "smoya' mita' teribiy qu kkneril qasa.",
                "question_ch": "那些女孩子喜歡看電視。",
                "audio": "https://api.lokahsu.org.tw/public/junior/sound/6/4choiceOne/4_2_A.mp3",
                "imageA": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_2A.png",
                "imageB": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_2B.png",
                "imageC": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_2C.png",
                "answer": "1"
            },
            {
                "question_ab": "baq su' matas biru'?",
                "question_ch": "你會畫圖嗎？",
                "audio": "https://api.lokahsu.org.tw/public/junior/sound/6/4choiceOne/4_3_A.mp3",
                "imageA": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_3A.png",
                "imageB": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_3B.png",
                "imageC": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_3C.png",
                "answer": "1"
            },
            {
                "question_ab": "smoya' mqwas qu lelaqi' qasa.",
                "question_ch": "那些孩子喜歡唱歌。",
                "audio": "https://api.lokahsu.org.tw/public/junior/sound/6/4choiceOne/4_4_A.mp3",
                "imageA": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_4A.png",
                "imageB": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_4B.png",
                "imageC": "https://api.lokahsu.org.tw/public/junior/graphics/choiceOne/4_4C.png",
                "answer": "1"
            }
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
