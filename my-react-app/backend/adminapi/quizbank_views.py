"""adminapi 的題庫管理端點：配合題詞彙、克漏字短文、情境題、外部題源設定、
IRT 適性測驗參數。

配合題詞彙（QuizVocabItem）、克漏字短文（QuizClozePassage）、情境題
（QuizSituationItem）三種內容共用同一套送審狀態機（見 models.py 的
ReviewableContent），也共用同一套 CRUD／送審流程——這裡把 views.py 裡
Announcement 專屬寫死的流程改寫成可以傳入 model／serializer 的通用版本
（`_make_content_views` 工廠函式），三種內容的實際 view 只是呼叫工廠帶入
各自的 model/serializer/target_type，不重複貼三份幾乎一樣的程式碼。

核准／退件角色刻意用 CONTENT_APPROVERS（owner/admin/reviewer）而不是
Announcement 用的 PUBLISHERS（owner/admin）——這正是 config/roles.py 定義
CONTENT_APPROVERS 這個角色群組的目的：reviewer（族語老師）能核准辭典／
題庫這類「限內容」的審定，但不能核准公告這類一般內容。
"""
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import CONTENT_APPROVERS, CONTENT_EDITORS, PUBLISHERS, STAFF_ROLES

from ._shared import (
    invalid_transition as _invalid_transition,
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import (
    IrtConfig, QuizChoiceItem, QuizClozePassage, QuizSituationItem, QuizSourceConfig,
    QuizTrueFalseItem, QuizVocabItem,
)
from .revisions import make_revision_views, pending_revision_target_ids
from .serializers import (
    ApproveSerializer, IrtConfigSerializer, PublicIrtConfigSerializer,
    QuizChoiceItemSerializer, QuizClozePassageSerializer, QuizSituationItemSerializer,
    QuizSourceConfigSerializer, QuizTrueFalseItemSerializer, QuizVocabItemSerializer,
    RejectSerializer,
)

# ---------------------------------------------------------------------------
# 三種題庫內容共用的 CRUD + 送審流程
# ---------------------------------------------------------------------------

def _locked_content(model, pk):
    """比照 views.py 的 _locked()，但可套用在任何 ReviewableContent 子類別上。"""
    return get_object_or_404(model.objects.select_for_update(), pk=pk)


def _list_content(request, model, serializer_class, target_type, extra_filter_fields=()):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    qs = model.objects.all()
    status_param = request.GET.get("status")
    if status_param:
        qs = qs.filter(status=status_param)
    tribe = request.GET.get("tribe")
    if tribe:
        qs = qs.filter(tribe=tribe)
    for field in extra_filter_fields:
        value = request.GET.get(field)
        if value:
            qs = qs.filter(**{field: value})

    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(100, max(1, int(request.GET.get("page_size", 20))))
    except ValueError:
        page_size = 20

    total = qs.count()
    start = (page - 1) * page_size
    items = list(qs[start:start + page_size])

    # has_pending_revision：這一列是否有一筆待審核的「編輯已發布內容」提案
    # （見 revisions.py）。一次查詢這一頁全部 id，不要每列各自查一次。
    pending_ids = pending_revision_target_ids(target_type, [item.pk for item in items])
    results = serializer_class(items, many=True).data
    for result, item in zip(results, items):
        result["has_pending_revision"] = item.pk in pending_ids

    return JsonResponse({
        "results": results,
        "count": total, "page": page, "page_size": page_size,
    })


def _create_content(request, model, serializer_class, target_type):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_create", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    serializer = serializer_class(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        obj = serializer.save(created_by=decoded.get("uid", "anon"))
        _write_audit_log(request, decoded, "create", obj, after=serializer_class(obj).data, target_type=target_type)

    return JsonResponse(serializer_class(obj).data, status=201)


def _get_content(request, pk, model, serializer_class, target_type):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    obj = get_object_or_404(model, pk=pk)
    data = serializer_class(obj).data
    data["has_pending_revision"] = bool(pending_revision_target_ids(target_type, [obj.pk]))
    return JsonResponse(data)


def _update_content(request, pk, model, serializer_class, target_type):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_update", rate="60/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    with transaction.atomic():
        obj = _locked_content(model, pk)
        # 送審中／已啟用的內容不能直接改——已啟用的內容如果要修改，先用
        # unpublish 退回草稿，避免正在被學生抽到的題目跟審核者核准當下
        # 看到的內容不一致（跟 Announcement 的 _update_announcement 同一個
        # 理由）。
        if obj.status not in (model.STATUS_DRAFT, model.STATUS_REJECTED):
            return _invalid_transition(obj.status, "update")

        before = serializer_class(obj).data
        serializer = serializer_class(obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        serializer.save()
        _write_audit_log(
            request, decoded, "update", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )

    return JsonResponse(serializer_class(obj).data)


def _delete_content(request, pk, model, serializer_class, target_type):
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_delete", rate="30/m")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        obj = _locked_content(model, pk)
        if obj.status != model.STATUS_DRAFT:
            return _invalid_transition(obj.status, "delete")
        before = serializer_class(obj).data
        _write_audit_log(request, decoded, "delete", obj, before=before, target_type=target_type)
        obj.delete()

    return JsonResponse({"detail": "已刪除"}, status=200)


def _content_submit(request, pk, model, serializer_class, target_type):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_submit")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        obj = _locked_content(model, pk)
        if obj.status not in (model.STATUS_DRAFT, model.STATUS_REJECTED):
            return _invalid_transition(obj.status, "submit")

        before = serializer_class(obj).data
        obj.status = model.STATUS_PENDING_REVIEW
        obj.submitted_by = decoded.get("uid", "anon")
        obj.submitted_at = timezone.now()
        obj.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])

        _write_audit_log(
            request, decoded, "submit", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )
        return JsonResponse(serializer_class(obj).data)


