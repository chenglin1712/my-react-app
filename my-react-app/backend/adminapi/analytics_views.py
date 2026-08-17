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

這幾個端點本身只做 HTTP 邊界的事（method 檢查、角色檢查、request 參數
解析、JsonResponse 包裝），實際的聚合計算與驗證規則都在 analytics_service.py
（P4 review BE-16：原本聚合邏輯直接寫在 view function 裡，兩種關注點混在
一起，改一次聚合公式就得動到整個 view）。
"""
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role, try_verify_firebase_token
from config.roles import STAFF_ROLES
from config.tribes import TRIBE_IDS

from . import analytics_service as svc
from ._shared import ip_rate_limited_response as _ip_rate_limited_response, parse_json_body as _parse_json_body
from .models import UsageEvent

# test_analytics.py 原本直接 `from .analytics_views import _join_date_to_local_date`
# 做單元測試——實作搬到 analytics_service.py 之後，這裡重新匯出同一個名稱，
# 呼叫路徑不必更動。
_join_date_to_local_date = svc._join_date_to_local_date


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
    if event_type not in svc.VALID_EVENT_TYPES:
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
    if len(json.dumps(payload, ensure_ascii=False)) > svc._MAX_PAYLOAD_JSON_LENGTH:
        return JsonResponse({"detail": "payload 過大"}, status=400)

    if event_type == "quiz_answer":
        error = svc.validate_quiz_answer_payload(payload)
        if error:
            return JsonResponse({"detail": error}, status=400)

    uid = try_verify_firebase_token(request) or ""

    UsageEvent.objects.create(event_type=event_type, uid=uid, tribe=tribe, payload=payload)
    return JsonResponse({"detail": "已記錄"}, status=201)


def _parse_date_range_and_tribe(request):
    """dashboard/search/quiz_quality 三個端點共用的參數解析：date_range +
    tribe。回傳 (start_date, end_date, tribe, error_response)——error_response
    非 None 時，呼叫端直接回傳它。"""
    try:
        start_date, end_date = svc.parse_date_range(
            request.GET.get("date_range", "7d"),
            request.GET.get("date_from", ""),
            request.GET.get("date_to", ""),
        )
    except svc.DateRangeError as exc:
        return None, None, None, JsonResponse({"detail": str(exc)}, status=400)

    tribe = request.GET.get("tribe", "")
    if tribe and tribe not in TRIBE_IDS:
        return None, None, None, JsonResponse({"detail": f"不支援的族語：{tribe}"}, status=400)

    return start_date, end_date, tribe, None


# ---------------------------------------------------------------------------
# P5.1 儀表板真正圖表
# ---------------------------------------------------------------------------

def dashboard_analytics(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    start_date, end_date, tribe, err_resp = _parse_date_range_and_tribe(request)
    if err_resp:
        return err_resp

    return JsonResponse(svc.build_dashboard_analytics(start_date, end_date, tribe))


# ---------------------------------------------------------------------------
# P5.2 搜尋分析
# ---------------------------------------------------------------------------

def search_analytics(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    start_date, end_date, tribe, err_resp = _parse_date_range_and_tribe(request)
    if err_resp:
        return err_resp

    return JsonResponse(svc.build_search_analytics(start_date, end_date, tribe))


# ---------------------------------------------------------------------------
# P5.3 題目品質分析
# ---------------------------------------------------------------------------

def quiz_quality_analytics(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    start_date, end_date, tribe, err_resp = _parse_date_range_and_tribe(request)
    if err_resp:
        return err_resp

    return JsonResponse(svc.build_quiz_quality_analytics(start_date, end_date, tribe))


# ---------------------------------------------------------------------------
# P5.4 留存分析
# ---------------------------------------------------------------------------

def retention_analytics(request):
    """不像其餘 P5 端點那樣支援 date_range/tribe 篩選——世代分析本質上就是
    橫跨全部歷史時間的視角，見 analytics_service.build_retention_analytics()
    的完整說明。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    return JsonResponse(svc.build_retention_analytics())
