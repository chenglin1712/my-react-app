"""首頁版位設定的後台管理端點＋公開讀取端點，從 views.py 抽出來（P4 review
BE-16：原本的 views.py 把 Announcement／考試時程／首頁版位三種不相關的
資源焊在同一個檔案裡）。"""
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import (
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import HomepageConfig
from .serializers import HomepageConfigSerializer, PublicHomepageConfigSerializer


@csrf_exempt
def homepage_config_admin(request):
    if request.method == "GET":
        return _get_homepage_config(request)
    if request.method == "PATCH":
        return _update_homepage_config(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _get_homepage_config(request):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    config = HomepageConfig.load()
    return JsonResponse(HomepageConfigSerializer(config).data)


def _update_homepage_config(request):
    # PUBLISHERS：這個設定直接影響公開首頁的實際顯示內容，視同「發布」動作，
    # 跟 Announcement 的核准/發布同一層級（owner／admin），不開放給 editor
    # 自己就能改公開首頁看起來的樣子。
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="homepage_config_update", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    HomepageConfig.load()  # 確保單例那筆存在，鎖之前才有列可鎖
    with transaction.atomic():
        config = HomepageConfig.objects.select_for_update().get(pk=1)
        before = HomepageConfigSerializer(config).data
        serializer = HomepageConfigSerializer(config, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        config = serializer.save(updated_by=decoded.get("uid", "anon"))

        _write_audit_log(
            request, decoded, "update", config, target_type="homepage_config",
            before=before, after=HomepageConfigSerializer(config).data,
        )
    return JsonResponse(HomepageConfigSerializer(config).data)


def public_homepage_config(request):
    """公開首頁讀取用，不需要登入。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_homepage_config", rate="120/m")
    if limited_resp:
        return limited_resp
    config = HomepageConfig.load()
    return JsonResponse(PublicHomepageConfigSerializer(config).data)
