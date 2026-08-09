"""P5 數據分析。

P5.0：使用事件的寫入端點（POST /adminapi/public/events/）——給前端關鍵
操作（頁面瀏覽、測驗開始/作答等）回報用。FastAPI 端的事件（辭典搜尋查詢
字串跟命中數）**不**走這個端點，是直接用輕量 SQLAlchemy engine 寫進同一張
`UsageEvent` 表，見 backend/fastAPI/usage_events.py 的說明——避免在搜尋
這種熱路徑上多一個跨服務 HTTP 往返。dictionary_search 因此刻意不在這個
公開端點的 VALID_EVENT_TYPES 白名單裡：如果開放，任何人都能偽造查詢字串
與命中數直接灌進搜尋分析報表，而這個事件類型本來就已經有可信的伺服器端
寫入路徑，公開端點沒有必要（也不應該）重複開放（獨立審查找到的問題）。

之後 P5.1-P5.4 的聚合報表端點（儀表板／搜尋分析／題目品質分析／留存分析）
陸續加進這個檔案。
"""
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db.models import Count
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Lower, TruncDate
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role, try_verify_firebase_token
from config.roles import STAFF_ROLES
from config.tribes import TRIBE_IDS, TRIBE_MAP

from . import firebase_ops
from ._shared import ip_rate_limited_response as _ip_rate_limited_response, parse_json_body as _parse_json_body
from .models import (
    QuizChoiceItem, QuizClozePassage, QuizSituationItem, QuizTrueFalseItem, QuizVocabItem, UsageEvent,
)

# 功能使用熱度的中文標籤對照——涵蓋全部 event_type，包含只能由可信伺服器端
# 路徑寫入、不開放公開端點建立的 dictionary_search（見 VALID_EVENT_TYPES
# 的說明）；遊戲／筆記／AI 等其餘功能尚未接上任何寫入路徑，不在這裡預先
# 列出空白項目，避免圖表出現「一直是 0」但看起來像是真的量測過的類別，
# 誤導使用者以為那個功能真的沒人用。
EVENT_TYPE_LABELS = {
    "dictionary_search": "辭典搜尋",
    "quiz_answer": "測驗作答",
    "quiz_session": "測驗",
    "page_view": "頁面瀏覽",
}

# 公開端點（usage_event_create）允許建立的事件類型白名單——刻意不含
# dictionary_search，那個類型只能由 FastAPI 端的可信路徑寫入（見上方模組
# docstring）。新增可從前端直接回報的事件類型時記得同步這裡。
VALID_EVENT_TYPES = frozenset({
    "quiz_answer",
    "quiz_session",
    "page_view",
})

_MAX_PAYLOAD_JSON_LENGTH = 4096

# quiz_answer 的 payload 有嚴格型別要求，不像其他事件類型只檢查 payload
# 是不是 dict 就好——item_kind/item_id 型別不對會讓 quiz_quality_analytics()
# 因為拿 list/dict 當 (item_kind, item_id) 的雜湊 key 直接 500
# （unhashable type）；correct 如果不是嚴格的布林值，Python 的
# bool("false") 會是 True，靜默把「答錯」算成「答對」，永久扭曲答對率跟
# 鑑別度（獨立審查找到的問題）。
_QUIZ_ANSWER_ITEM_KINDS = frozenset({"true_false", "choice", "matching", "cloze", "situation"})
# 克漏字的 item_id 是 "passageId:blankKey" 複合字串（見 crawler/views.py
# build_cloze_test_from_db 的說明），blank_key 本身允許任意非大括號字元
# （見 QuizClozePassage.clean() 的標記解析），這裡只要求格式是「數字＋冒號
# ＋至少一個字元」，不過度限制 blank_key 的字元集合。
_CLOZE_ITEM_ID_PATTERN = re.compile(r"^\d+:.+$")


