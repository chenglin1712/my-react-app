import json
import logging
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from django.conf import settings as django_settings
from django_ratelimit.core import is_ratelimited
from openai import OpenAI
import os
from dotenv import load_dotenv
import traceback
import datetime

from fastAPI.routes.connect import SessionLocal
from fastAPI.routes.model import Word
from fastAPI.routes.word_data import load_explanation_items_for_words, load_audio_items_for_words
from config.tribes import TRIBE_IDS, TRIBE_MAP

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

def csrf_exempt_in_debug(view_func):
    """DEBUG=True（本機開發）沿用原本略過 CSRF 檢查的行為；DEBUG=False（正式環境）
    交回 Django 標準 CSRF 保護。過渡方案：前端目前完全沒有處理 CSRF token/cookie，
    套用這個保護後，正式環境下這兩個 view 的 POST 請求會被 Django CSRF middleware
    擋下（403），要嘛前端補上 CSRF token，要嘛之後把這兩個 view 改回 Django 標準
    的 view-based auth。"""
    return csrf_exempt(view_func) if django_settings.DEBUG else view_func


def verify_firebase_token(request):
    """驗證 Firebase ID Token。DEBUG 模式下跳過驗證（開發環境用）。"""
    if django_settings.DEBUG:
        logger.warning(
            "verify_firebase_token: SKIPPED (DEBUG=True). "
            "Set DJANGO_DEBUG=False in production to enforce authentication."
        )
        return {"uid": "dev-user"}, None

    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Bearer "):
        return None, JsonResponse({"detail": "需要登入才能使用此功能"}, status=401)
    token = auth_header[7:]
    try:
        _ensure_firebase()
        from firebase_admin import auth as firebase_auth
        decoded = firebase_auth.verify_id_token(token)
        return decoded, None
    except EnvironmentError as e:
        return None, JsonResponse({"detail": str(e)}, status=503)
    except Exception:
        return None, JsonResponse({"detail": "身份驗證失敗，請重新登入"}, status=401)


def _rate_limited_response(request, decoded, group, rate="10/m"):
    """依已登入使用者的 uid 限速（這兩個 view 都會呼叫付費的 GitHub Models API）。
    直接呼叫 is_ratelimited 而不是用 @ratelimit 裝飾器：裝飾器要在呼叫 view 之前
    就決定 key，但這裡的 key（uid）要等 verify_firebase_token 解出 token 之後才知道，
    所以放在驗證通過之後手動檢查。目前沒有 Redis，計數存在 Django 預設的記憶體
    快取（LocMemCache），單一 process 內有效。"""
    uid = decoded.get("uid", "anon")
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=rate, method="POST", increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


