import json
import logging
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse, StreamingHttpResponse
from django_ratelimit.core import is_ratelimited
import sys
import time
import traceback
from dataclasses import dataclass

from dictionary_db.connect import SessionLocal
from dictionary_db.model import Word
from dictionary_db.word_data import load_explanation_items_for_words, load_audio_items_for_words
from config.tribes import TRIBE_IDS, TRIBE_MAP
from core.firebase_auth import verify_firebase_token
from config.llm import get_llm_client, classify_llm_error, llm_deadline
from adminapi.rate_limits import get_configured_rate
from .serializers import TayalChatSerializer, ReviewTayalChatSerializer
from . import quota as daily_quota
from .learner_profile import load_profile
from .services import run_tayal_chat, run_review_tayal_chat, stream_tayal_chat
from .tools import SqlDictionaryLookup

logger = logging.getLogger(__name__)


def _get_client():
    """搬到 config/llm.py（族語翻譯功能在 FastAPI process 裡也需要同一個
    client，見該檔案說明）。這裡保留同名函式當一行 delegate，行為完全不變，
    AIModel/tests.py 既有的 `@patch("AIModel.views._get_client", ...)` 測試
    路徑不用跟著改。"""
    return get_llm_client()

def _assistant_disabled_response():
    """AI 助手總開關（FeatureFlag ai_assistant_enabled，後台「功能開關」頁可切換）。
    兩個 view 都會呼叫付費的 LLM，是翻譯以外另一條費用出口，所以需要同樣能一鍵關閉。
    找不到旗標紀錄（尚未跑 seed_feature_flags）視為未關閉，維持原本行為。
    在限速計數之前檢查，關閉期間被擋下的請求不佔用使用者的限速額度。"""
    from adminapi import ai_budget
    from adminapi.models import FeatureFlag

    # 月預算超過時這裡會自動把旗標關掉（見 adminapi/ai_budget.py）；評估有 60 秒快取，失敗只記錄不擋人。
    ai_budget.enforce()
    flag = FeatureFlag.objects.filter(key="ai_assistant_enabled").first()
    if flag is not None and not flag.enabled:
        return JsonResponse({"detail": "AI 助手目前暫停服務，請稍後再試。", "code": "ai_assistant_disabled"}, status=403)
    return None


