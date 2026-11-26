"""系統維運「快取管理」頁面的端點——列出已知具名快取＋兩個清除動作
（Django 自己的／通知 FastAPI 的），見 system_cache.py 的說明。"""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import (
    guarded_action,
    mark_action_failed as _mark_action_failed,
    write_audit_log_first as _write_audit_log_first,
)
from .system_cache import DJANGO_NAMED_CACHE_KEYS, clear_django_caches, clear_fastapi_caches


@csrf_exempt
def system_cache_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    return JsonResponse({
        "django_caches": [{"key": key, "description": desc} for key, desc in DJANGO_NAMED_CACHE_KEYS.items()],
    })


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("system_cache_clear_django", "10/m"))
def system_cache_clear_django(request, decoded):
    # 稽核 BE2a-08：先寫稽核紀錄再清（清快取沒辦法回滾），寫不進去就不動手
    _write_audit_log_first(
        request, decoded, "clear_django_cache", "django",
        after={"cleared_keys": list(DJANGO_NAMED_CACHE_KEYS)}, target_type="system_cache",
    )
    try:
        cleared = clear_django_caches()
    except Exception:
        _mark_action_failed(request, decoded, "clear_django_cache", "django", target_type="system_cache", reason="cache_error")
        raise
    return JsonResponse({"cleared_keys": cleared})


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("system_cache_clear_fastapi", "10/m"))
def system_cache_clear_fastapi(request, decoded):
    _write_audit_log_first(request, decoded, "clear_fastapi_cache", "fastapi", target_type="system_cache")
    success, result = clear_fastapi_caches()
    if not success:
        _mark_action_failed(request, decoded, "clear_fastapi_cache", "fastapi", target_type="system_cache", reason="fastapi_unreachable")
        # 稽核 BE1-05：不把內部錯誤細節（網址、例外內容）回給前端
        return JsonResponse({"detail": "通知 FastAPI 清除快取失敗，請稍後再試"}, status=502)
    return JsonResponse({"result": result})
