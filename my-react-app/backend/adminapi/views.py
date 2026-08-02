"""adminapi 的公告管理端點。

所有端點都要求 staff 角色（見 config.roles.STAFF_ROLES），寫入類動作再收斂到
更小的角色群組（config.roles.CONTENT_EDITORS／PUBLISHERS）。每個會改資料的
動作都寫一筆 AuditLog——這是「稽核紀錄」這個功能唯一的資料來源，漏寫一個
動作就等於那個動作永遠查不到是誰做的，所以刻意抽成 _write_audit_log 統一
呼叫，不讓每個 view 各自決定要不要寫。

狀態機（見 models.Announcement 開頭的說明）：
  draft ──submit──> pending_review ──approve──> published ──unpublish──> unpublished
    ^                     │                                        │         │
    └──────withdraw───────┤                                        │         │
                           └──reject──> rejected ──submit───────────┘         │
  unpublished ──republish──> published                                       │
  unpublished ──edit（PATCH，視同重新起草）──> draft ───────────────────────────┘

狀態轉換的並發安全：每個會改狀態的動作都在 transaction.atomic() 裡用
select_for_update() 鎖住該筆再讀狀態、檢查、寫入，讀狀態與寫入之間不會被
另一個並發請求插隊（例如兩個審核者同時對同一篇按核准／退件）；AuditLog
的寫入也在同一個交易內，狀態變更與稽核紀錄要嘛一起成功、要嘛一起回滾，
不會出現「資料已經變了但稽核紀錄沒寫到」的情況。
"""
import json
import logging

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django_ratelimit.core import is_ratelimited

from config.firebase_auth import require_role
from config.roles import ACCOUNT_MANAGERS, CONTENT_EDITORS, PUBLISHERS, STAFF_ROLES

from .models import Announcement, AuditLog
from .serializers import (
    AnnouncementSerializer, ApproveSerializer, AuditLogSerializer, RejectSerializer,
)

logger = logging.getLogger(__name__)


def _rate_limited_response(request, decoded, group, rate="60/m", method="POST"):
    """依已登入使用者的 uid 限速，邏輯與 AIModel/views.py、CrosswordPuzzle/views.py 一致。"""
    uid = decoded.get("uid", "anon")
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


def _parse_json_body(request):
    """回傳 (data, error_response)；格式錯誤回 400 而不是讓 JSONDecodeError
    一路往外拋變成 Django 預設的 500 HTML 頁（跟全站其他端點的慣例一致）。"""
    if not request.body:
        return {}, None
    try:
        return json.loads(request.body), None
    except json.JSONDecodeError:
        return None, JsonResponse({"detail": "請求格式錯誤"}, status=400)


def _write_audit_log(request, decoded, action, target, before=None, after=None):
    AuditLog.objects.create(
        actor_uid=decoded.get("uid", "anon"),
        actor_role=decoded.get("role"),
        action=action,
        target_type="announcement",
        target_id=str(target.pk),
        before=before,
        after=after,
        ip_address=request.META.get("REMOTE_ADDR"),
        # User-Agent 沒有長度上限，理論上可以塞任意長字串進來，截斷避免異常
        # 輸入撐爆這個欄位（TextField 本身沒有長度限制，但沒必要真的存整段）。
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:1000] or None),
    )


def _invalid_transition(current_status, action):
    return JsonResponse(
        {"detail": f"目前狀態「{current_status}」無法執行「{action}」"},
        status=409,
    )


def _locked(pk):
    """在交易內取得列鎖後的物件。必須在 transaction.atomic() 區塊裡呼叫。

    每個狀態轉換動作都是「讀狀態 → 檢查是否合法 → 寫入」，兩個 request 同時
    對同一筆公告送出核准／退件，沒有鎖的話兩邊都會讀到同一個舊狀態、都通過
    檢查、都寫入——後寫的會蓋掉先寫的，稽核紀錄也會留下兩筆「合法」的轉換，
    但實際上第二筆發生時第一筆的前提早已不成立。select_for_update() 在
    PostgreSQL（正式環境）會真的鎖住該列，第二個 request 會等第一個交易
    commit 後才讀到最新狀態；SQLite（本機/CI）不支援列鎖但也不會報錯，
    效果退化成整個資料庫層級的寫入序列化，正確性一樣成立，只是沒有
    PostgreSQL 那麼細的鎖粒度。
    """
    return get_object_or_404(Announcement.objects.select_for_update(), pk=pk)


# csrf_exempt 在這裡不是「豁免掉一項保護」，而是「這項保護原本就不適用」，
# 永久生效，不隨 DEBUG 變動：這是無狀態的 Bearer-token JSON API（見
# config/firebase_auth.py 的 require_role），前端從不帶 CSRF cookie，CSRF
# 保護針對的是瀏覽器自動夾帶 session cookie 的情境，跟這裡的認證機制無關
# （比照 AIModel/views.py、CrosswordPuzzle/views.py 同樣的 Bearer-token 端點）。


