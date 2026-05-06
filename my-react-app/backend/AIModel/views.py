import json
import logging
from django.template import loader
from django.views.decorators.csrf import csrf_exempt
from django.http import HttpResponse
from django.http import JsonResponse
from django.conf import settings as django_settings
from openai import OpenAI
import os
from dotenv import load_dotenv
import sqlite3
import traceback
import datetime

logger = logging.getLogger(__name__)

load_dotenv()

_GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
if not _GITHUB_TOKEN:
    raise EnvironmentError(
        "[AIModel] 環境變數 GITHUB_TOKEN 未設定，AI 對話功能無法啟動。"
        "請在 .env 填入 GitHub Personal Access Token。"
    )

client = OpenAI(
    api_key=_GITHUB_TOKEN,
    base_url="https://models.github.ai/inference"
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "fastAPI", "routes", "dictionary.db")

# ── Firebase Admin SDK（生產環境身份驗證）──────────────────────────
_firebase_initialized = False

def _ensure_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return
    sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    if not sa_path:
        raise EnvironmentError(
            "FIREBASE_SERVICE_ACCOUNT_PATH 未設定，"
            "請在 .env 填入 Firebase 服務帳戶金鑰路徑。"
        )
    import firebase_admin
    from firebase_admin import credentials
    if not firebase_admin._apps:
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)
    _firebase_initialized = True

def verify_firebase_token(request):
    """驗證 Firebase ID Token。DEBUG 模式下跳過驗證（開發環境用）。"""
    if django_settings.DEBUG:
        return {"uid": "dev-user"}, None

    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Bearer "):
        return None, JsonResponse({"error": "需要登入才能使用此功能"}, status=401)
    token = auth_header[7:]
    try:
        _ensure_firebase()
        from firebase_admin import auth as firebase_auth
        decoded = firebase_auth.verify_id_token(token)
        return decoded, None
    except EnvironmentError as e:
        return None, JsonResponse({"error": str(e)}, status=503)
    except Exception:
        return None, JsonResponse({"error": "身份驗證失敗，請重新登入"}, status=401)

# tayal_chat視覺化測試
def main(request):
    template = loader.get_template('tayal_chat.html')
    return HttpResponse(template.render())

@csrf_exempt
def tayal_chat(request):
    if request.method == "POST":
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        try:
            body = json.loads(request.body)
            user_message = body.get("message", "").strip()

            if not user_message:
                return JsonResponse({"error": "取得訊息內容失敗"}, status=400)

            # 從請求取得真實使用者學習資料（由前端傳入）
            user_stats = body.get("user_stats", {})
            correct     = user_stats.get("correct", 0)
            incorrect   = user_stats.get("incorrect", 0)
            unanswered  = user_stats.get("unanswered", 0)
            common_errors = user_stats.get("common_errors", [])
            level       = user_stats.get("level", "beginner")

            today = datetime.date.today()
            tomorrow = (today + datetime.timedelta(days=1)).isoformat()

            prompt = f"""
            你是一位泰雅語老師。你有兩種回應模式：
            ### 模式一：一般對話與學習狀況分析 (預設)
            當使用者進行一般對話，或詢問 "想了解學習狀況" 時：
            1.  根據以下使用者資料，用對話方式進行正向引導（正向，100字內，不用Markdown或換行符號）。
            2.  資料：
                - 程度: {level}
                - 答對: {correct}
                - 答錯: {incorrect}
                - 未作答: {unanswered}
                - 常見錯誤: {common_errors}
            3.  範例回應: "lokah su! 你的學習狀況不錯，答對了...題。要注意...的拼寫喔。"

            ### 模式二：制定讀書計畫 (JSON 輸出)
            當使用者要求 "制定讀書計畫" (例如：幫我排一個一週讀書計畫、規劃學習)：
            1.  你 **必須** 根據使用者的程度 ({level}) 來設計一個合適的計畫。
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
            使用者的程度是： {level}
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
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        try:
            body = json.loads(request.body)
            user_message = body.get("message", "").strip()
            if not user_message:
                return JsonResponse({"error": "取得失敗"}, status=400)

            # 依空格切詞
            words = [w for w in user_message.split(" ") if w]

            # 一次查詢所有詞（避免 N 次資料庫連線）
            word_map = search_tayal_words_bulk(words)
            relevant_words = [
                word_map.get(w, {"tayal": w, "chinese": "", "audio": ""})
                for w in words
            ]

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
            logger.error(traceback.format_exc())
            return JsonResponse({"error": str(e)}, status=500)
    else:
        return JsonResponse({"error": "只接受 POST 請求"}, status=405)

def search_tayal_words_bulk(keywords: list) -> dict:
    """查詢多個關鍵詞，一次開啟連線，回傳 {keyword: word_dict} 映射。"""
    if not keywords:
        return {}
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
    except Exception as e:
        logger.error("[DB ERROR] DB connection failed: %s", e)
        return {}

    result_map = {}
    try:
        placeholders = ",".join("?" * len(keywords))
        query = f"SELECT * FROM words WHERE name IN ({placeholders})"
        cursor.execute(query, keywords)
        rows = cursor.fetchall()
    except Exception as e:
        logger.error("[DB ERROR] Query failed: %s", e)
        rows = []
    finally:
        conn.close()

    for row in rows:
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
        word_name = row[4]
        if word_name not in result_map:
            result_map[word_name] = {"tayal": word_name, "audio": audio, "chinese": chinese}

    return result_map


def search_tayal_words(keyword=None, limit=8):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
    except Exception as e:
        logger.error("[DB ERROR] DB connection failed: %s", e)
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
        logger.error("[DB ERROR] Query failed: %s", e)
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
