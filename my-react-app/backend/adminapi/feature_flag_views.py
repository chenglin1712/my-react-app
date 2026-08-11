"""功能開關的後台管理端點。

FeatureFlag 的列不是後台自由新增/刪除的東西（跟 RateLimitRule 同一種
設計）——這批 key 由 seed_feature_flags 管理指令維護；這裡只開放「查看
目前全部開關」與「切換某一筆的 enabled」，key／label／description 都是
唯讀（見 FeatureFlagSerializer 的 read_only_fields）。
"""
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import FeatureFlag
from .serializers import FeatureFlagSerializer


@csrf_exempt
def feature_flag_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    flags = FeatureFlag.objects.all()
    return JsonResponse({"results": FeatureFlagSerializer(flags, many=True).data})


@csrf_exempt
def feature_flag_detail(request, pk):
    if request.method == "GET":
        decoded, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        obj = get_object_or_404(FeatureFlag, pk=pk)
        return JsonResponse(FeatureFlagSerializer(obj).data)

    if request.method == "PATCH":
        decoded, err_resp = require_role(request, PUBLISHERS)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="feature_flag_update", rate="30/m")
        if limited_resp:
            return limited_resp

        data, err_resp = _parse_json_body(request)
        if err_resp:
            return err_resp

        with transaction.atomic():
            obj = get_object_or_404(FeatureFlag.objects.select_for_update(), pk=pk)
            before = FeatureFlagSerializer(obj).data
            serializer = FeatureFlagSerializer(obj, data=data, partial=True)
            if not serializer.is_valid():
                return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
            serializer.save(updated_by=decoded.get("uid", "anon"))
            _write_audit_log(
                request, decoded, "update", obj,
                before=before, after=FeatureFlagSerializer(obj).data, target_type="feature_flag",
            )
        return JsonResponse(FeatureFlagSerializer(obj).data)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
