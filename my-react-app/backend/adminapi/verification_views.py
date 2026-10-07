"""待專家驗證佇列（M5）的後台端點。見 verification_service.py 的邊界與措辭說明。

每個端點的檢查順序固定：HTTP method → 登入與角色 → 限流 → 旗標（關閉回 403）→ 才讀參數、查資料。
所以未登入者無法用回應探測旗標，旗標關閉時也不會查任何項目或透露它們存在。驗證沿用本專案的 Bearer Firebase token
（csrf_exempt 是既有慣例的前提：永遠不接受 cookie 或 query string 的憑證）。所有回應都標 no-store。
"""
from django.db import IntegrityError
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.roles import (
    VERIFICATION_EXPORTERS, VERIFICATION_IMPORTERS, VERIFICATION_READERS, VERIFICATION_REVIEWERS,
)
from core.firebase_auth import require_role

from . import verification_service as svc
from ._shared import parse_json_body, rate_limited_response
from .models import VerificationItem, VerificationReview
from .models.verification import KINDS

DISABLED_BODY = {"code": "verification_queue_disabled", "detail": "待專家驗證佇列未啟用"}
NOTICE = "此佇列只收集意見，不會寫回辭典或測驗題庫；所有項目都仍待專家驗證。"
PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX = 25, 50


def _json(data, status=200):
    response = JsonResponse(data, status=status)
    response["Cache-Control"] = "no-store, private"
    return response


def _gate(request, method, roles, group, rate="60/m", *, check_flag=True):
    """回傳 (decoded, error_response)。"""
    if request.method != method:
        return None, _json({"detail": "Method not allowed"}, 405)
    decoded, err = require_role(request, roles)
    if err:
        return None, err
    limited = rate_limited_response(request, decoded, group=group, rate=rate, method=method)
    if limited:
        return None, limited
    if check_flag and not svc.verification_enabled():
        return None, _json(DISABLED_BODY, 403)
    return decoded, None


def _item_dict(item, *, my_review=None):
    obs = svc.latest_observation(item)
    state = svc.review_state(item.opinion_count, item.agree_count, item.disagree_count, item.correction_variants)
    return {
        "id": item.pk, "key": item.key, "tribe": item.tribe, "kind": item.kind, "form": item.form, "proposal": item.proposal,
        "occurrence_count": obs.occurrence_count if obs else None, "sentence_count": obs.sentence_count if obs else None,
        "observation_count": len(list(item.observations.all())),
        "review_state": state, "opinion_count": item.opinion_count,
        "agree_count": item.agree_count, "disagree_count": item.disagree_count, "uncertain_count": item.uncertain_count,
        "has_conflicting_opinions": state == svc.STATE_CONFLICT,
        "my_review": my_review,
    }


def _review_dict(review):
    return {"reviewer_type": review.reviewer_type, "reviewer_label": review.reviewer_label, "verdict": review.verdict,
            "correction": review.correction, "dialect": review.dialect, "notes": review.notes,
            "updated_at": review.updated_at.isoformat()}


def _filtered_items(params):
    qs = svc.annotate_items(VerificationItem.objects.all()).prefetch_related("observations")
    tribe, kind, state, q = params.get("tribe"), params.get("kind"), params.get("state"), params.get("q")
    if tribe:
        if tribe not in svc.TRIBE_SLUGS:
            raise svc.ValidationFailed("未知的族語")
        qs = qs.filter(tribe=tribe)
    if kind:
        if kind not in KINDS:
            raise svc.ValidationFailed("未知的項目種類")
        qs = qs.filter(kind=kind)
    if state:
        qs = svc.filter_by_state(qs, state)
    if q:
        if len(q) > 50:
            raise svc.ValidationFailed("搜尋文字太長")
        qs = qs.filter(form__icontains=q)
    return qs.order_by("-created_at", "-id")


@csrf_exempt
def verification_status(request):
    decoded, err = _gate(request, "GET", VERIFICATION_READERS, "verification_read", check_flag=False)
    if err:
        return err
    return _json({"enabled": svc.verification_enabled()})


@csrf_exempt
def verification_items(request):
    decoded, err = _gate(request, "GET", VERIFICATION_READERS, "verification_read")
    if err:
        return err
    try:
        qs = _filtered_items(request.GET)
        page = max(1, int(request.GET.get("page", 1)))
        size = min(PAGE_SIZE_MAX, max(1, int(request.GET.get("page_size", PAGE_SIZE_DEFAULT))))
    except (svc.ValidationFailed, ValueError) as exc:
        return _json({"detail": str(exc) if isinstance(exc, svc.ValidationFailed) else "分頁參數不合法"}, 400)
    total = qs.count()
    items = list(qs[(page - 1) * size: page * size])
    mine = {}
    if decoded.get("role") in VERIFICATION_REVIEWERS and items:
        for r in VerificationReview.objects.filter(item__in=items, reviewer_type="staff", reviewer_subject=decoded["uid"]):
            mine[r.item_id] = _review_dict(r)
    return _json({"results": [_item_dict(i, my_review=mine.get(i.pk)) for i in items], "count": total, "page": page,
                  "page_size": size, "notice": NOTICE})


