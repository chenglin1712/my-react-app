"""族語認證考試時程的後台管理端點——爬蟲抓到的原始結果 vs. 後台人工覆寫，
從 views.py 抽出來（P4 review BE-16：原本的 views.py 把 Announcement／
考試時程／首頁版位三種不相關的資源焊在同一個檔案裡）。"""
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import CONTENT_EDITORS, STAFF_ROLES
from crawler.views import apply_exam_schedule_overrides, get_exam_schedule_data

from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .models import ExamScheduleCrawlStatus, ExamScheduleOverride
from .serializers import ExamScheduleOverrideSerializer


@csrf_exempt
def exam_schedule_admin(request):
    if request.method == "GET":
        return _exam_schedule_overview(request)
    if request.method == "POST":
        return _exam_schedule_refresh(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _exam_schedule_overview(request):
    """左側「爬蟲抓到的原始結果」／右側「後台生效值」的比對資料，外加爬蟲
    執行狀態——三塊資料合在一支端點回，前端不用分開打三次。"""
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    data = get_exam_schedule_data()
    crawled_phases = data["phases"] if data else []
    status = ExamScheduleCrawlStatus.load()

    return JsonResponse({
        "crawled": {
            "available": data is not None,
            "session": data["session"] if data else None,
            "phases": crawled_phases,
        },
        "effective_phases": apply_exam_schedule_overrides(crawled_phases),
        "overrides": ExamScheduleOverrideSerializer(ExamScheduleOverride.objects.all(), many=True).data,
        "status": {
            "last_success_at": status.last_success_at,
            "last_failure_at": status.last_failure_at,
            "last_failure_reason": status.last_failure_reason,
            "consecutive_failures": status.consecutive_failures,
        },
    })


def _exam_schedule_refresh(request):
    """手動觸發重爬——略過 15 分鐘快取，強制重新打一次官網。CONTENT_EDITORS
    即可（跟公告的「編輯／送審」同一層級，不是需要 PUBLISHERS 的發布動作），
    限流比一般查詢端點嚴格，避免被拿來當成打外部網站的放大器。"""
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="exam_schedule_refresh", rate="10/m")
    if limited_resp:
        return limited_resp

    data = get_exam_schedule_data(force_refresh=True)
    status = ExamScheduleCrawlStatus.load()
    _write_audit_log(
        request, decoded, "refresh", status, target_type="exam_schedule",
        after={"success": data is not None, "consecutive_failures": status.consecutive_failures},
    )

    return JsonResponse({
        "crawled": {
            "available": data is not None,
            "session": data["session"] if data else None,
            "phases": data["phases"] if data else [],
        },
        "status": {
            "last_success_at": status.last_success_at,
            "last_failure_at": status.last_failure_at,
            "last_failure_reason": status.last_failure_reason,
            "consecutive_failures": status.consecutive_failures,
        },
    })


@csrf_exempt
def exam_schedule_override_detail(request, phase):
    if request.method == "PUT":
        return _upsert_exam_schedule_override(request, phase)
    if request.method == "DELETE":
        return _delete_exam_schedule_override(request, phase)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _upsert_exam_schedule_override(request, phase):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="exam_schedule_override_write", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    data = {**data, "phase": phase}

    with transaction.atomic():
        # phase 是覆寫表的 natural key（URL 帶的就是它，不是自動遞增 id），
        # 用 select_for_update() 鎖現有列；新建的情況下沒有列可鎖，這裡
        # 犧牲掉的是「兩個人同時新建同一個全新 phase」這個極窄的競爭窗口，
        # 對這種低流量的後台維運頁面不值得為此再多引入額外機制。
        instance = ExamScheduleOverride.objects.select_for_update().filter(phase=phase).first()
        before = ExamScheduleOverrideSerializer(instance).data if instance else None
        serializer = ExamScheduleOverrideSerializer(instance, data=data)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        override = serializer.save(updated_by=decoded.get("uid", "anon"))

        _write_audit_log(
            request, decoded, "upsert", override, target_type="exam_schedule_override",
            before=before, after=ExamScheduleOverrideSerializer(override).data,
        )
    return JsonResponse(ExamScheduleOverrideSerializer(override).data)


def _delete_exam_schedule_override(request, phase):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp

    with transaction.atomic():
        override = get_object_or_404(ExamScheduleOverride.objects.select_for_update(), phase=phase)
        before = ExamScheduleOverrideSerializer(override).data
        _write_audit_log(request, decoded, "delete", override, target_type="exam_schedule_override", before=before)
        override.delete()

    return JsonResponse({"detail": "已清除覆寫"})