def _validate_quiz_answer_payload(payload):
    """回傳錯誤訊息字串；合法時回傳 None。"""
    item_kind = payload.get("item_kind")
    # 先確認是字串才能安全做 frozenset 成員檢查——item_kind 是 list/dict
    # 這種不可雜湊型別時，`in` 本身就會直接拋 TypeError，這裡要在那之前
    # 攔下來，不能讓驗證函式自己也被畸形輸入弄壞。
    if not isinstance(item_kind, str) or item_kind not in _QUIZ_ANSWER_ITEM_KINDS:
        return "item_kind 不支援"

    item_id = payload.get("item_id")
    if item_kind == "cloze":
        if not isinstance(item_id, str) or not _CLOZE_ITEM_ID_PATTERN.match(item_id):
            return "item_id 格式錯誤"
    else:
        # bool 是 int 的子類別，isinstance(True, int) 會是 True——先排除
        # bool 才不會讓 correct=True/False 這種畸形輸入被誤判成合法 item_id。
        if isinstance(item_id, bool) or not isinstance(item_id, int) or item_id <= 0:
            return "item_id 格式錯誤"

    correct = payload.get("correct")
    if type(correct) is not bool:
        return "correct 必須是布林值"

    level = payload.get("level")
    if level is not None and not isinstance(level, str):
        return "level 格式錯誤"

    return None