@csrf_exempt_in_debug
def tayal_chat(request):
    if request.method == "POST":
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="tayal_chat")
        if limited_resp:
            return limited_resp
        try:
            body = json.loads(request.body)
            user_message = body.get("message", "").strip()

            if not user_message:
                return JsonResponse({"detail": "取得訊息內容失敗"}, status=400)
            if len(user_message) > 1000:
                return JsonResponse({"detail": "訊息過長，請縮短後再試"}, status=400)

            # 從請求取得真實使用者學習資料（由前端傳入）
            user_stats = body.get("user_stats", {})
            correct     = user_stats.get("correct", 0)
            incorrect   = user_stats.get("incorrect", 0)
            unanswered  = user_stats.get("unanswered", 0)
            common_errors = user_stats.get("common_errors", [])
            level       = user_stats.get("level", "beginner")

            tribe = body.get("tribe", "tayal")
            tribe_name = TRIBE_MAP.get(tribe, "泰雅語")

            today = datetime.date.today()
            tomorrow = (today + datetime.timedelta(days=1)).isoformat()

            prompt = f"""
            你是一位{tribe_name}老師。你有兩種回應模式：
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
                "title": "（計畫標題，例如：{tribe_name}一週讀書計畫）",
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
            result = response.choices[0].message.content or ""

            plan_data = None
            if result.strip().startswith("{"):
                try:
                    parsed = json.loads(result)
                except json.JSONDecodeError:
                    parsed = None

                # 除了 type 是 study_plan，還要確認 events 是非空陣列、
                # 且每筆都有前端會直接拿去用的欄位（summary/start/end，
                # 其中 start/end 還會被 event.start.split('T') 處理），
                # 缺漏的話就不當成有效讀書計畫，改走純文字訊息 fallback，
                # 避免前端卡在半殘的 JSON 資料上噴錯
                if (
                    isinstance(parsed, dict)
                    and parsed.get('type') == 'study_plan'
                    and isinstance(parsed.get('events'), list)
                    and len(parsed['events']) > 0
                    and all(
                        isinstance(ev, dict) and ev.get('summary') and ev.get('start') and ev.get('end')
                        for ev in parsed['events']
                    )
                ):
                    plan_data = parsed

            if plan_data:
                # 前端聊天泡泡固定顯示 data.message，讀書計畫這裡原本沒有
                # 帶這個欄位，會顯示空白泡泡，補上一句簡短確認訊息
                return JsonResponse({
                    "message": f"已經為你排好「{plan_data.get('title') or '讀書計畫'}」，點選下方卡片即可加入行事曆。",
                    "study_plan": plan_data,
                })

            return JsonResponse({"message": result})

        except Exception as e:
            return JsonResponse({"detail": str(e)}, status=500)

    else:
        return JsonResponse({"detail": "只接受 POST 請求"}, status=405)
    
@csrf_exempt_in_debug
def review_tayal_chat(request):
    if request.method == "POST":
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="review_tayal_chat")
        if limited_resp:
            return limited_resp
        try:
            body = json.loads(request.body)
            user_message = body.get("message", "").strip()
            if not user_message:
                return JsonResponse({"detail": "取得失敗"}, status=400)
            if len(user_message) > 1000:
                return JsonResponse({"detail": "訊息過長，請縮短後再試"}, status=400)

            # 依空格切詞
            words = [w for w in user_message.split(" ") if w]

            tribe = body.get("tribe", "tayal")
            tribe_id = TRIBE_IDS.get(tribe, TRIBE_IDS["tayal"])
            tribe_name = TRIBE_MAP.get(tribe, "泰雅語")

            # 一次查詢所有詞（避免 N 次資料庫連線）
            word_map = search_tayal_words_bulk(words, tribe_id)
            relevant_words = [
                word_map.get(w, {"tayal": w, "chinese": "", "audio": ""})
                for w in words
            ]

            # 拼成 prompt context
            words_context = f"**{tribe_name}詞彙庫參考資料：**\n"
            for w in relevant_words:
                words_context += f"- {w['tayal']} : {w['chinese']}\n"

            prompt = f"""
                你是一位{tribe_name}老師，幫助學生理解句子。
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
            return JsonResponse({"detail": str(e)}, status=500)
    else:
        return JsonResponse({"detail": "只接受 POST 請求"}, status=405)

def _words_to_dicts(db, words) -> list:
    """把 Word ORM 物件轉成 {tayal, audio, chinese} dict 清單（依 words 原本順序，不去重）。
    search_tayal_words_bulk 與 search_tayal_words 共用同一套組裝邏輯。"""
    word_ids = [w.id for w in words]
    explanation_map = load_explanation_items_for_words(db, word_ids=word_ids)
    audio_map = load_audio_items_for_words(db, word_ids=word_ids)

    result = []
    for word in words:
        explanations = explanation_map.get(word.id, [])
        chinese = explanations[0].get("chineseExplanation", "") if explanations else ""
        audio_items = audio_map.get(word.id, [])
        audio = audio_items[0].get("fileId", "") if audio_items else ""
        result.append({"tayal": word.name, "audio": audio, "chinese": chinese})
    return result


def _query_word_dicts(query_fn) -> list:
    """開一次 DB session、跑 query_fn(db) 取得 Word 清單並組裝成 dict 清單；
    查詢失敗記錄錯誤並回傳空清單，連線一律確保關閉。"""
    db = SessionLocal()
    try:
        words = query_fn(db)
        return _words_to_dicts(db, words)
    except Exception as e:
        logger.error("[DB ERROR] Query failed: %s", e)
        return []
    finally:
        db.close()


def search_tayal_words_bulk(keywords: list, tribe_id: str = TRIBE_IDS["tayal"]) -> dict:
    """查詢多個關鍵詞，一次開啟連線，回傳 {keyword: word_dict} 映射。"""
    if not keywords:
        return {}

    word_dicts = _query_word_dicts(
        lambda db: db.query(Word)
        .filter(Word.name.in_(keywords), Word.tribe_id == tribe_id)
        .all()
    )

    result_map = {}
    for wd in word_dicts:
        if wd["tayal"] not in result_map:
            result_map[wd["tayal"]] = wd
    return result_map


def search_tayal_words(keyword=None, limit=8):
    def _query(db):
        query = db.query(Word)
        if keyword:
            query = query.filter(Word.name == keyword)
        else:
            query = query.order_by(Word.id)
        return query.limit(limit).all()

    return _query_word_dicts(_query)