@csrf_exempt
def announcement_list(request):
    if request.method == "GET":
        return _list_announcements(request)
    if request.method == "POST":
        return _create_announcement(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _list_announcements(request):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    qs = Announcement.objects.all()

    status_param = request.GET.get("status")
    if status_param:
        qs = qs.filter(status=status_param)

    category = request.GET.get("category")
    if category:
        qs = qs.filter(category=category)

    keyword = request.GET.get("keyword")
    if keyword:
        # 前端搜尋框的提示文字寫「搜尋標題或內文」，篩選邏輯要對得上，
        # 不能只比對 title 卻讓使用者以為內文也搜得到。
        qs = qs.filter(Q(title__icontains=keyword) | Q(body__icontains=keyword))

    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(100, max(1, int(request.GET.get("page_size", 20))))
    except ValueError:
        page_size = 20

    tribe = request.GET.get("tribe")
    if tribe:
        # tribes 是 JSONField 存 slug 陣列，空陣列代表「全部族語」。Django 的
        # JSONField __contains 這個 JSON 專用 lookup 官方文件明講只有
        # PostgreSQL／MySQL／Oracle 支援，SQLite 會直接丟 NotSupportedError
        # （本機開發、CI 跑的正是 SQLite）——改成把符合其他篩選條件的資料整批
        # 撈進 Python 記憶體再過濾，兩種資料庫都能正確運作。後台公告的資料
        # 量級不大（以百筆計），這裡犧牲一點查詢效率換取兩邊資料庫行為一致，
        # 之後資料量真的大到需要優化，再改成正式環境專用的 Postgres JSON
        # 查詢語法。
        all_items = list(qs)
        filtered = [a for a in all_items if not a.tribes or tribe in a.tribes]
        total = len(filtered)
        start = (page - 1) * page_size
        items = filtered[start:start + page_size]
    else:
        total = qs.count()
        start = (page - 1) * page_size
        items = list(qs[start:start + page_size])

    return JsonResponse({
        "results": AnnouncementSerializer(items, many=True).data,
        "count": total,
        "page": page,
        "page_size": page_size,
    })


def _create_announcement(request):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_create", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    serializer = AnnouncementSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        announcement = serializer.save(created_by=decoded.get("uid", "anon"))
        _write_audit_log(request, decoded, "create", announcement, after=AnnouncementSerializer(announcement).data)

    return JsonResponse(AnnouncementSerializer(announcement).data, status=201)


@csrf_exempt
def announcement_detail(request, pk):
    if request.method == "GET":
        return _get_announcement(request, pk)
    if request.method == "PATCH":
        return _update_announcement(request, pk)
    if request.method == "DELETE":
        return _delete_announcement(request, pk)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _get_announcement(request, pk):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    announcement = get_object_or_404(Announcement, pk=pk)
    return JsonResponse(AnnouncementSerializer(announcement).data)


def _update_announcement(request, pk):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_update", rate="60/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    with transaction.atomic():
        announcement = _locked(pk)
        # 送審中的內容不能直接改——避免審核者正在看的內容跟送出核准當下已經
        # 不是同一份。已下架的內容允許編輯，但視同「重新起草」，儲存後會退回
        # draft，強制走一次完整的送審／核准流程，不會有「編輯已下架內容後
        # 沒人再審過就悄悄改變了原本核准的版本」這種情況。
        editable_statuses = (
            Announcement.STATUS_DRAFT,
            Announcement.STATUS_REJECTED,
            Announcement.STATUS_UNPUBLISHED,
        )
        if announcement.status not in editable_statuses:
            return _invalid_transition(announcement.status, "edit")

        before = AnnouncementSerializer(announcement).data
        serializer = AnnouncementSerializer(announcement, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        was_unpublished = announcement.status == Announcement.STATUS_UNPUBLISHED
        serializer.save()
        if was_unpublished:
            announcement.status = Announcement.STATUS_DRAFT
            announcement.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request, decoded, "update", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


def _delete_announcement(request, pk):
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_delete", rate="30/m", method="DELETE")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        announcement = _locked(pk)
        # 只允許刪還沒進過審核流程的草稿——曾經送審／發布過的內容一律走「下架」
        # 保留歷史，不提供真的刪除，跟 AuditLog「稽核紀錄不可竄改」同一個精神：
        # 走過審核的內容不該連存在過的痕跡都能被抹掉。
        if announcement.status != Announcement.STATUS_DRAFT:
            return _invalid_transition(announcement.status, "delete")

        before = AnnouncementSerializer(announcement).data
        _write_audit_log(request, decoded, "delete", announcement, before=before)
        announcement.delete()
        return JsonResponse({"detail": "已刪除"}, status=200)


@csrf_exempt
def announcement_submit(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_submit")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        announcement = _locked(pk)
        if announcement.status not in (Announcement.STATUS_DRAFT, Announcement.STATUS_REJECTED):
            return _invalid_transition(announcement.status, "submit")

        before = AnnouncementSerializer(announcement).data
        announcement.status = Announcement.STATUS_PENDING_REVIEW
        announcement.submitted_by = decoded.get("uid", "anon")
        announcement.submitted_at = timezone.now()
        announcement.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])

        _write_audit_log(
            request, decoded, "submit", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


@csrf_exempt
def announcement_withdraw(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_withdraw")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        announcement = _locked(pk)
        if announcement.status != Announcement.STATUS_PENDING_REVIEW:
            return _invalid_transition(announcement.status, "withdraw")

        before = AnnouncementSerializer(announcement).data
        announcement.status = Announcement.STATUS_DRAFT
        announcement.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request, decoded, "withdraw", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


@csrf_exempt
def announcement_approve(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_approve")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = ApproveSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        announcement = _locked(pk)
        if announcement.status != Announcement.STATUS_PENDING_REVIEW:
            return _invalid_transition(announcement.status, "approve")

        before = AnnouncementSerializer(announcement).data
        now = timezone.now()
        announcement.status = Announcement.STATUS_PUBLISHED
        announcement.reviewed_by = decoded.get("uid", "anon")
        announcement.reviewed_at = now
        announcement.review_comment = serializer.validated_data["review_comment"]
        # 核准當下沒有指定排程時間，就視為「立即發布」；已經設定 publish_at 的
        # （排程發布）維持原值，不要核准的當下把排程時間覆蓋掉。
        # 注意：這裡的 publish_at／unpublish_at 目前只有「儲存值」的意義，
        # 核准當下無論排程時間是否在未來都會立刻把 status 設成 published——
        # 還沒有背景排程器會在 publish_at／unpublish_at 真正到達時自動轉換
        # 狀態。前台若之後要接這批公告，必須先補上排程執行機制（或由前台
        # 查詢時自行比對 publish_at／unpublish_at 是否已到），否則「排程發布」
        # 欄位會變成只是儲存了一個沒有作用的時間戳記。
        if not announcement.publish_at:
            announcement.publish_at = now
        announcement.save(update_fields=[
            "status", "reviewed_by", "reviewed_at", "review_comment", "publish_at", "updated_at",
        ])

        _write_audit_log(
            request, decoded, "approve", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


@csrf_exempt
def announcement_reject(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_reject")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = RejectSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        announcement = _locked(pk)
        if announcement.status != Announcement.STATUS_PENDING_REVIEW:
            return _invalid_transition(announcement.status, "reject")

        before = AnnouncementSerializer(announcement).data
        announcement.status = Announcement.STATUS_REJECTED
        announcement.reviewed_by = decoded.get("uid", "anon")
        announcement.reviewed_at = timezone.now()
        announcement.review_comment = serializer.validated_data["review_comment"]
        announcement.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])

        _write_audit_log(
            request, decoded, "reject", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


@csrf_exempt
def announcement_unpublish(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_unpublish")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        announcement = _locked(pk)
        if announcement.status != Announcement.STATUS_PUBLISHED:
            return _invalid_transition(announcement.status, "unpublish")

        before = AnnouncementSerializer(announcement).data
        announcement.status = Announcement.STATUS_UNPUBLISHED
        announcement.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request, decoded, "unpublish", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


@csrf_exempt
def announcement_republish(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="announcement_republish")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        announcement = _locked(pk)
        if announcement.status != Announcement.STATUS_UNPUBLISHED:
            return _invalid_transition(announcement.status, "republish")

        before = AnnouncementSerializer(announcement).data
        announcement.status = Announcement.STATUS_PUBLISHED
        announcement.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request, decoded, "republish", announcement,
            before=before, after=AnnouncementSerializer(announcement).data,
        )
        return JsonResponse(AnnouncementSerializer(announcement).data)


@csrf_exempt
def audit_log_list(request):
    """稽核日誌唯讀清單，給後台儀表板的「最近操作」面板用。

    限縮在 ACCOUNT_MANAGERS（owner／admin）——稽核紀錄的 before/after 會夾帶
    其他使用者送審/編輯過的完整內容快照，語意上屬於規劃文件 §1.2 權限矩陣
    的「系統設定」欄，editor／reviewer／analyst 在那一欄都是 ❌，不應該能讀。
    這裡只提供讀取，寫入完全由 _write_audit_log 內部呼叫，這支端點不開放
    任何寫入方法。
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp

    try:
        limit = min(50, max(1, int(request.GET.get("limit", 10))))
    except ValueError:
        limit = 10

    logs = AuditLog.objects.all()[:limit]
    return JsonResponse({"results": AuditLogSerializer(logs, many=True).data})