@csrf_exempt
def usage_event_create(request):
    """匿名可用（未登入訪客的搜尋/瀏覽行為本身也是分析目標），依 IP 限速
    防濫用——這是公開端點，沒有登入者 uid 可以綁限速 key。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    limited_resp = _ip_rate_limited_response(request, group="usage_event_create", rate="120/m", method="POST")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    if not isinstance(data, dict):
        return JsonResponse({"detail": "請求格式錯誤"}, status=400)

    event_type = data.get("event_type")
    if event_type not in VALID_EVENT_TYPES:
        return JsonResponse({"detail": "不支援的事件類型"}, status=400)

    tribe = data.get("tribe") or ""
    if tribe and tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語：{tribe}"}, status=400)

    payload = data.get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return JsonResponse({"detail": "payload 必須是物件"}, status=400)
    # 粗略的大小上限——事件記錄是輕量的行為訊號，不該變成任意資料的傾倒場
    # （見規劃文件 P5 §1 的「輕量事件記錄表」定位）。序列化後量測長度比
    # 逐欄位檢查簡單，這裡不是效能熱點，不需要更精細的作法。
    if len(json.dumps(payload, ensure_ascii=False)) > _MAX_PAYLOAD_JSON_LENGTH:
        return JsonResponse({"detail": "payload 過大"}, status=400)

    if event_type == "quiz_answer":
        error = _validate_quiz_answer_payload(payload)
        if error:
            return JsonResponse({"detail": error}, status=400)

    uid = try_verify_firebase_token(request) or ""

    UsageEvent.objects.create(event_type=event_type, uid=uid, tribe=tribe, payload=payload)
    return JsonResponse({"detail": "已記錄"}, status=201)


# ---------------------------------------------------------------------------
# P5.1 儀表板真正圖表
# ---------------------------------------------------------------------------

class _DateRangeError(Exception):
    pass


_MAX_CUSTOM_DATE_RANGE_DAYS = 90


def _parse_date_range(request):
    """回傳 (start_date, end_date)，含頭尾兩端。date_range 查詢參數：
    today／7d／30d／custom（custom 需要另外帶 date_from/date_to，格式
    YYYY-MM-DD）。"""
    today = timezone.localdate()
    date_range = request.GET.get("date_range", "7d")
    if date_range == "today":
        return today, today
    if date_range == "7d":
        return today - timedelta(days=6), today
    if date_range == "30d":
        return today - timedelta(days=29), today
    if date_range == "custom":
        try:
            start = datetime.strptime(request.GET.get("date_from", ""), "%Y-%m-%d").date()
            end = datetime.strptime(request.GET.get("date_to", ""), "%Y-%m-%d").date()
        except ValueError:
            raise _DateRangeError("date_from/date_to 格式錯誤，需為 YYYY-MM-DD")
        if end < start:
            raise _DateRangeError("date_to 不能早於 date_from")
        # 沒有跨度上限的話，具 staff 角色的 client 可以要求例如
        # 0001-01-01 到 9999-12-31——即使資料庫沒資料，_fill_date_series()
        # 仍會建立數百萬個補零項目，dashboard 還會對 Firebase 執行全量
        # 掃描，可能讓 worker 長時間占用 CPU/記憶體、產生極大 JSON 回應
        # （獨立審查找到的問題）。跟 today／7d／30d 這幾個固定選項比對，
        # 90 天是這幾個既有選項裡最大的 30d 的 3 倍，足夠涵蓋一季的分析
        # 需求，不需要無上限。
        if (end - start).days + 1 > _MAX_CUSTOM_DATE_RANGE_DAYS:
            raise _DateRangeError(f"自訂日期區間不能超過 {_MAX_CUSTOM_DATE_RANGE_DAYS} 天")
        return start, end
    raise _DateRangeError(f"不支援的 date_range：{date_range}")


def _fill_date_series(counts_by_date, start_date, end_date):
    """把「只有真的有資料的日期」的分組結果，補成連續的每日序列（缺的日期
    補 0）——折線圖需要連續的 X 軸，不能因為某天剛好沒有任何事件就少一個
    點，那樣前端會誤畫成兩點之間直接連線，看起來像是有漸變趨勢。"""
    series = []
    day = start_date
    while day <= end_date:
        series.append({"date": day.isoformat(), "count": counts_by_date.get(day, 0)})
        day += timedelta(days=1)
    return series


def _join_date_to_local_date(raw):
    """把 Firestore joinDate（前端用 new Date().toISOString() 寫入的 UTC
    ISO 字串）轉成專案目前時區下的日期，跟 UsageEvent.created_at 用
    timezone.localtime(created_at).date() 是同一套轉換規則。原本
    _daily_new_registrations()／retention_analytics() 都直接對 UTC
    datetime 呼叫 .date()，沒有先轉成目前時區——如果 TIME_ZONE 設定不是
    UTC，會跟事件表的分日/分週依據不一致（例如當地時間週一凌晨註冊，
    joinDate 的 UTC 日期還是上一週，但同一時間的使用事件轉成當地日期後
    已經算本週，兩者的世代分組會錯開一週）。TIME_ZONE 目前是 UTC，這個
    轉換在正式環境暫時是 no-op，但寫對比較保險（獨立審查找到的問題）。
    解析失敗回傳 None，呼叫端自行決定要不要略過。"""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if timezone.is_naive(dt):
        # 正式環境的真實資料裡有些 joinDate 字串沒有時區資訊（沒有 "Z"
        # 也沒有 offset）——原本的寫法對這種值直接呼叫 .date()，naive
        # datetime 也能用；但 timezone.localtime() 要求輸入必須是 aware
        # datetime，naive 值會直接丟 ValueError。這裡假設沒有時區資訊的
        # 值本來就是 UTC（呼應前端寫入時一律用 UTC ISO 字串的慣例），
        # 補上時區後才轉換，不能讓這批既有的髒資料讓整個報表端點 500。
        dt = timezone.make_aware(dt, dt_timezone.utc)
    return timezone.localtime(dt).date()


def _daily_new_registrations(start_date, end_date):
    """依 joinDate（Firestore users/{uid} 的 ISO 字串）分組計算每日新註冊
    數——沿用 P3 user_views.py 已經接受的務實選擇：即時全量掃描 Firebase
    Auth + Firestore，不建影子索引/快取表（見規劃文件 P5「已知限制」）。"""
    users = firebase_ops.list_all_firebase_users()
    client = firebase_ops.get_firestore_client()
    refs = [client.collection("users").document(u.uid) for u in users]
    join_dates_by_uid = {}
    if refs:
        for doc in client.get_all(refs):
            if doc.exists:
                join_dates_by_uid[doc.id] = doc.to_dict().get("joinDate")

    counts = {}
    for user in users:
        raw = join_dates_by_uid.get(user.uid)
        if not raw:
            continue
        day = _join_date_to_local_date(raw)
        if day is None:
            continue
        if start_date <= day <= end_date:
            counts[day] = counts.get(day, 0) + 1

    return _fill_date_series(counts, start_date, end_date)


def dashboard_analytics(request):
    """儀表板真正圖表的聚合端點，取代 Dashboard.jsx 原本 5 個「即將推出」
    佔位。全部由 UsageEvent 聚合（新註冊例外——那是 Firebase Auth 才有的
    資料，UsageEvent 不知道使用者何時註冊）。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    try:
        start_date, end_date = _parse_date_range(request)
    except _DateRangeError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    tribe = request.GET.get("tribe", "")
    if tribe and tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語：{tribe}"}, status=400)

    qs = UsageEvent.objects.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)
    if tribe:
        qs = qs.filter(tribe=tribe)

    daily_active_counts = {
        row["day"]: row["count"]
        for row in (
            qs.exclude(uid="")
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(count=Count("uid", distinct=True))
        )
    }
    tribe_distribution = (
        qs.exclude(tribe="").values("tribe").annotate(count=Count("id")).order_by("-count")
    )
    feature_usage = qs.values("event_type").annotate(count=Count("id")).order_by("-count")

    return JsonResponse({
        "date_range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "daily_active_users": _fill_date_series(daily_active_counts, start_date, end_date),
        "daily_new_registrations": _daily_new_registrations(start_date, end_date),
        "tribe_distribution": [
            {"tribe": row["tribe"], "label": TRIBE_MAP.get(row["tribe"], row["tribe"]), "count": row["count"]}
            for row in tribe_distribution
        ],
        "feature_usage": [
            {
                "event_type": row["event_type"],
                "label": EVENT_TYPE_LABELS.get(row["event_type"], row["event_type"]),
                "count": row["count"],
            }
            for row in feature_usage
        ],
    })


