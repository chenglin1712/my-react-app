"""服務對服務的內部端點（FastAPI → Django）。

目前只有一個：FastAPI 的翻譯在呼叫付費 LLM 前，通知這裡評估一次 AI 月預算（見 fastAPI/budget_guard.py）。
預算的評估與關閉旗標只能在 Django 做（要彙總 AiUsageLog、套價目表、寫稽核紀錄），而 Django 自己的 AI 請求以外
沒有人會觸發它——只有翻譯在花錢時，預算保護就等於沒有（稽核 AI-1）。

認證：共用密鑰 INTERNAL_API_SECRET 放在 X-Internal-Secret 標頭，至少 32 字元，用 hmac.compare_digest 比對，
沒設定或太短一律 503（fail-closed）。nginx 對 /adminapi/internal/ 一律拒絕（deploy/nginx.conf），
只有同機的 FastAPI 直連 127.0.0.1:8000 打得到；密鑰是第二層。依 IP 限流，擋猜測密鑰的暴力嘗試。
"""
import hmac
import logging
import os

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.internal_api import secret_problem

from . import ai_budget
from ._shared import ip_rate_limited_response

logger = logging.getLogger(__name__)


@csrf_exempt
def ai_budget_enforce(request):
    """評估 AI 月預算並在超過時關閉付費功能的旗標，回傳目前等級（不回花費金額）。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited = ip_rate_limited_response(request, group="internal_ai_budget_enforce", rate="30/m", method="POST")
    if limited:
        return limited

    secret = os.getenv("INTERNAL_API_SECRET", "")
    problem = secret_problem(secret)
    if not secret or problem:
        if problem:
            logger.error("內部端點拒絕服務：%s", problem)
        return JsonResponse({"detail": "internal secret 未設定或不合格"}, status=503)
    provided = request.headers.get("X-Internal-Secret", "")
    if not provided or not hmac.compare_digest(provided.encode("utf-8"), secret.encode("utf-8")):
        return JsonResponse({"detail": "unauthorized"}, status=401)

    return JsonResponse({"level": ai_budget.enforce()["level"]})
