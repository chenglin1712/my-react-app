"""遊戲參數設定：聽力／句型／發音／填字四個遊戲的可調參數（GameConfig 單例），
以及填字遊戲泰雅語內建詞庫（CrosswordTayalWord，取代 crossword.py 寫死的
20 筆陣列）。

比照 IrtConfig（quizbank_views.py）的既有模式：PATCH 限定 PUBLISHERS（這是
系統調校層級的變更，不是一般內容編輯）、額外開一個無需登入的公開唯讀端點
給 FastAPI 輪詢用。CrosswordTayalWord 是「設定」性質的清單（不是需要族語
老師審定的辭典內容），CRUD 直接寫入即可，不經送審流程。
"""
from django.db import transaction
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
from .models import CrosswordTayalWord, GameConfig
from .serializers import (
    CrosswordTayalWordSerializer, GameConfigSerializer, PublicGameConfigSerializer,
)

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


# ---------------------------------------------------------------------------
# CrosswordTayalWord（填字遊戲泰雅語內建詞庫）
# ---------------------------------------------------------------------------


@csrf_exempt
def crossword_tayal_word_list(request):
    if request.method == "GET":
        decoded, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        words = CrosswordTayalWord.objects.all()
        return JsonResponse({"results": CrosswordTayalWordSerializer(words, many=True).data})

    if request.method == "POST":
        decoded, err_resp = require_role(request, PUBLISHERS)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="crossword_tayal_word_write", rate="30/m")
        if limited_resp:
            return limited_resp

        data, err_resp = _parse_json_body(request)
        if err_resp:
            return err_resp

        serializer = CrosswordTayalWordSerializer(data=data)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        obj = serializer.save(created_by=decoded.get("uid", "anon"))
        _write_audit_log(
            request, decoded, "create", obj,
            after=CrosswordTayalWordSerializer(obj).data, target_type="crossword_tayal_word",
        )
        return JsonResponse(CrosswordTayalWordSerializer(obj).data, status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
def crossword_tayal_word_detail(request, pk):
    if request.method == "GET":
        decoded, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        obj = get_object_or_404(CrosswordTayalWord, pk=pk)
        return JsonResponse(CrosswordTayalWordSerializer(obj).data)

    if request.method == "PATCH":
        decoded, err_resp = require_role(request, PUBLISHERS)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(request, decoded, group="crossword_tayal_word_write", rate="30/m")
        if limited_resp:
            return limited_resp

        data, err_resp = _parse_json_body(request)
        if err_resp:
            return err_resp

        obj = get_object_or_404(CrosswordTayalWord, pk=pk)
        before = CrosswordTayalWordSerializer(obj).data
        serializer = CrosswordTayalWordSerializer(obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        serializer.save()
        _write_audit_log(
            request, decoded, "update", obj,
            before=before, after=CrosswordTayalWordSerializer(obj).data, target_type="crossword_tayal_word",
        )
        return JsonResponse(CrosswordTayalWordSerializer(obj).data)

    if request.method == "DELETE":
        decoded, err_resp = require_role(request, PUBLISHERS)
        if err_resp:
            return err_resp
        limited_resp = _rate_limited_response(
            request, decoded, group="crossword_tayal_word_write", rate="30/m", method="DELETE",
        )
        if limited_resp:
            return limited_resp

        obj = get_object_or_404(CrosswordTayalWord, pk=pk)
        before = CrosswordTayalWordSerializer(obj).data
        _write_audit_log(request, decoded, "delete", obj, before=before, target_type="crossword_tayal_word")
        obj.delete()
        return JsonResponse({"detail": "已刪除"}, status=200)

    return JsonResponse({"detail": "Method not allowed"}, status=405)
