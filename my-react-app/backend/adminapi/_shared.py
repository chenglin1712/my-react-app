"""adminapi 內部共用、跟任何特定內容型別無關的小工具。

原本 _rate_limited_response／_ip_rate_limited_response／_parse_json_body／
_write_audit_log／_invalid_transition 定義在 views.py，quizbank_views.py
從那裡 import。新增的 revisions.py（已發布內容的編輯中修改）也需要同一批
工具，但 views.py 之後要反過來 import revisions.py 的函式給 Announcement
的端點用——views.py 依賴 revisions.py、revisions.py 又依賴 views.py 會
造成循環 import，所以把這批完全通用（不碰任何特定 model）的工具抽到這裡，
views.py／quizbank_views.py／revisions.py 三邊都改成從這裡 import，
views.py 保留原本的名稱重新 export，外部既有的 `from .views import X`
不用改。
"""
import json

from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited

from .models import AuditLog


def rate_limited_response(request, decoded, group, rate="60/m", method="POST"):
    """依已登入使用者的 uid 限速，邏輯與 AIModel/views.py、CrosswordPuzzle/views.py 一致。"""
    uid = decoded.get("uid", "anon")
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


def ip_rate_limited_response(request, group, rate="60/m", method="GET"):
    """給匿名公開端點用（沒有登入者 uid 可綁），依 IP 限速。"""
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: client_ip,
        rate=rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


def parse_json_body(request):
    """回傳 (data, error_response)；格式錯誤回 400 而不是讓 JSONDecodeError
    一路往外拋變成 Django 預設的 500 HTML 頁（跟全站其他端點的慣例一致）。"""
    if not request.body:
        return {}, None
    try:
        return json.loads(request.body), None
    except json.JSONDecodeError:
        return None, JsonResponse({"detail": "請求格式錯誤"}, status=400)


def write_audit_log(request, decoded, action, target, before=None, after=None, target_type="announcement"):
    """target_type 預設 "announcement" 是為了不動到既有呼叫點——這個函式
    最早只給 Announcement 用，後來加入的資源呼叫時要記得自己帶對應的
    target_type，不然會被誤記成公告的稽核紀錄。"""
    AuditLog.objects.create(
        actor_uid=decoded.get("uid", "anon"),
        actor_role=decoded.get("role"),
        action=action,
        target_type=target_type,
        target_id=str(target.pk),
        before=before,
        after=after,
        ip_address=request.META.get("REMOTE_ADDR"),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:1000] or None),
    )


def invalid_transition(current_status, action):
    return JsonResponse(
        {"detail": f"目前狀態「{current_status}」無法執行「{action}」"},
        status=409,
    )