# ---------------------------------------------------------------------------
# P5.2 搜尋分析
# ---------------------------------------------------------------------------

_SEARCH_RESULT_LIMIT = 100


def search_analytics(request):
    """熱門查詢／查無結果詞排行——都是對 event_type='dictionary_search' 的
    UsageEvent 聚合，`payload.query` 用 Lower(KeyTextTransform(...)) 取出
    文字後分組（Postgres 的 JSONB `->` 運算子取出來預設是 jsonb 型別，
    LOWER() 只接受文字，直接用 payload__query 當 annotate 來源會在資料庫
    層丟 UndefinedFunction；KeyTextTransform 對應 `->>`，取出來就是文字）。
    只做最基本的 trim（FastAPI 端寫入前已經 strip 過）/lower 正規化，不處理
    全形半形轉換、注音符號正規化等進階正規化——見規劃文件 P5「已知限制」，
    避免在還沒看過真實查詢分布之前過度設計。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    try:
        start_date, end_date = _parse_date_range(request)
    except _DateRangeError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    tribe = request.GET.get("tribe", "")
    if tribe and tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語：{tribe}"}, status=400)

    qs = UsageEvent.objects.filter(
        event_type="dictionary_search",
        created_at__date__gte=start_date, created_at__date__lte=end_date,
    )
    if tribe:
        qs = qs.filter(tribe=tribe)

    def _grouped(queryset):
        rows = (
            queryset.annotate(query=Lower(KeyTextTransform("query", "payload")))
            .exclude(query="").exclude(query__isnull=True)
            .values("query").annotate(count=Count("id")).order_by("-count")[:_SEARCH_RESULT_LIMIT]
        )
        return [{"query": row["query"], "count": row["count"]} for row in rows]

    popular_queries = _grouped(qs)
    # 查無結果：這一筆事件本身命中數是 0，不是「這個查詢字串從來沒有命中
    # 過」——同一個查詢字串在別的時間/別的族語篩選下有命中，也完全可能
    # 同時出現在兩份清單裡，這是符合規劃文件 §3 定義的預期行為。
    zero_result_queries = _grouped(qs.filter(payload__exact_hit_count=0, payload__fuzzy_hit_count=0))

    return JsonResponse({
        "date_range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "popular_queries": popular_queries,
        "zero_result_queries": zero_result_queries,
    })


# ---------------------------------------------------------------------------
# P5.3 題目品質分析
# ---------------------------------------------------------------------------

# item_kind -> 後台題庫管理頁面路徑，給前端「點擊散佈圖上的點跳去題庫編輯」
# 用。這幾個頁面都是「列表 + 就地編輯」，沒有個別項目的專屬網址（見
# frontend/src/_admin/AdminApp.jsx 的路由），只能導到列表頁本身，管理者
# 自己用列表的搜尋/篩選找到那一題——連同下面附上的 label 一起，至少知道
# 要找的是哪一題，不是完全沒有頭緒。
_ITEM_KIND_LIST_PATH = {
    "true_false": "/admin/quiz-bank/true-false",
    "choice": "/admin/quiz-bank/choice",
    "matching": "/admin/quiz-bank/vocab",
    "cloze": "/admin/quiz-bank/vocab",
    "situation": "/admin/quiz-bank/situations",
}

# 高低分組法（classical test theory 的 27% 法）需要的最低樣本量——
# 使用者/流量還小的階段，人數太少時算出來的鑑別度是雜訊不是訊號，寧可
# 誠實標成「樣本不足」也不要畫一個可能誤導的點（見規劃文件 P5 §4(c)）。
_MIN_ITEM_RESPONSES = 20
_MIN_RANKABLE_RESPONDENTS = 10
_HIGH_LOW_GROUP_FRACTION = 0.27


def _resolve_item_labels(keys):
    """batch 查詢每個 (item_kind, item_id) 對應的顯示用文字——四種題型的
    item_id 語意完全不同（三種是資料庫 pk，克漏字是 "passageId:blankKey"
    複合字串，配合題的 item_id 其實是 QuizVocabItem 的 pk，見
    backend/crawler/views.py 的說明），沒有共用查詢，只能分開處理。"""
    labels = {}

    tf_ids = [item_id for kind, item_id in keys if kind == "true_false"]
    if tf_ids:
        for row in QuizTrueFalseItem.objects.filter(id__in=tf_ids).values("id", "question_ch"):
            labels[("true_false", row["id"])] = row["question_ch"]

    choice_ids = [item_id for kind, item_id in keys if kind == "choice"]
    if choice_ids:
        for row in QuizChoiceItem.objects.filter(id__in=choice_ids).values("id", "question_ch"):
            labels[("choice", row["id"])] = row["question_ch"]

    matching_ids = [item_id for kind, item_id in keys if kind == "matching"]
    if matching_ids:
        for row in QuizVocabItem.objects.filter(id__in=matching_ids).values("id", "foreign_word", "chinese_gloss"):
            labels[("matching", row["id"])] = f"{row['foreign_word']}／{row['chinese_gloss']}"

    situation_ids = [item_id for kind, item_id in keys if kind == "situation"]
    if situation_ids:
        for row in QuizSituationItem.objects.filter(id__in=situation_ids).values("id", "scenario_chinese"):
            labels[("situation", row["id"])] = row["scenario_chinese"][:40]

    # 克漏字的 item_id 是 "passageId:blankKey"，先拆出唯一的 passage id
    # 集合，一次查完再組回每個 (kind, item_id) 的 label。
    cloze_keys = [item_id for kind, item_id in keys if kind == "cloze"]
    if cloze_keys:
        passage_ids = set()
        for item_id in cloze_keys:
            passage_id_str, _, _blank_key = item_id.partition(":")
            if passage_id_str.isdigit():
                passage_ids.add(int(passage_id_str))
        passages_by_id = dict(
            QuizClozePassage.objects.filter(id__in=passage_ids).values_list("id", "passage_chinese")
        )
        for item_id in cloze_keys:
            passage_id_str, _, blank_key = item_id.partition(":")
            passage_chinese = passages_by_id.get(int(passage_id_str)) if passage_id_str.isdigit() else None
            if passage_chinese is not None:
                labels[("cloze", item_id)] = f"{passage_chinese[:30]}（{blank_key}）"

    return labels


def quiz_quality_analytics(request):
    """答對率×鑑別度散佈圖的聚合端點。鑑別度用古典測驗理論的「高低分組法」
    （27% 法）——不需要常態分布假設，實作直觀，教育測驗領域的標準做法
    之一：對每個受試者算「這段期間總作答正確題數比例」排序，取前 27%
    （高分組）與後 27%（低分組），一題的鑑別度 = 高分組在這題的答對率
    − 低分組在這題的答對率。不含 IRT 適性測驗（recommon）——那個系統
    現況只存累積聚合數字、沒有逐次記錄，且題目是即時從辭典動態組出來，
    沒有一個「題庫編輯頁」可以跳過去（見規劃文件 P5「使用者已確認的範圍
    決策」第 1 點）。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    try:
        start_date, end_date = _parse_date_range(request)
    except _DateRangeError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    tribe = request.GET.get("tribe", "")
    if tribe and tribe not in TRIBE_IDS:
        return JsonResponse({"detail": f"不支援的族語：{tribe}"}, status=400)

    qs = UsageEvent.objects.filter(
        event_type="quiz_answer",
        created_at__date__gte=start_date, created_at__date__lte=end_date,
    ).exclude(uid="")
    if tribe:
        qs = qs.filter(tribe=tribe)

    # 攤平成 (uid, item_kind, item_id, correct) 記錄——後面要同時做「逐使用者
    # 總分排名」跟「逐題分組計數」兩種不同維度的聚合，資料量現階段（使用
    # 事件表，不是辭典那種數十萬列的表）不大，Python 端處理比在 SQL 端疊
    # window function 直接得多。
    records = []
    for uid, payload in qs.values_list("uid", "payload"):
        item_kind = payload.get("item_kind")
        item_id = payload.get("item_id")
        correct = payload.get("correct")
        # 讀取端也做一次防禦性檢查，不只依賴寫入端的驗證——歷史資料可能是
        # 這次修正之前寫入的：型別不對的 item_kind/item_id（例如 list/dict）
        # 會讓底下當 (item_kind, item_id) 雜湊 key 直接 500（unhashable
        # type）；correct 不是嚴格布林值也不該用 bool() 強制轉換，那樣字串
        # "false" 會變成 True，靜默扭曲答對率。
        if not isinstance(item_kind, str) or isinstance(item_id, bool) or not isinstance(item_id, (int, str)):
            continue
        if type(correct) is not bool:
            continue
        records.append((uid, item_kind, item_id, correct))

    user_totals = defaultdict(lambda: [0, 0])  # uid -> [correct_count, total_count]
    for uid, _kind, _id, correct in records:
        user_totals[uid][1] += 1
        if correct:
            user_totals[uid][0] += 1

    ranked_uids = sorted(user_totals, key=lambda u: user_totals[u][0] / user_totals[u][1], reverse=True)
    n_users = len(ranked_uids)
    group_size = max(1, round(n_users * _HIGH_LOW_GROUP_FRACTION))
    high_group = set(ranked_uids[:group_size])
    low_group = set(ranked_uids[-group_size:])

    item_stats = defaultdict(lambda: {
        "total": 0, "correct": 0, "high_total": 0, "high_correct": 0, "low_total": 0, "low_correct": 0,
    })
    for uid, item_kind, item_id, correct in records:
        stat = item_stats[(item_kind, item_id)]
        stat["total"] += 1
        if correct:
            stat["correct"] += 1
        if uid in high_group:
            stat["high_total"] += 1
            if correct:
                stat["high_correct"] += 1
        elif uid in low_group:
            stat["low_total"] += 1
            if correct:
                stat["low_correct"] += 1

    labels = _resolve_item_labels(item_stats.keys())

    items = []
    for (item_kind, item_id), stat in item_stats.items():
        sufficient = (
            stat["total"] >= _MIN_ITEM_RESPONSES
            and n_users >= _MIN_RANKABLE_RESPONDENTS
            and stat["high_total"] > 0
            and stat["low_total"] > 0
        )
        discrimination = None
        if sufficient:
            discrimination = (stat["high_correct"] / stat["high_total"]) - (stat["low_correct"] / stat["low_total"])

        items.append({
            "item_kind": item_kind,
            "item_id": item_id,
            "label": labels.get((item_kind, item_id), ""),
            "list_path": _ITEM_KIND_LIST_PATH.get(item_kind, ""),
            "attempt_count": stat["total"],
            "accuracy_rate": round(stat["correct"] / stat["total"], 4),
            "discrimination": round(discrimination, 4) if discrimination is not None else None,
            "sufficient_sample": sufficient,
        })

    items.sort(key=lambda item: item["attempt_count"], reverse=True)

    return JsonResponse({
        "date_range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "respondent_count": n_users,
        "items": items,
    })


