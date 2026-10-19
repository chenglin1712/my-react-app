"""本期專題的後台管理端點與公開讀取端點（S3-3，HOMEPAGE_CONTRACT.md 3.3 與 4.2）。

狀態機與角色完全比照公告（見 views.py 開頭說明），差別只有「最多 3 筆已發布」，由
featured_topic_service.publish_topic() 在鎖住 HomepageConfig 單例列的交易內檢查。
每個動作都寫稽核紀錄（target_type = "featured_topic"），與狀態變更在同一個交易內。
"""
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from config.roles import CONTENT_EDITORS, PUBLISHERS, STAFF_ROLES

from . import featured_topic_service as service
from ._shared import (
    guarded_action,
    invalid_transition as _invalid_transition,
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    write_audit_log as _write_audit_log,
)
from .models import FeaturedTopic
from .revisions import cancel_stale_pending_revision, make_revision_views, pending_revision_target_ids
from .serializers import (
    ApproveSerializer, FeaturedTopicSerializer, PublicFeaturedTopicDetailSerializer, PublicFeaturedTopicSerializer,
    RejectSerializer,
)

TARGET_TYPE = "featured_topic"
_EDITABLE = (FeaturedTopic.STATUS_DRAFT, FeaturedTopic.STATUS_REJECTED, FeaturedTopic.STATUS_UNPUBLISHED)
_DELETABLE = _EDITABLE


def _audit(request, decoded, action, topic, **kwargs):
    _write_audit_log(request, decoded, action, topic, target_type=TARGET_TYPE, **kwargs)


def _data(topic):
    return FeaturedTopicSerializer(topic).data


def _limit_reached_response(exc):
    names = "、".join(f"「{t}」" for t in exc.titles)
    return JsonResponse(
        {"detail": f"已發布的專題已達 {FeaturedTopic.MAX_PUBLISHED} 筆上限，請先下架其中一筆：{names}"},
        status=409,
    )


def _publish_errors_response(exc):
    if isinstance(exc, service.PublishLimitReached):
        return _limit_reached_response(exc)
    if isinstance(exc, service.ContentInvalid):
        return JsonResponse({"detail": "內容未通過驗證，請先修正後再發布", "errors": exc.errors}, status=409)
    return None


@csrf_exempt
def featured_topic_list(request):
    if request.method == "GET":
        return _list_topics(request)
    if request.method == "POST":
        return _create_topic(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="GET", role=STAFF_ROLES)
def _list_topics(request, decoded):
    qs = FeaturedTopic.live.order_by("sort_order", "pk")
    status_param = request.GET.get("status")
    if status_param:
        qs = qs.filter(status=status_param)
    items = list(qs[:200])
    pending_ids = pending_revision_target_ids(TARGET_TYPE, [item.pk for item in items])
    results = FeaturedTopicSerializer(items, many=True).data
    for result, item in zip(results, items):
        result["has_pending_revision"] = item.pk in pending_ids
    return JsonResponse({"results": results, "count": len(results)})


@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("featured_topic_create", "30/m"))
def _create_topic(request, decoded):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = FeaturedTopicSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    with transaction.atomic():
        topic = serializer.save(created_by=decoded.get("uid", "anon"))
        _audit(request, decoded, "create", topic, after=_data(topic))
    return JsonResponse(_data(topic), status=201)


@csrf_exempt
def featured_topic_detail(request, pk):
    if request.method == "GET":
        return _get_topic(request, pk)
    if request.method == "PATCH":
        return _update_topic(request, pk)
    if request.method == "DELETE":
        return _delete_topic(request, pk)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="GET", role=STAFF_ROLES)
def _get_topic(request, decoded, pk):
    topic = get_object_or_404(FeaturedTopic.live, pk=pk)
    data = _data(topic)
    data["has_pending_revision"] = bool(pending_revision_target_ids(TARGET_TYPE, [topic.pk]))
    return JsonResponse(data)