@csrf_exempt
def verification_item_detail(request, pk):
    decoded, err = _gate(request, "GET", VERIFICATION_READERS, "verification_read")
    if err:
        return err
    item = svc.annotate_items(VerificationItem.objects.filter(pk=pk)).prefetch_related("observations").first()
    if item is None:
        return _json({"detail": "找不到這個項目"}, 404)
    data = _item_dict(item)
    data["observations"] = [{"source": o.source, "report_version": o.report_version, "report_label": o.report_label,
                             "occurrence_count": o.occurrence_count, "sentence_count": o.sentence_count,
                             "list_size": o.list_size, "observed_at": o.observed_at.isoformat()} for o in item.observations.all()]
    # 各筆意見的細節（審核者標籤、備註）只給有審核資格的角色；其他角色只看得到彙總數字
    if decoded.get("role") in VERIFICATION_REVIEWERS:
        data["reviews"] = [_review_dict(r) for r in item.reviews.all()]
    data["notice"] = NOTICE
    return _json(data)


@csrf_exempt
def verification_item_review(request, pk):
    decoded, err = _gate(request, "POST", VERIFICATION_REVIEWERS, "verification_review")
    if err:
        return err
    data, bad = parse_json_body(request)
    if bad:
        return bad
    if not isinstance(data, dict):
        return _json({"detail": "請求格式錯誤"}, 400)
    item = VerificationItem.objects.filter(pk=pk).first()
    if item is None:
        return _json({"detail": "找不到這個項目"}, 404)
    try:
        fields = svc.parse_review_fields(data)
        uid = decoded["uid"]
        review, outcome = svc.save_review(request, decoded, item, fields, reviewer_type="staff", subject=uid,
                                          label=svc.staff_label(uid), entered_by=uid)
    except svc.ValidationFailed as exc:
        return _json({"detail": str(exc)}, 400)
    refreshed = svc.annotate_items(VerificationItem.objects.filter(pk=pk)).prefetch_related("observations").first()
    return _json({"outcome": outcome, "item": _item_dict(refreshed, my_review=_review_dict(review)), "notice": NOTICE},
                 201 if outcome == "created" else 200)


@csrf_exempt
def verification_export(request):
    decoded, err = _gate(request, "GET", VERIFICATION_EXPORTERS, "verification_export", rate="10/m")
    if err:
        return err
    try:
        qs = _filtered_items(request.GET)
    except svc.ValidationFailed as exc:
        return _json({"detail": str(exc)}, 400)
    response = HttpResponse(svc.export_template_csv(qs), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="verification-queue-template.csv"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "no-store, private"
    return response


@csrf_exempt
def verification_import(request):
    decoded, err = _gate(request, "POST", VERIFICATION_IMPORTERS, "verification_import", rate="10/m")
    if err:
        return err
    if int(request.META.get("CONTENT_LENGTH") or 0) > svc.IMPORT_MAX_BYTES * 2:     # 先擋明顯過大的請求；真正的上限在解析時再檢查一次
        return _json({"detail": "請求太大"}, 413)
    data, bad = parse_json_body(request)
    if bad:
        return bad
    if not isinstance(data, dict) or not isinstance(data.get("dry_run", True), bool):
        return _json({"detail": "請求格式錯誤：dry_run 必須是 true 或 false"}, 400)
    dry_run = data.get("dry_run", True)          # 預設只預覽；必須明確傳 false 才會寫入
    csv_text = data.get("csv")
    report = svc.parse_import(csv_text)
    if report.error_count:
        return _json({"dry_run": dry_run, "applied": False, **svc.import_summary(report)}, 400)
    if dry_run:
        return _json({"dry_run": True, "applied": False, **svc.import_summary(report, **svc.preview_counts(report))})
    try:
        summary = svc.apply_import(request, decoded, report, csv_text)
    except svc.ValidationFailed as exc:
        return _json({"detail": str(exc)}, 409)
    except IntegrityError:
        return _json({"detail": "匯入時發生衝突，整批已取消，請重新整理後再試"}, 409)
    return _json({"dry_run": False, "applied": True, **summary})