# ---------------------------------------------------------------------------
# P5.4 留存分析
# ---------------------------------------------------------------------------

# 熱力圖最多顯示幾週——這個平台目前上線才幾天，世代自然不會累積出太多
# 週次；設上限只是避免回應無限成長，不是因為已經觀察到需要裁切的資料量。
_RETENTION_MAX_WEEKS = 12


def _week_start(day):
    """ISO 週一為一週起點（Python 的 date.weekday()：週一是 0）。"""
    return day - timedelta(days=day.weekday())


def retention_analytics(request):
    """世代留存熱力圖——以 joinDate 所在週分組，對每個世代之後的每個週次，
    計算「該週有 ≥1 筆任意 event_type 的 UsageEvent」的使用者比例。用
    「任意事件」而非限定特定類型，因為留存的定義是「這個人還在用」，不是
    「還在用某個特定功能」（見規劃文件 P5 §5）。

    不像其餘 P5 端點那樣支援 date_range/tribe 篩選——世代分析本質上就是
    橫跨全部歷史時間的視角，篩單一區間或單一族語會讓「世代」這個概念失去
    意義。查詢方式是 Python 端把 Firebase 使用者清單跟 UsageEvent 的
    (uid, week) 組合做集合運算，不寫成複雜 SQL（沿用 P3 使用者列表、
    P5.1 新註冊統計同一種「先求對、務實優先」的選擇）。

    每個世代只回傳「已經過完」的週次（weeks_elapsed，超過 _RETENTION_MAX_WEEKS
    再裁切）——本週剛註冊的世代還沒有機會產生第 1 週的留存資料，不該顯示
    成 0%（那是「還沒發生」不是「發生了但沒留住人」），前端看不到的欄位
    就是還沒到那個時間點，不是資料缺漏。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    users = firebase_ops.list_all_firebase_users()
    client = firebase_ops.get_firestore_client()
    refs = [client.collection("users").document(u.uid) for u in users]
    cohort_start_by_uid = {}
    if refs:
        for doc in client.get_all(refs):
            if not doc.exists:
                continue
            raw = doc.to_dict().get("joinDate")
            if not raw:
                continue
            join_date = _join_date_to_local_date(raw)
            if join_date is None:
                continue
            cohort_start_by_uid[doc.id] = _week_start(join_date)

    if not cohort_start_by_uid:
        return JsonResponse({"cohorts": [], "max_weeks": _RETENTION_MAX_WEEKS})

    cohort_uids = defaultdict(set)
    for uid, cohort_start in cohort_start_by_uid.items():
        cohort_uids[cohort_start].add(uid)

    active_weeks_by_uid = defaultdict(set)
    events = (
        UsageEvent.objects.filter(uid__in=cohort_start_by_uid.keys())
        .values_list("uid", "created_at")
    )
    for uid, created_at in events:
        active_weeks_by_uid[uid].add(_week_start(timezone.localtime(created_at).date()))

    today_week_start = _week_start(timezone.localdate())

    cohorts = []
    for cohort_start in sorted(cohort_uids):
        uids = cohort_uids[cohort_start]
        weeks_elapsed = (today_week_start - cohort_start).days // 7
        # 只回傳「已經過完」的週次：week_offset=0（世代自己的加入週）永遠
        # 回傳，即使還在進行中也一樣（世代分析的慣例基準點）；week_offset
        # >= 1 只有在那一週已經完整結束後才回傳。原本直接用 weeks_elapsed
        # 當上界，會多算進目前還在進行中的那一週——例如世代是上週
        # （weeks_elapsed=1），range 卻跑到 week_offset=1，那正好是本週，
        # 還沒結束，會把「還沒發生」的資料當成「量測到偏低留存」顯示出來，
        # 跟這支函式自己的說明矛盾（獨立審查找到的問題）。
        included_weeks = min(max(1, weeks_elapsed), _RETENTION_MAX_WEEKS)
        retention = []
        for week_offset in range(included_weeks):
            target_week = cohort_start + timedelta(weeks=week_offset)
            active_count = sum(1 for uid in uids if target_week in active_weeks_by_uid.get(uid, ()))
            retention.append({
                "week_offset": week_offset,
                "active_count": active_count,
                "rate": round(active_count / len(uids), 4),
            })
        cohorts.append({
            "cohort_start": cohort_start.isoformat(),
            "cohort_size": len(uids),
            "retention": retention,
        })

    return JsonResponse({"cohorts": cohorts, "max_weeks": _RETENTION_MAX_WEEKS})
