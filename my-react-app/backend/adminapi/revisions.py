"""「編輯已發布內容」的通用機制——取代原本「已發布/已啟用的內容只有下架
一個選項，要編輯得先下架」的動線。

核心設計（見 models.PendingRevision 的說明）：編輯已發布內容時，提案的新
欄位值先存進 PendingRevision，完全不碰正在生效的那一列；核准後才把
payload 套用回原本的列（狀態不變，全程沒有下架、沒有空窗期）；退件則整筆
捨棄，原內容不受影響。

這裡的函式都是通用版本（吃 model／serializer_class／target_type／
approver_roles 參數），Announcement 與 5 種題庫內容型別（QuizVocabItem／
QuizClozePassage／QuizSituationItem／QuizTrueFalseItem／QuizChoiceItem）
共用同一份邏輯，不必各自重寫一份——approver_roles 之所以要當參數傳入，是
因為 Announcement 的核准角色是 PUBLISHERS，題庫類內容是 CONTENT_APPROVERS
（見 quizbank_views.py 開頭說明的設計決定），兩邊不一樣。
"""
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import CONTENT_EDITORS, STAFF_ROLES

from ._shared import (
    invalid_transition, parse_json_body, rate_limited_response, write_audit_log,
)
from .models import PendingRevision
from .serializers import RejectSerializer


def pending_revision_target_ids(target_type, target_ids):
    """給列表端點標記 has_pending_revision 用：回傳 target_ids 裡目前有
    一筆待審修改的那些 id 所組成的 set，一次查詢、避免每列各自查一次。"""
    if not target_ids:
        return set()
    return set(
        PendingRevision.objects.filter(
            target_type=target_type, target_id__in=target_ids,
            status=PendingRevision.STATUS_PENDING_REVIEW,
        ).values_list("target_id", flat=True)
    )


def _locked_target(model, pk):
    return get_object_or_404(model.objects.select_for_update(), pk=pk)


def cancel_stale_pending_revision(target_type, target_id, actor_uid):
    """內容不再是已發布狀態時（下架／或任何其他把狀態改離 published 的路徑）
    呼叫，把這個 target 現有的待審修改自動標成退件。

    PendingRevision 的存在前提是「內容目前是已發布狀態」
    （_create_or_update_pending_revision 建立時就檢查過這一點）；內容一旦
    被下架，殘留的待審修改就是對不上現狀的孤兒資料——放著不處理，輕則讓
    「有待審修改」徽章／送審佇列永遠卡著一筆審不動的項目，重則被核准時
    悄悄套用到已下架的內容上（見下方 _approve_pending_revision 的核准前
    重新確認狀態，這裡是主動清理，那裡是最後一道防線，兩者互補）。

    呼叫端必須在自己已經鎖定 target model 那一列之後才呼叫這裡（維持
    「先鎖 target、再鎖 revision」的一致鎖定順序，跟 _approve_pending_revision／
    _reject_pending_revision 一致，避免死鎖）。回傳被取消的 revision（沒有
    待審修改就回傳 None）。
    """
    revision = PendingRevision.objects.select_for_update().filter(
        target_type=target_type, target_id=target_id, status=PendingRevision.STATUS_PENDING_REVIEW,
    ).first()
    if not revision:
        return None
    revision.status = PendingRevision.STATUS_REJECTED
    revision.reviewed_by = actor_uid
    revision.reviewed_at = timezone.now()
    revision.review_comment = "內容已下架，待審修改自動失效"
    revision.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment"])
    return revision


def _get_pending_revision(request, pk, model, target_type):
    """回傳這個 target 目前的待審修改（沒有就回 404），給編輯表單重新
    打開時預先帶入「上次提案但還沒審過的內容」，而不是目前生效中的舊內容。"""
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    get_object_or_404(model, pk=pk)  # 確認 target 本身存在，404 訊息才對得上
    revision = PendingRevision.objects.filter(
        target_type=target_type, target_id=pk, status=PendingRevision.STATUS_PENDING_REVIEW,
    ).first()
    if not revision:
        return JsonResponse({"detail": "目前沒有待審核的修改"}, status=404)
    return JsonResponse({
        "id": revision.pk, "payload": revision.payload,
        "submitted_by": revision.submitted_by, "submitted_at": revision.submitted_at.isoformat(),
    })