def _content_withdraw(request, pk, model, serializer_class, target_type):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_withdraw")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        obj = _locked_content(model, pk)
        if obj.status != model.STATUS_PENDING_REVIEW:
            return _invalid_transition(obj.status, "withdraw")

        before = serializer_class(obj).data
        obj.status = model.STATUS_DRAFT
        obj.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request, decoded, "withdraw", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )
        return JsonResponse(serializer_class(obj).data)


def _content_approve(request, pk, model, serializer_class, target_type):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_approve")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = ApproveSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        obj = _locked_content(model, pk)
        if obj.status != model.STATUS_PENDING_REVIEW:
            return _invalid_transition(obj.status, "approve")

        before = serializer_class(obj).data
        obj.status = model.STATUS_PUBLISHED
        obj.reviewed_by = decoded.get("uid", "anon")
        obj.reviewed_at = timezone.now()
        obj.review_comment = serializer.validated_data["review_comment"]
        obj.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])

        _write_audit_log(
            request, decoded, "approve", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )
        return JsonResponse(serializer_class(obj).data)


def _content_reject(request, pk, model, serializer_class, target_type):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_reject")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = RejectSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        obj = _locked_content(model, pk)
        if obj.status != model.STATUS_PENDING_REVIEW:
            return _invalid_transition(obj.status, "reject")

        before = serializer_class(obj).data
        obj.status = model.STATUS_REJECTED
        obj.reviewed_by = decoded.get("uid", "anon")
        obj.reviewed_at = timezone.now()
        obj.review_comment = serializer.validated_data["review_comment"]
        obj.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])

        _write_audit_log(
            request, decoded, "reject", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )
        return JsonResponse(serializer_class(obj).data)


