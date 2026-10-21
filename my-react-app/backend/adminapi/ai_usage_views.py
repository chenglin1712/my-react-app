"""後台「AI 用量」頁的資料端點：唯讀，只回傳彙總數字（不含 prompt 或模型輸出，
紀錄本身就沒有存這些）。權限比照功能開關頁的查看：所有後台角色都能看。
"""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import STAFF_ROLES

from . import ai_usage

_DEFAULT_DAYS = 7


@csrf_exempt
def ai_usage_summary(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    raw_days = request.GET.get("days", str(_DEFAULT_DAYS))
    try:
        days = int(raw_days)
    except ValueError:
        return JsonResponse({"detail": "days 必須是整數"}, status=400)
    if not 1 <= days <= ai_usage.MAX_DAYS:
        return JsonResponse({"detail": f"days 必須介於 1 到 {ai_usage.MAX_DAYS}"}, status=400)

    return JsonResponse(ai_usage.summarize(days))
