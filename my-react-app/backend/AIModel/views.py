import json
import logging
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited
import traceback

from dictionary_db.connect import SessionLocal
from dictionary_db.model import Word
from dictionary_db.word_data import load_explanation_items_for_words, load_audio_items_for_words
from config.tribes import TRIBE_IDS, TRIBE_MAP
from core.firebase_auth import verify_firebase_token
from config.llm import get_llm_client
from adminapi.rate_limits import get_configured_rate
from .serializers import TayalChatSerializer, ReviewTayalChatSerializer
from .services import run_tayal_chat, run_review_tayal_chat

logger = logging.getLogger(__name__)


def _get_client():
    """搬到 config/llm.py（族語翻譯功能在 FastAPI process 裡也需要同一個
    client，見該檔案說明）。這裡保留同名函式當一行 delegate，行為完全不變，
    AIModel/tests.py 既有的 `@patch("AIModel.views._get_client", ...)` 測試
    路徑不用跟著改。"""
    return get_llm_client()

def _rate_limited_response(request, decoded, group, rate="10/m"):
    """依已登入使用者的 uid 限速（這兩個 view 都會呼叫付費的 GitHub Models API）。
    直接呼叫 is_ratelimited 而不是用 @ratelimit 裝飾器：裝飾器要在呼叫 view 之前
    就決定 key，但這裡的 key（uid）要等 verify_firebase_token 解出 token 之後才知道，
    所以放在驗證通過之後手動檢查。計數存放位置見 core/settings.py 的 CACHES
    設定：正式環境設定 REDIS_URL 後所有 gunicorn worker 共用同一份計數，門檻才會
    如實生效；未設定時退回 Django 預設的 LocMemCache，僅單一 process 內有效。"""
    uid = decoded.get("uid", "anon")
    effective_rate = get_configured_rate(group, rate)
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=effective_rate, method="POST", increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


# 這兩個 view 只認 Authorization: Bearer <Firebase ID Token>，不是 cookie/session-based
# 認證，瀏覽器不會替跨站請求自動附上這個 header，所以本來就不受 CSRF 攻擊影響——
# csrf_exempt 在這裡不是「豁免掉一項保護」，而是「這項保護原本就不適用」，永久生效，
# 不隨 DEBUG 變動（過去曾經只在 DEBUG=True 才豁免，DEBUG=False 時前端從未處理過
# CSRF token/cookie，會讓這兩個 view 一律 403）。
@csrf_exempt
def tayal_chat(request):
    if request.method == "POST":
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="tayal_chat")
        if limited_resp:
            return limited_resp
        try:
            client = _get_client()
        except EnvironmentError as e:
            return JsonResponse({"detail": str(e)}, status=503)

        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"detail": "請求格式錯誤"}, status=400)

        serializer = TayalChatSerializer(data=body)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        validated = serializer.validated_data

        user_message = validated["message"].strip()
        if not user_message:
            return JsonResponse({"detail": "取得訊息內容失敗"}, status=400)

        # 從請求取得真實使用者學習資料（由前端傳入，已經過 TayalChatSerializer
        # 驗證型別與長度上限，見 serializers.py 說明）
        user_stats = validated.get("user_stats", {})

        tribe = validated.get("tribe", "tayal")
        tribe_name = TRIBE_MAP.get(tribe, "泰雅語")

        try:
            result = run_tayal_chat(client, tribe_name, user_message, user_stats)
            return JsonResponse(result)

        except Exception:
            # 原本直接把 str(e) 回給前端，不論 DEBUG 與否都會洩漏內部例外訊息
            # （可能包含 API 回應細節、內部路徑等），且完全沒有寫 log，出錯時
            # 伺服器端反而看不到記錄。改成記錄完整 traceback，只回通用訊息。
            logger.error("[tayal_chat] 處理失敗\n%s", traceback.format_exc())
            return JsonResponse({"detail": "AI 服務暫時無法回應，請稍後再試"}, status=502)

    else:
        return JsonResponse({"detail": "只接受 POST 請求"}, status=405)

@csrf_exempt
def review_tayal_chat(request):
    if request.method == "POST":
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="review_tayal_chat")
        if limited_resp:
            return limited_resp
        try:
            client = _get_client()
        except EnvironmentError as e:
            return JsonResponse({"detail": str(e)}, status=503)

        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"detail": "請求格式錯誤"}, status=400)

        serializer = ReviewTayalChatSerializer(data=body)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        validated = serializer.validated_data

        user_message = validated["message"].strip()
        if not user_message:
            return JsonResponse({"detail": "取得失敗"}, status=400)

        tribe = validated.get("tribe", "tayal")
        tribe_id = TRIBE_IDS.get(tribe, TRIBE_IDS["tayal"])
        tribe_name = TRIBE_MAP.get(tribe, "泰雅語")

        try:
            # 依空格切詞，一次查詢所有詞（避免 N 次資料庫連線）
            words = [w for w in user_message.split(" ") if w]
            word_map = search_tayal_words_bulk(words, tribe_id)
            relevant_words = [
                word_map.get(w, {"tayal": w, "chinese": "", "audio": ""})
                for w in words
            ]

            result = run_review_tayal_chat(client, tribe_name, user_message, relevant_words)
            return JsonResponse(result)

        except Exception:
            # 原本有記 log 但仍把 str(e) 回給前端；跟 tayal_chat 一樣，例外訊息
            # 只留在伺服器端的 log，回應改成通用訊息。
            logger.error("[review_tayal_chat] 處理失敗\n%s", traceback.format_exc())
            return JsonResponse({"detail": "AI 服務暫時無法回應，請稍後再試"}, status=502)
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