@guarded_action(method="PATCH", role=CONTENT_EDITORS, rate_limit=("featured_topic_update", "60/m"))
def _update_topic(request, decoded, pk):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    with transaction.atomic():
        topic = service.lock_topic(pk)
        # 送審中與已發布的內容不能直接改；已發布的走 pending-revision，已下架視同重新起草
        if topic.status not in _EDITABLE:
            return _invalid_transition(topic.status, "edit")
        before = _data(topic)
        serializer = FeaturedTopicSerializer(topic, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        was_unpublished = topic.status == FeaturedTopic.STATUS_UNPUBLISHED
        serializer.save()
        if was_unpublished:
            topic.status = FeaturedTopic.STATUS_DRAFT
            topic.save(update_fields=["status", "updated_at"])
        _audit(request, decoded, "update", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


@guarded_action(method="DELETE", role=PUBLISHERS, rate_limit=("featured_topic_delete", "30/m", "DELETE"))
def _delete_topic(request, decoded, pk):
    with transaction.atomic():
        topic = service.lock_topic(pk)
        if topic.status not in _DELETABLE:
            return _invalid_transition(topic.status, "delete")
        if pending_revision_target_ids(TARGET_TYPE, [topic.pk]):
            # 已下架的專題理論上沒有待審修改（下架時已取消），這是防線
            return JsonResponse({"detail": "這個專題還有待審的修改，請先處理後再刪除"}, status=409)
        before = _data(topic)
        # 從沒送審過的草稿硬刪；曾送審或發布過的軟刪，保留存在過的痕跡
        if topic.status == FeaturedTopic.STATUS_DRAFT and not topic.submitted_at:
            _audit(request, decoded, "delete", topic, before=before)
            topic.delete()
            return JsonResponse({"detail": "已刪除"})
        topic.deleted_at = timezone.now()
        topic.deleted_by = decoded.get("uid", "")
        topic.save(update_fields=["deleted_at", "deleted_by", "updated_at"])
        cancel_stale_pending_revision(TARGET_TYPE, topic.pk, decoded.get("uid", "anon"))
        _audit(
            request, decoded, "soft_delete", topic, before=before,
            after={"deleted_at": topic.deleted_at.isoformat(), "deleted_by": topic.deleted_by,
                   "previous_status": before.get("status")},
        )
        return JsonResponse({"detail": "已刪除"})


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("featured_topic_submit", "60/m"))
def featured_topic_submit(request, decoded, pk):
    with transaction.atomic():
        topic = service.lock_topic(pk)
        if topic.status not in (FeaturedTopic.STATUS_DRAFT, FeaturedTopic.STATUS_REJECTED):
            return _invalid_transition(topic.status, "submit")
        before = _data(topic)
        topic.status = FeaturedTopic.STATUS_PENDING_REVIEW
        topic.submitted_by = decoded.get("uid", "anon")
        topic.submitted_at = timezone.now()
        topic.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])
        _audit(request, decoded, "submit", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("featured_topic_withdraw", "60/m"))
def featured_topic_withdraw(request, decoded, pk):
    with transaction.atomic():
        topic = service.lock_topic(pk)
        if topic.status != FeaturedTopic.STATUS_PENDING_REVIEW:
            return _invalid_transition(topic.status, "withdraw")
        before = _data(topic)
        topic.status = FeaturedTopic.STATUS_DRAFT
        topic.save(update_fields=["status", "updated_at"])
        _audit(request, decoded, "withdraw", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("featured_topic_approve", "60/m"))
def featured_topic_approve(request, decoded, pk):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = ApproveSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    with transaction.atomic():
        try:
            topic, before = service.publish_topic(
                pk, expected_status=FeaturedTopic.STATUS_PENDING_REVIEW,
                actor_uid=decoded.get("uid", "anon"), record_review=True,
                review_comment=serializer.validated_data["review_comment"],
            )
        except service.InvalidState as exc:
            return _invalid_transition(exc.current_status, "approve")
        except (service.PublishLimitReached, service.ContentInvalid) as exc:
            return _publish_errors_response(exc)
        _audit(request, decoded, "approve", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("featured_topic_reject", "60/m"))