def _create_or_update_pending_revision(request, pk, model, serializer_class, target_type):
    """編輯已發布/已啟用內容——建立或更新這個 target 的待審修改，完全不動
    正在生效的那一列。只能對「已發布」的內容用這條路徑；draft／rejected
    這類本來就能直接 PATCH 的狀態，不需要（也不應該）走這裡，直接引導
    使用一般的更新端點。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = rate_limited_response(request, decoded, group=f"{target_type}_edit_published")
    if limited_resp:
        return limited_resp

    data, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp

    with transaction.atomic():
        obj = _locked_target(model, pk)
        if obj.status != model.STATUS_PUBLISHED:
            return JsonResponse(
                {"detail": "此內容尚未發布，請直接使用一般的編輯功能"}, status=409,
            )

        serializer = serializer_class(instance=obj, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

        revision, created = PendingRevision.objects.update_or_create(
            target_type=target_type, target_id=pk, status=PendingRevision.STATUS_PENDING_REVIEW,
            defaults={
                "payload": serializer.validated_data,
                "submitted_by": decoded.get("uid", "anon"),
            },
        )
        # serializer.validated_data 可能含 date/datetime 這類物件（例如
        # Announcement 的 pin_until），PendingRevision.payload 有
        # encoder=DjangoJSONEncoder 能正確存入，但這裡緊接著要把同一份資料
        # 傳給 write_audit_log 寫進 AuditLog.after（一般 JSONField，沒有
        # 自訂 encoder）。refresh_from_db() 讓 revision.payload 變成已經
        # 存進資料庫、讀回來的純 JSON 安全值（str/int/float/bool/None/
        # dict/list），才能再被一般的 JSONField 存一次。
        revision.refresh_from_db()
        write_audit_log(
            request, decoded, "propose_revision" if created else "update_pending_revision", obj,
            after=revision.payload, target_type=target_type,
        )

    return JsonResponse({
        "id": revision.pk, "payload": revision.payload, "submitted_by": revision.submitted_by,
    }, status=201 if created else 200)


def _approve_pending_revision(request, pk, model, serializer_class, target_type, approver_roles):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, approver_roles)
    if err_resp:
        return err_resp
    limited_resp = rate_limited_response(request, decoded, group=f"{target_type}_approve_revision")
    if limited_resp:
        return limited_resp

    data, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp

    with transaction.atomic():
        obj = _locked_target(model, pk)
        revision = PendingRevision.objects.select_for_update().filter(
            target_type=target_type, target_id=pk, status=PendingRevision.STATUS_PENDING_REVIEW,
        ).first()
        if not revision:
            return invalid_transition("(無待審修改)", "approve_revision")

        # 提案送出之後、核准之前，這段時間內容有可能被別的路徑下架（見
        # cancel_stale_pending_revision 的說明）——正常情況下架時就會主動
        # 取消待審修改，這裡是防止任何遺漏路徑或極端時序下仍然核准套用到
        # 已下架內容的最後一道防線。
        if obj.status != model.STATUS_PUBLISHED:
            revision.status = PendingRevision.STATUS_REJECTED
            revision.reviewed_by = decoded.get("uid", "anon")
            revision.reviewed_at = timezone.now()
            revision.review_comment = "內容已不是已發布狀態，待審修改自動失效"
            revision.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment"])
            write_audit_log(
                request, decoded, "auto_reject_stale_revision", obj,
                after={"reason": "target no longer published"}, target_type=target_type,
            )
            return JsonResponse({"detail": "此內容已不是已發布狀態，待審修改已自動失效"}, status=409)

        before = serializer_class(obj).data
        for field, value in revision.payload.items():
            setattr(obj, field, value)
        obj.full_clean(exclude=["status", "created_by", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "review_comment"])
        obj.save()

        revision.status = PendingRevision.STATUS_APPROVED
        revision.reviewed_by = decoded.get("uid", "anon")
        revision.reviewed_at = timezone.now()
        revision.review_comment = (data or {}).get("review_comment", "")
        revision.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment"])

        write_audit_log(
            request, decoded, "approve_revision", obj,
            before=before, after=serializer_class(obj).data, target_type=target_type,
        )

    return JsonResponse(serializer_class(obj).data)


def _reject_pending_revision(request, pk, model, target_type, approver_roles):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, approver_roles)
    if err_resp:
        return err_resp
    limited_resp = rate_limited_response(request, decoded, group=f"{target_type}_reject_revision")
    if limited_resp:
        return limited_resp

    data, err_resp = parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = RejectSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        obj = _locked_target(model, pk)
        revision = PendingRevision.objects.select_for_update().filter(
            target_type=target_type, target_id=pk, status=PendingRevision.STATUS_PENDING_REVIEW,
        ).first()
        if not revision:
            return invalid_transition("(無待審修改)", "reject_revision")

        revision.status = PendingRevision.STATUS_REJECTED
        revision.reviewed_by = decoded.get("uid", "anon")
        revision.reviewed_at = timezone.now()
        revision.review_comment = serializer.validated_data["review_comment"]
        revision.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment"])

        # 原內容（obj）完全沒被動過，這裡稽核紀錄的 before/after 刻意留白——
        # 退件這個動作本身不改變 obj 的任何欄位，寫 before==after 沒有意義。
        write_audit_log(
            request, decoded, "reject_revision", obj,
            after={"rejected_payload": revision.payload}, target_type=target_type,
        )

    return JsonResponse({"detail": "已退件，原內容不受影響"})


def make_revision_views(model, serializer_class, target_type, approver_roles):
    """回傳一組 view function，給 urls.py 掛路由用。跟 quizbank_views.py 的
    _make_content_views 是同一種工廠模式，這裡另外拆一個檔案而不是塞進去，
    是因為 Announcement 也要用（Announcement 不是走 _make_content_views
    那套，是獨立手寫的 views.py）。"""

    @csrf_exempt
    def pending_revision_view(request, pk):
        if request.method == "GET":
            return _get_pending_revision(request, pk, model, target_type)
        if request.method == "POST":
            return _create_or_update_pending_revision(request, pk, model, serializer_class, target_type)
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    @csrf_exempt
    def approve_view(request, pk):
        return _approve_pending_revision(request, pk, model, serializer_class, target_type, approver_roles)

    @csrf_exempt
    def reject_view(request, pk):
        return _reject_pending_revision(request, pk, model, target_type, approver_roles)

    return {"pending_revision": pending_revision_view, "approve": approve_view, "reject": reject_view}
