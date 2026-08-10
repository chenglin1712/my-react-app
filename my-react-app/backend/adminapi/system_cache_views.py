"""系統維運「快取管理」頁面的端點——列出已知具名快取＋兩個清除動作
（Django 自己的／通知 FastAPI 的），見 system_cache.py 的說明。"""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import rate_limited_response as _rate_limited_response, write_audit_log as _write_audit_log
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
def system_cache_clear_django(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="system_cache_clear_django", rate="10/m")
    if limited_resp:
        return limited_resp

    cleared = clear_django_caches()
    _write_audit_log(
        request, decoded, "clear_django_cache", "django",
        after={"cleared_keys": cleared}, target_type="system_cache",
    )
    return JsonResponse({"cleared_keys": cleared})


@csrf_exempt
def system_cache_clear_fastapi(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="system_cache_clear_fastapi", rate="10/m")
    if limited_resp:
        return limited_resp

    success, result = clear_fastapi_caches()
    _write_audit_log(
        request, decoded, "clear_fastapi_cache", "fastapi",
        after={"success": success, "result": result}, target_type="system_cache",
    )
    if not success:
        return JsonResponse({"detail": result}, status=502)
    return JsonResponse({"result": result})