def featured_topic_reject(request, decoded, pk):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = RejectSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    with transaction.atomic():
        topic = service.lock_topic(pk)
        if topic.status != FeaturedTopic.STATUS_PENDING_REVIEW:
            return _invalid_transition(topic.status, "reject")
        before = _data(topic)
        topic.status = FeaturedTopic.STATUS_REJECTED
        topic.reviewed_by = decoded.get("uid", "anon")
        topic.reviewed_at = timezone.now()
        topic.review_comment = serializer.validated_data["review_comment"]
        topic.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])
        _audit(request, decoded, "reject", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("featured_topic_unpublish", "60/m"))
def featured_topic_unpublish(request, decoded, pk):
    with transaction.atomic():
        topic = service.lock_topic(pk)
        if topic.status != FeaturedTopic.STATUS_PUBLISHED:
            return _invalid_transition(topic.status, "unpublish")
        before = _data(topic)
        topic.status = FeaturedTopic.STATUS_UNPUBLISHED
        topic.save(update_fields=["status", "updated_at"])
        # 下架後殘留的待審修改對不上現狀，主動取消（見 revisions.cancel_stale_pending_revision）
        cancel_stale_pending_revision(TARGET_TYPE, topic.pk, decoded.get("uid", "anon"))
        _audit(request, decoded, "unpublish", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("featured_topic_republish", "60/m"))
def featured_topic_republish(request, decoded, pk):
    with transaction.atomic():
        try:
            topic, before = service.publish_topic(
                pk, expected_status=FeaturedTopic.STATUS_UNPUBLISHED, actor_uid=decoded.get("uid", "anon"),
            )
        except service.InvalidState as exc:
            return _invalid_transition(exc.current_status, "republish")
        except (service.PublishLimitReached, service.ContentInvalid) as exc:
            return _publish_errors_response(exc)
        _audit(request, decoded, "republish", topic, before=before, after=_data(topic))
        return JsonResponse(_data(topic))


# 編輯已發布專題（見 revisions.py）：提案先存 PendingRevision，核准後才套用，全程不下架。
# 核准修改不改變已發布筆數；revisions.py 套用前會對模型 full_clean() 重新驗證。
_revision_views = make_revision_views(FeaturedTopic, FeaturedTopicSerializer, TARGET_TYPE, PUBLISHERS)
featured_topic_pending_revision = _revision_views["pending_revision"]
featured_topic_revision_approve = _revision_views["approve"]
featured_topic_revision_reject = _revision_views["reject"]


def public_featured_topics(request):
    """首頁讀取用，免登入。只回已發布、依 sort_order 與 id 排序、最多 MAX_PUBLISHED 筆。

    與設定端點各自失敗：專題讀取失敗不影響設定。伺服器端不快取，後台儲存後下一次請求即新資料。
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_featured_topics", rate="120/m")
    if limited_resp:
        return limited_resp
    items = list(
        FeaturedTopic.live.filter(status=FeaturedTopic.STATUS_PUBLISHED)
        .order_by("sort_order", "pk")[:FeaturedTopic.MAX_PUBLISHED]
    )
    response = JsonResponse({"items": PublicFeaturedTopicSerializer(items, many=True).data})
    response["Cache-Control"] = "no-cache"
    return response


def public_featured_topic_detail(request, pk):
    """專題文章頁讀取用，免登入。只有「已發布且沒被軟刪除」的專題讀得到，其餘一律 404（不透露存不存在）。

    不套用首頁的「最多 3 筆」：已發布的專題本來就不會超過 3 筆，而且文章頁是用連結直接進來的，
    不該因為排序變動就讓已分享出去的連結失效。
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_featured_topic_detail", rate="120/m")
    if limited_resp:
        return limited_resp
    topic = FeaturedTopic.live.filter(pk=pk, status=FeaturedTopic.STATUS_PUBLISHED).first()
    if topic is None or not topic.body.strip():
        return JsonResponse({"detail": "找不到這篇專題"}, status=404)
    response = JsonResponse(PublicFeaturedTopicDetailSerializer(topic).data)
    response["Cache-Control"] = "no-cache"
    return response
