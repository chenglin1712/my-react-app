import json
from django.template import loader
from django.views.decorators.csrf import csrf_exempt
from django.http import HttpResponse
from django.http import JsonResponse
from openai import OpenAI
import os
from dotenv import load_dotenv
import sqlite3
import traceback
import datetime

load_dotenv()

client = OpenAI(
    api_key=os.getenv("GITHUB_TOKEN"),
    base_url="https://models.github.ai/inference"
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DB_PATH = os.path.join(BASE_DIR, "fastAPI", "routes", "dictionary.db")

#使用者答題情形資料
userData = {
    "correct": 5,
    "incorrect": 3,
    "unanswered": 2,
    "common_errors": ["huzil (狗) 拼錯"],
    'level': 'beginner'
}

# tayal_chat視覺化測試
def main(request):
    template = loader.get_template('tayal_chat.html')
    return HttpResponse(template.render())

@csrf_exempt
def tayal_chat(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            user_message = body.get("message", "").strip()

            if not user_message:
                return JsonResponse({"error": "取得訊息內容失敗"}, status=400)
            
            today = datetime.date.today()
            tomorrow = (today + datetime.timedelta(days=1)).isoformat()

            prompt = f"""
            你是一位泰雅語老師。你有兩種回應模式：
            ### 模式一：一般對話與學習狀況分析 (預設)
            當使用者進行一般對話，或詢問 "想了解學習狀況" 時：
            1.  根據以下使用者資料，用對話方式進行正向引導（正向，100字內，不用Markdown或換行符號）。
            2.  資料：
                - 程度: {userData.get('level', 'beginner')}
                - 答對: {userData['correct']}
                - 答錯: {userData['incorrect']}
                - 未作答: {userData['unanswered']}
                - 常見錯誤: {userData['common_errors']}
            3.  範例回應: "lokah su! 你的學習狀況不錯，答對了...題。要注意...的拼寫喔。"

            ### 模式二：制定讀書計畫 (JSON 輸出)
            當使用者要求 "制定讀書計畫" (例如：幫我排一個一週讀書計畫、規劃學習)：
            1.  你 **必須** 根據使用者的程度 ({userData.get('level', 'beginner')}) 來設計一個合適的計畫。
            2.  忽略100字限制，並 **回傳一個有效的 JSON 物件**，不要有任何 JSON 以外的文字 (例如 "好的，這是您的計畫..." 或 ```json ... ``` 標籤)。
            3.  計畫應從明天 ({tomorrow}) 開始。所有時間都應使用 'Asia/Taipei' (+08:00) 時區。
            4.  JSON 格式必須如下 (這是前端需要的格式)：
            {{
                "type":"study_plan",
                "title": "（計畫標題，例如：泰雅語一週讀書計畫）",
                "events": [
                    {{
                    "summary": "（第一天的學習任務）",
                    "description": "（任務的詳細描述，例如：前往 '初級測驗' 練習基礎詞彙）",
                    "start": "{tomorrow}T10:00:00+08:00",
                    "end": "{tomorrow}T10:30:00+08:00"
                    }},
                    {{
                    "summary": "（第二天的學習任務）",
                    "description": "（任務的詳細描述）",
                    "start": "{(today + datetime.timedelta(days=2)).isoformat()}T14:00:00+08:00",
                    "end": "{(today + datetime.timedelta(days=2)).isoformat()}T14:30:00+08:00"
                    }}
                ]
            }}
           
            ---
            使用者的程度是： {userData.get('level', 'beginner')}
            今天的日期是：{today.isoformat()}
            """
            response = client.chat.completions.create(
                model="openai/gpt-4o",
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_message}
                ]
            )
            result = response.choices[0].message.content

            try:
                if result.strip().startswith("{"):
                    plan_data = json.loads(result)

                    # 檢查是否是讀書計畫 JSON
                    if 'type' in plan_data and plan_data['type'] == 'study_plan':
                        return JsonResponse({
                            "study_plan": plan_data
                        })

                return JsonResponse({"message": result})

            except json.JSONDecodeError:
                return JsonResponse({"message": result})

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    else:
        return JsonResponse({"error": "只接受 POST 請求"}, status=405)
    
@csrf_exempt 
def review_tayal_chat(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            user_message = body.get("message", "").strip()
            if not user_message:
                return JsonResponse({"error": "取得失敗"}, status=400)

            # 依空格切詞
            words = user_message.split(" ")

            # 查詢每個詞的翻譯（回傳格式：[{"word":"cyux","meaning":"正在"}, ...]）
            relevant_words = []
            for w in words:
                result = search_tayal_words(w, limit=1)  # 取一筆最相關的
                if result:
                    relevant_words.append(result[0])
                else:
                    relevant_words.append({"tayal": w,"chinese": "", "audio": ""})

            # 拼成 prompt context
            words_context = "**泰雅語詞彙庫參考資料：**\n"
            for w in relevant_words:
                words_context += f"- {w['tayal']} : {w['chinese']}\n"

            prompt = f"""
                你是一位泰雅語老師，幫助學生理解句子。
                使用者已經有句子的完整中文翻譯，你的任務不是重複翻譯，而是提供額外的補充說明，例如：
                - 詞彙用法
                - 語法結構
                - 文化背景或上下文提示
                - 注意事項或常見錯誤

                詞彙庫：
                {words_context}

                要求：
                1. 產生一句完整的中文翻譯
                2. 保持正向、簡潔的教學語氣
                3. 不要使用 Markdown 標記（例如 **）
                4. 每個詞可以簡單說明用法或文化背景
                5. 字數控制在50字內

            """

            response = client.chat.completions.create(
                model="openai/gpt-4o",
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_message}
                ]
            )
            ai_text = response.choices[0].message.content

            return JsonResponse({
                "original": user_message,
                "words": relevant_words,
                "translation": ai_text,
                "image": None  # 之後可以依詞彙加圖
            })

        except Exception as e:
            print(traceback.format_exc())
            return JsonResponse({"error": str(e)}, status=500)
    else:
        return JsonResponse({"error": "只接受 POST 請求"}, status=405)

def search_tayal_words(keyword=None, limit=8):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
    except Exception as e:
        print(f"[DB ERROR] 資料庫連線失敗: {e}")
        return []

    results = []
    try:
        if keyword:
            query = "SELECT * FROM words WHERE name = ? LIMIT ?"
            cursor.execute(query, (keyword, limit))
        else:
            query = "SELECT * FROM words ORDER BY id LIMIT ?"
            cursor.execute(query, (limit,))

        results = cursor.fetchall()
    except Exception as e:
        print(f"[DB ERROR] 查詢失敗: {e}")
    finally:
        conn.close()

    if not results:
        return []

    words_data = []
    for row in results:
        # 欄位順序: id(0) tribe_id(1) tribe(2) dialect(3) name(4) ... explanation_items(14) audio_items(15)
        try:
            explanations = json.loads(row[14]) if row[14] else []
        except (json.JSONDecodeError, TypeError):
            explanations = []

        chinese = ""
        if isinstance(explanations, list) and explanations:
            chinese = explanations[0].get("chineseExplanation", "")

        try:
            audio_items = json.loads(row[15]) if row[15] else []
        except (json.JSONDecodeError, TypeError):
            audio_items = []

        audio = audio_items[0].get("fileId", "") if audio_items else ""

        words_data.append({
            'tayal': row[4],
            'audio': audio,
            'chinese': chinese
        })

    return words_data
