"""限流設定的後台管理端點。

RateLimitRule 的列不是後台自由新增/刪除的東西——它們對應程式碼裡實際
存在的限流呼叫點，由 seed_rate_limit_rules 管理指令維護（新增呼叫點時
重跑指令即可補上）；這裡只開放「查看目前全部規則」與「調整某一筆的
rate 值」，key／backend／description／default_rate 都是唯讀（見
RateLimitRuleSerializer 的 read_only_fields）。
"""
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import (
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import RateLimitRule
from .serializers import RateLimitRuleSerializer


@csrf_exempt
def rate_limit_rule_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    rules = RateLimitRule.objects.all()
    backend = request.GET.get("backend")
    if backend:
        rules = rules.filter(backend=backend)

    return JsonResponse({"results": RateLimitRuleSerializer(rules, many=True).data})


@csrf_exempt
def rate_limit_rule_detail(request, pk):
    if request.method == "GET":
        decoded, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        obj = get_object_or_404(RateLimitRule, pk=pk)
        return JsonResponse(RateLimitRuleSerializer(obj).data)

    if request.method == "PATCH":
        decoded, err_resp = require_role(request, PUBLISHERS)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="rate_limit_rule_update", rate="30/m")
        if limited_resp:
            return limited_resp

        data, err_resp = _parse_json_body(request)
        if err_resp:
            return err_resp

        obj = get_object_or_404(RateLimitRule, pk=pk)
        before = RateLimitRuleSerializer(obj).data
        # 只有 rate 這個欄位是真的可寫（見 RateLimitRuleSerializer 的
        # read_only_fields）——即使呼叫端多帶了 key/backend 之類的欄位，
        # partial=True 的 ModelSerializer 對唯讀欄位一律忽略，不會報錯，
        # 也不會意外被改動。
        serializer = RateLimitRuleSerializer(obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        serializer.save(updated_by=decoded.get("uid", "anon"))
        _write_audit_log(
            request, decoded, "update", obj,
            before=before, after=RateLimitRuleSerializer(obj).data, target_type="rate_limit_rule",
        )
        return JsonResponse(RateLimitRuleSerializer(obj).data)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


def public_fastapi_rate_limit_rules(request):
    """給 FastAPI rate_limit_config.py 輪詢用，無需登入——比照
    public_game_config／public_irt_config 的公開唯讀模式。只回傳
    backend=fastapi 的規則（Django 自己的限流值不需要跨服務查詢），
    格式是扁平的 {key: rate} 字典，不是逐筆物件陣列——FastAPI 端只需要
    「這個 key 現在的 rate 是多少」，不需要 id／description 這些後台
    維運資訊。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_fastapi_rate_limit_rules", rate="120/m")
    if limited_resp:
        return limited_resp

    rules = RateLimitRule.objects.filter(backend=RateLimitRule.BACKEND_FASTAPI).values_list("key", "rate")
    return JsonResponse({"rules": dict(rules)})