def _rate_limited_response(request, decoded, group, rate="10/m"):
    """依已登入使用者的 uid 限速（這兩個 view 都會呼叫付費的 Anthropic Claude API）。
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


def _quota_exceeded_response(quota):
    """每日額度用完：429，帶剩餘次數（0）與重置時間，前端可以顯示「明天 00:00 重置」。"""
    response = JsonResponse({
        "detail": "今天的提問次數已經用完了，明天 00:00 重置。",
        "code": "ai_daily_quota_exceeded",
        "quota": quota.as_dict(),
    }, status=429)
    response["Retry-After"] = str(quota.retry_after_seconds())
    return response


# 這兩個 view 只認 Authorization: Bearer <Firebase ID Token>，不是 cookie/session-based
# 認證，瀏覽器不會替跨站請求自動附上這個 header，所以本來就不受 CSRF 攻擊影響——
# csrf_exempt 在這裡不是「豁免掉一項保護」，而是「這項保護原本就不適用」，永久生效，
# 不隨 DEBUG 變動（過去曾經只在 DEBUG=True 才豁免，DEBUG=False 時前端從未處理過
# CSRF token/cookie，會讓這兩個 view 一律 403）。
@dataclass
class _ChatRequest:
    """通過驗證、限速、額度的一次提問（tayal_chat 與 tayal_chat_stream 共用）。"""
    client: object
    user_message: str
    tribe: str
    tribe_name: str
    uid: str
    history: list
    quota: object


def _prepare_chat(request):
    """驗證身分、總開關、限速、請求內容並扣一次每日額度。回傳 (_ChatRequest, None) 或 (None, 錯誤回應)。
    順序與意義見各步驟；失敗的請求（格式錯誤等）不扣額度，扣了之後的失敗由呼叫端退還。"""
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return None, err_resp
    disabled_resp = _assistant_disabled_response()
    if disabled_resp:
        return None, disabled_resp
    limited_resp = _rate_limited_response(request, decoded, group="tayal_chat")
    if limited_resp:
        return None, limited_resp
    try:
        client = _get_client()
    except EnvironmentError as e:
        return None, JsonResponse({"detail": str(e)}, status=503)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return None, JsonResponse({"detail": "請求格式錯誤"}, status=400)

    serializer = TayalChatSerializer(data=body)
    if not serializer.is_valid():
        return None, JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    validated = serializer.validated_data

    user_message = validated["message"].strip()
    if not user_message:
        return None, JsonResponse({"detail": "取得訊息內容失敗"}, status=400)

    tribe = validated.get("tribe", "tayal")
    uid = decoded.get("uid", "")

    # 通過驗證才扣額度（格式錯誤的請求不佔次數）；之後失敗會退還
    quota = daily_quota.consume(uid)
    if not quota.allowed:
        return None, _quota_exceeded_response(quota)

    return _ChatRequest(
        client=client, user_message=user_message, tribe=tribe, tribe_name=TRIBE_MAP.get(tribe, "泰雅語"),
        uid=uid, history=validated.get("history", []), quota=quota,
    ), None


def _chat_kwargs(chat):
    # 學習資料由伺服器依已驗證的 uid 讀取，不採用請求裡的 user_stats（路線圖 #20）；
    # 讀不到（沒設定 Firestore、逾時）時是 None，助手退回通用回答。
    return dict(
        profile=load_profile(chat.uid), uid=chat.uid, history=chat.history,
        lookup=SqlDictionaryLookup(TRIBE_IDS.get(chat.tribe, TRIBE_IDS["tayal"])),
    )


@csrf_exempt
def tayal_chat(request):
    if request.method == "POST":
        chat, err_resp = _prepare_chat(request)
        if err_resp:
            return err_resp

        try:
            result = run_tayal_chat(chat.client, chat.tribe_name, chat.user_message, **_chat_kwargs(chat))
            result["quota"] = chat.quota.as_dict()
            return JsonResponse(result)

        except Exception:
            daily_quota.refund(chat.uid, chat.quota.day)
            # 原本直接把 str(e) 回給前端，不論 DEBUG 與否都會洩漏內部例外訊息
            # （可能包含 API 回應細節、內部路徑等），且完全沒有寫 log，出錯時
            # 伺服器端反而看不到記錄。改成記錄完整 traceback，只回通用訊息。
            logger.error("[tayal_chat] 處理失敗\n%s", traceback.format_exc())
            status, detail = classify_llm_error(sys.exc_info()[1])
            return JsonResponse({"detail": detail}, status=status)

    else:
        return JsonResponse({"detail": "只接受 POST 請求"}, status=405)


# 一次串流最久持續多少秒。gunicorn 的 --timeout 是 75 秒（docker-compose.prod.yml），sync worker 在串流期間
# 不會回報存活，超過就被強制殺掉；留 20 秒餘裕讓這裡先用 error 事件正常收尾。
STREAM_DEADLINE_SECONDS = 55


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def _chat_stream_events(chat):
    """串流端點的 SSE 內容：delta（文字片段）、done（完整結果）或 error（中途失敗，前端顯示「回覆中斷，重試」）。

    退還額度的原則同 tayal_chat：失敗不是學生的錯，退還；使用者自己放棄（連線關閉，generator 被關閉）不退，
    因為模型已經在處理。"""
    deadline = time.monotonic() + STREAM_DEADLINE_SECONDS
    # 同一個截止時間也限制每次 LLM 呼叫的逾時（config.llm._with_deadline），這樣卡在等模型的時候也不會拖過去
    deadline_token = llm_deadline.set(deadline)
    try:
        for event in stream_tayal_chat(chat.client, chat.tribe_name, chat.user_message, **_chat_kwargs(chat)):
            if event["type"] == "done":
                payload = {k: v for k, v in event.items() if k != "type"}
                payload["quota"] = chat.quota.as_dict()
                yield _sse("done", payload)
                return
            if time.monotonic() > deadline:
                raise TimeoutError("串流超過時間上限")
            yield _sse("delta", {"t": event["t"]})
    except GeneratorExit:
        raise
    except Exception as exc:
        daily_quota.refund(chat.uid, chat.quota.day)
        logger.error("[tayal_chat_stream] 串流中途失敗\n%s", traceback.format_exc())
        status, detail = (504, "回覆花的時間太久，請重試。") if isinstance(exc, TimeoutError) else classify_llm_error(exc)
        yield _sse("error", {"detail": detail, "status": status})
    finally:
        try:
            llm_deadline.reset(deadline_token)
        except ValueError:
            pass   # generator 在別的執行緒被回收時 token 屬於另一個 context；請求已結束，不影響任何人


@csrf_exempt
def tayal_chat_stream(request):
    """tayal_chat 的串流版（路線圖 #9），用 Server-Sent Events 回傳。

    開始串流之前的錯誤（未登入、助手關閉、限速、額度用完、請求格式錯誤）和 tayal_chat 一樣回一般的
    JSON 與狀態碼，前端用同一套處理；串流開始之後 HTTP 狀態碼已經是 200，錯誤改用 error 事件傳達。

    部署注意：nginx 要對這條路徑關閉 proxy_buffering（見 deploy/nginx.conf），否則文字會被攢到最後才一次送出；
    這裡也送了 X-Accel-Buffering: no。串流期間會占住一個 gunicorn worker，和不串流時等待回覆的占用時間相同。"""
    if request.method != "POST":
        return JsonResponse({"detail": "只接受 POST 請求"}, status=405)
    chat, err_resp = _prepare_chat(request)
    if err_resp:
        return err_resp
    response = StreamingHttpResponse(_chat_stream_events(chat), content_type="text/event-stream; charset=utf-8")
    response["Cache-Control"] = "no-cache, no-transform"
    response["X-Accel-Buffering"] = "no"
    return response


@csrf_exempt
def review_tayal_chat(request):
    if request.method == "POST":
        decoded, err_resp = verify_firebase_token(request)
        if err_resp:
            return err_resp
        disabled_resp = _assistant_disabled_response()
        if disabled_resp:
            return disabled_resp
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
        uid = decoded.get("uid", "")

        quota = daily_quota.consume(uid)
        if not quota.allowed:
            return _quota_exceeded_response(quota)

        try:
            # 依空格切詞，一次查詢所有詞（避免 N 次資料庫連線）
            words = [w for w in user_message.split(" ") if w]
            word_map = search_tayal_words_bulk(words, tribe_id)
            relevant_words = [
                word_map.get(w, {"tayal": w, "chinese": "", "audio": ""})
                for w in words
            ]

            result = run_review_tayal_chat(client, tribe_name, user_message, relevant_words, uid=uid)
            result["quota"] = quota.as_dict()
            return JsonResponse(result)

        except Exception:
            daily_quota.refund(uid, quota.day)
            # 原本有記 log 但仍把 str(e) 回給前端；跟 tayal_chat 一樣，例外訊息
            # 只留在伺服器端的 log，回應改成通用訊息。
            logger.error("[review_tayal_chat] 處理失敗\n%s", traceback.format_exc())
            status, detail = classify_llm_error(sys.exc_info()[1])
            return JsonResponse({"detail": detail}, status=status)
    else:
        return JsonResponse({"detail": "只接受 POST 請求"}, status=405)

@csrf_exempt
def ai_quota(request):
    """今天還剩幾次提問（前端打開助手時顯示「今天還可以問 N 次」）。只讀取，不扣次數、不呼叫模型。"""
    if request.method != "GET":
        return JsonResponse({"detail": "只接受 GET 請求"}, status=405)
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return err_resp
    return JsonResponse(daily_quota.peek(decoded.get("uid", "")).as_dict())


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
