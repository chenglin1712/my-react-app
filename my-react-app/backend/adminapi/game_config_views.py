"""遊戲參數設定：聽力／句型／發音／填字四個遊戲的可調參數（GameConfig 單例）。

比照 IrtConfig（quizbank_views.py）的既有模式：PATCH 限定 PUBLISHERS（這是
系統調校層級的變更，不是一般內容編輯）、額外開一個無需登入的公開唯讀端點
給 FastAPI 輪詢用。
"""
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import PUBLISHERS, STAFF_ROLES

from ._shared import (
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import GameConfig
from .serializers import GameConfigSerializer, PublicGameConfigSerializer

# ---------------------------------------------------------------------------
# GameConfig（四個遊戲的可調參數，單例）
# ---------------------------------------------------------------------------


@csrf_exempt
def game_config_admin(request):
    if request.method == "GET":
        decoded, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        return JsonResponse(GameConfigSerializer(GameConfig.load()).data)
    if request.method == "PATCH":
        return _update_game_config(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _update_game_config(request):
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="game_config_update", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    config = GameConfig.load()
    with transaction.atomic():
        obj = GameConfig.objects.select_for_update().get(pk=config.pk)
        before = GameConfigSerializer(obj).data
        serializer = GameConfigSerializer(obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        serializer.save(updated_by=decoded.get("uid", "anon"))
        _write_audit_log(
            request, decoded, "update", obj,
            before=before, after=GameConfigSerializer(obj).data, target_type="game_config",
        )

    return JsonResponse(GameConfigSerializer(obj).data)


def public_game_config(request):
    """給 FastAPI game_config.py 讀取用，無需登入——比照 public_irt_config
    的公開唯讀模式。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_game_config", rate="120/m")
    if limited_resp:
        return limited_resp
    return JsonResponse(PublicGameConfigSerializer(GameConfig.load()).data)
