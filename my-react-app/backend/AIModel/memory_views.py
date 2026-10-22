"""「我的學習記憶」頁用的端點（路線圖 #21）：檢視、編輯單一檔案、刪除單一檔案、全部清除、同意與撤回。

- GET    /AIModel/memory/           狀態與全部檔案（旗標關閉時照樣能看，才有辦法清除自己的資料）
- DELETE /AIModel/memory/           全部清除（保留同意）
- POST   /AIModel/memory/consent/   {"granted": true|false}；同意需要功能旗標開啟，撤回隨時可以並刪光記憶
- PUT    /AIModel/memory/file/      {"path", "content"} 修改一個既有檔案（走和模型相同的路徑與內容檢查）
- DELETE /AIModel/memory/file/?path=...  刪除一個檔案

uid 一律來自 verify_firebase_token，請求裡不收 uid；所以只能動到自己的記憶。
"""
import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django_ratelimit.core import is_ratelimited
from rest_framework import serializers

from adminapi.rate_limits import get_configured_rate
from core.firebase_auth import verify_firebase_token

from . import memory_store

logger = logging.getLogger(__name__)

RATE_GROUP = "learner_memory"


class ConsentSerializer(serializers.Serializer):
    granted = serializers.BooleanField()


class FileWriteSerializer(serializers.Serializer):
    path = serializers.CharField(max_length=memory_store.MAX_PATH_CHARS)
    content = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=memory_store.MAX_FILE_CHARS * 2)


class FileDeleteSerializer(serializers.Serializer):
    path = serializers.CharField(max_length=memory_store.MAX_PATH_CHARS)


def _auth(request, methods):
    """驗證方法與登入；回傳 (uid, 錯誤回應)。變更資料的方法才計入限速。"""
    if request.method not in methods:
        return None, JsonResponse({"detail": "不支援的請求方法"}, status=405)
    decoded, err_resp = verify_firebase_token(request)
    if err_resp:
        return None, err_resp
    uid = decoded.get("uid", "")
    if not uid:
        return None, JsonResponse({"detail": "找不到使用者"}, status=401)
    if request.method != "GET" and is_ratelimited(
        request, group=RATE_GROUP, key=lambda g, r: uid,
        rate=get_configured_rate(RATE_GROUP, "30/m"), method=request.method, increment=True,
    ):
        return None, JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return uid, None


def _body(request, serializer_class):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse({"detail": "請求格式錯誤"}, status=400)
    serializer = serializer_class(data=data)
    if not serializer.is_valid():
        return None, JsonResponse({"detail": "請求參數錯誤"}, status=400)
    return serializer.validated_data, None


def _state(uid: str) -> dict:
    return {
        "enabled": memory_store.feature_enabled(),
        "consented": memory_store.has_consent(uid),
        "consentVersion": memory_store.CONSENT_VERSION,
        "retentionDays": memory_store.RETENTION_DAYS,
        "maxFiles": memory_store.MAX_FILES,
        "maxFileChars": memory_store.MAX_FILE_CHARS,
        "files": memory_store.list_files(uid),
    }


@csrf_exempt
def learner_memory(request):
    uid, err = _auth(request, ("GET", "DELETE"))
    if err:
        return err
    if request.method == "DELETE":
        removed = memory_store.clear_all(uid)
        logger.info("[learner_memory] 使用者清除全部記憶，共 %d 個檔案", removed)
    return JsonResponse(_state(uid))


@csrf_exempt
def learner_memory_consent(request):
    uid, err = _auth(request, ("POST",))
    if err:
        return err
    data, err = _body(request, ConsentSerializer)
    if err:
        return err
    if data["granted"]:
        if not memory_store.feature_enabled():
            return JsonResponse({"detail": "學習記憶目前尚未開放。", "code": "learner_memory_disabled"}, status=403)
        memory_store.grant_consent(uid)
    else:
        memory_store.revoke_consent(uid)
    return JsonResponse(_state(uid))


@csrf_exempt
def learner_memory_file(request):
    uid, err = _auth(request, ("PUT", "DELETE"))
    if err:
        return err
    if request.method == "PUT":
        data, err = _body(request, FileWriteSerializer)
        if err:
            return err
        try:
            memory_store.save_user_file(uid, data["path"], data["content"])
        except memory_store.MemoryError_ as exc:
            return JsonResponse({"detail": str(exc)}, status=400)
    else:
        # DELETE 沒有 body（前端 apiClient 的 apiDelete 只送 query 參數），路徑放在 ?path=
        serializer = FileDeleteSerializer(data={"path": request.GET.get("path", "")})
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤"}, status=400)
        data = serializer.validated_data
        try:
            if not memory_store.delete_user_file(uid, data["path"]):
                return JsonResponse({"detail": "找不到這個檔案"}, status=404)
        except memory_store.MemoryError_ as exc:
            return JsonResponse({"detail": str(exc)}, status=400)
    return JsonResponse(_state(uid))
