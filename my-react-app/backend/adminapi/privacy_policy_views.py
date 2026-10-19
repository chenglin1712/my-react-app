"""「隱私與資料」頁內文的後台管理端點＋公開讀取端點。

單例資料，寫法比照 homepage_config_views：檢視開放所有後台人員，修改只給擁有者與管理員
（這段文字是對訪客的公開說明，視同「發布」動作，不開放 editor 自行更動）。
"""
from django.db import transaction
from django.http import JsonResponse
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import (
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import PrivacyPolicy
from .serializers import PrivacyPolicySerializer, PublicPrivacyPolicySerializer


@csrf_exempt
def privacy_policy_admin(request):
    if request.method == "GET":
        _, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        return JsonResponse(PrivacyPolicySerializer(PrivacyPolicy.load()).data)
    if request.method == "PATCH":
        return _update_privacy_policy(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _update_privacy_policy(request):
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="privacy_policy_update", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    if not isinstance(data, dict) or "content" not in data:
        return JsonResponse({"detail": "請求參數錯誤", "errors": {"content": ["缺少內文"]}}, status=400)

    PrivacyPolicy.load()  # 確保單例那筆存在，鎖之前才有列可鎖
    with transaction.atomic():
        policy = PrivacyPolicy.objects.select_for_update().get(pk=1)
        # 樂觀鎖：編輯頁帶著載入時的 updated_at，期間若有別人先存過就拒絕，避免後存的人無聲蓋掉先存的
        base = parse_datetime(data["base_updated_at"]) if isinstance(data.get("base_updated_at"), str) else None
        if base is None:
            return JsonResponse({"detail": "請求參數錯誤", "errors": {"base_updated_at": ["缺少或格式不正確"]}}, status=400)
        if base != policy.updated_at:
            return JsonResponse({"detail": "內容已被其他人更新，請重新整理頁面，確認最新內容後再編輯"}, status=409)
        before = PrivacyPolicySerializer(policy).data
        serializer = PrivacyPolicySerializer(policy, data={"content": data["content"]}, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        policy = serializer.save(updated_by=decoded.get("uid", "anon"))
        _write_audit_log(
            request, decoded, "update", policy, target_type="privacy_policy",
            before=before, after=PrivacyPolicySerializer(policy).data,
        )
    return JsonResponse(PrivacyPolicySerializer(policy).data)


def public_privacy_policy(request):
    """公開隱私與資料頁讀取用，不需要登入。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_privacy_policy", rate="120/m")
    if limited_resp:
        return limited_resp
    response = JsonResponse(PublicPrivacyPolicySerializer(PrivacyPolicy.load()).data)
    # 與首頁設定相同：每次重新驗證，後台儲存後立即生效
    response["Cache-Control"] = "no-cache"
    return response