def _content_unpublish(request, pk, model, serializer_class, target_type):
    """已啟用的內容退回草稿——這幾個 model 沒有 Announcement 的 unpublished
    中介狀態，直接回 draft（見 models.py 的 ReviewableContent 說明）。用
    CONTENT_APPROVERS：族語老師事後發現已啟用的內容有問題，應該有權直接
    先讓它停止被抽到，不需要等 owner/admin。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group=f"{target_type}_unpublish")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        obj = _locked_content(model, pk)
        if obj.status != model.STATUS_PUBLISHED:
            return _invalid_transition(obj.status, "unpublish")

        before = serializer_class(obj).data
        obj.status = model.STATUS_DRAFT
        obj.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request, decoded, "unpublish", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )
        return JsonResponse(serializer_class(obj).data)


def _make_content_views(model, serializer_class, target_type, extra_filter_fields=()):
    """回傳一組 view function，給 urls.py 掛路由用。用工廠函式產生，避免
    QuizVocabItem／QuizClozePassage／QuizSituationItem 三種內容各自複製貼上
    完全一樣的 7 個 thin wrapper。"""

    @csrf_exempt
    def list_view(request):
        if request.method == "GET":
            return _list_content(request, model, serializer_class, target_type, extra_filter_fields)
        if request.method == "POST":
            return _create_content(request, model, serializer_class, target_type)
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    @csrf_exempt
    def detail_view(request, pk):
        if request.method == "GET":
            return _get_content(request, pk, model, serializer_class, target_type)
        if request.method == "PATCH":
            return _update_content(request, pk, model, serializer_class, target_type)
        if request.method == "DELETE":
            return _delete_content(request, pk, model, serializer_class, target_type)
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    @csrf_exempt
    def submit_view(request, pk):
        return _content_submit(request, pk, model, serializer_class, target_type)

    @csrf_exempt
    def withdraw_view(request, pk):
        return _content_withdraw(request, pk, model, serializer_class, target_type)

    @csrf_exempt
    def approve_view(request, pk):
        return _content_approve(request, pk, model, serializer_class, target_type)

    @csrf_exempt
    def reject_view(request, pk):
        return _content_reject(request, pk, model, serializer_class, target_type)

    @csrf_exempt
    def unpublish_view(request, pk):
        return _content_unpublish(request, pk, model, serializer_class, target_type)

    revision_views = make_revision_views(model, serializer_class, target_type, CONTENT_APPROVERS)

    return {
        "list": list_view, "detail": detail_view, "submit": submit_view,
        "withdraw": withdraw_view, "approve": approve_view,
        "reject": reject_view, "unpublish": unpublish_view,
        "pending_revision": revision_views["pending_revision"],
        "approve_revision": revision_views["approve"],
        "reject_revision": revision_views["reject"],
    }


quiz_vocab_views = _make_content_views(
    QuizVocabItem, QuizVocabItemSerializer, "quiz_vocab_item", extra_filter_fields=("category",),
)
quiz_cloze_views = _make_content_views(
    QuizClozePassage, QuizClozePassageSerializer, "quiz_cloze_passage",
)
quiz_situation_views = _make_content_views(
    QuizSituationItem, QuizSituationItemSerializer, "quiz_situation_item",
)
quiz_true_false_views = _make_content_views(
    QuizTrueFalseItem, QuizTrueFalseItemSerializer, "quiz_true_false_item",
)
quiz_choice_views = _make_content_views(
    QuizChoiceItem, QuizChoiceItemSerializer, "quiz_choice_item",
)


# ---------------------------------------------------------------------------
# QuizSourceConfig（外部題源設定，取代 crawler/views.py 的 TRIBE_CONFIG）
# ---------------------------------------------------------------------------

@csrf_exempt
def quiz_source_config_list(request):
    """5 個族語的外部題源設定一次全部回傳，沒有 create/delete——族語清單
    本身由 config/tribes.py 固定，不是後台可以新增/刪除的東西，只能改
    dialect_id／display_name（見 quiz_source_config_detail）。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    items = QuizSourceConfig.objects.all()
    return JsonResponse({"results": QuizSourceConfigSerializer(items, many=True).data})


@csrf_exempt
def quiz_source_config_detail(request, tribe):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="quiz_source_config_update", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    with transaction.atomic():
        obj = get_object_or_404(QuizSourceConfig.objects.select_for_update(), tribe=tribe)
        before = QuizSourceConfigSerializer(obj).data
        serializer = QuizSourceConfigSerializer(obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        serializer.save(updated_by=decoded.get("uid", "anon"))
        _write_audit_log(
            request, decoded, "update", obj,
            before=before, after=QuizSourceConfigSerializer(obj).data, target_type="quiz_source_config",
        )

    return JsonResponse(QuizSourceConfigSerializer(obj).data)


# ---------------------------------------------------------------------------
# IrtConfig（IRT 適性測驗參數，單例）
# ---------------------------------------------------------------------------

@csrf_exempt
def irt_config_admin(request):
    if request.method == "GET":
        decoded, err_resp = require_role(request, STAFF_ROLES)
        if err_resp:
            return err_resp
        return JsonResponse(IrtConfigSerializer(IrtConfig.load()).data)
    if request.method == "PATCH":
        return _update_irt_config(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _update_irt_config(request):
    """IRT 參數會直接影響 FastAPI 端即時算分行為（見 models.py 的 IrtConfig
    說明），比照 HomepageConfig 的 PATCH 限定 PUBLISHERS（owner/admin）——
    這是系統調校層級的變更，不是一般內容編輯，reviewer 不需要能動這裡。"""
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="irt_config_update", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    config = IrtConfig.load()
    with transaction.atomic():
        obj = IrtConfig.objects.select_for_update().get(pk=config.pk)
        before = IrtConfigSerializer(obj).data
        serializer = IrtConfigSerializer(obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        serializer.save(updated_by=decoded.get("uid", "anon"))
        _write_audit_log(
            request, decoded, "update", obj,
            before=before, after=IrtConfigSerializer(obj).data, target_type="irt_config",
        )

    return JsonResponse(IrtConfigSerializer(obj).data)


def public_irt_config(request):
    """給 FastAPI quiz.py 讀取用，無需登入——比照 public_homepage_config 的
    公開唯讀模式。IP 限流防止被打穿當放大器用（雖然只是讀本地資料庫，但
    仍是對外開放、無需驗證的端點，不能完全不設防）。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_irt_config", rate="120/m")
    if limited_resp:
        return limited_resp
    return JsonResponse(PublicIrtConfigSerializer(IrtConfig.load()).data)
