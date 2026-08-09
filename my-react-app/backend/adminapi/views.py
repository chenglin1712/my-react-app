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
import logging

from django.db import transaction
from django.db.models import Case, Q, When
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import ACCOUNT_MANAGERS, CONTENT_EDITORS, PUBLISHERS, STAFF_ROLES
from crawler.views import apply_exam_schedule_overrides, get_exam_schedule_data

from ._shared import (
    invalid_transition as _invalid_transition,
    ip_rate_limited_response as _ip_rate_limited_response,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    write_audit_log as _write_audit_log,
)
from .crawler_sync import sync_crawler_announcements
from .models import (
    Announcement, AnnouncementSyncStatus, AuditLog, ExamScheduleCrawlStatus,
    ExamScheduleOverride, HomepageConfig, PendingRevision,
)
from .revisions import cancel_stale_pending_revision, make_revision_views, pending_revision_target_ids
from .serializers import (
    AnnouncementSerializer, ApproveSerializer, AuditLogSerializer,
    ExamScheduleOverrideSerializer, HomepageConfigSerializer, PublicAnnouncementSerializer,
    PublicHomepageConfigSerializer, RejectSerializer,
)

logger = logging.getLogger(__name__)

# _rate_limited_response／_ip_rate_limited_response／_parse_json_body／
# _write_audit_log／_invalid_transition 的實作已經搬到 _shared.py（見該檔案
# 開頭說明：revisions.py 需要同一批工具，但這裡之後會 import revisions.py，
# 兩邊互相 import 會循環），這裡用上面的 import ... as ... 保留原本名稱，
# 這個檔案裡其餘程式碼完全不用改呼叫方式。


def _announcement_source_priority():
    """後台自建內容永遠排在爬蟲匯入內容前面（規劃文件 §3.2.1 的既定要求）
    ——admin=0 排前面，crawler=1 排後面。抽成共用函式讓後台列表
    （_list_announcements）跟公開列表（public_announcement_list）用同一份
    規則，不要各自維護一份容易漂移（獨立審查找到的問題：原本只有公開
    列表有這個排序鍵，後台列表完全沒有，近期整批匯入的爬蟲資料會把後台
    自建公告推到後面的分頁，管理者反而找不到自己剛寫的公告）。"""
    return Case(When(source=Announcement.SOURCE_ADMIN, then=0), default=1)


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

    qs = Announcement.objects.order_by(_announcement_source_priority(), '-created_at', '-pk')

    status_param = request.GET.get("status")
    if status_param:
        qs = qs.filter(status=status_param)

    category = request.GET.get("category")
    if category:
        qs = qs.filter(category=category)

    source = request.GET.get("source")
    if source:
        qs = qs.filter(source=source)

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

    pending_ids = pending_revision_target_ids("announcement", [item.pk for item in items])
    results = AnnouncementSerializer(items, many=True).data
    for result, item in zip(results, items):
        result["has_pending_revision"] = item.pk in pending_ids

    return JsonResponse({
        "results": results,
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


def public_announcement_list(request):
    """首頁用的公開公告清單——不需要登入，任何人都能打。

    只回傳 status=published 且目前在 publish_at／unpublish_at 時間窗內的
    公告：這就是排程發布／下架實際生效的地方——approve() 當下只是把狀態
    設成 published、把 publish_at／unpublish_at 存起來（見 views.py 開頭
    狀態機說明旁的註解），並沒有背景排程器會在時間到的時候自動切換狀態；
    真正的「有沒有到發布時間」判斷延後到這裡，讀取當下用資料庫查詢條件
    決定要不要顯示，不需要額外的排程機制，也不會有排程器沒跑準時的問題。
    """
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_announcement_list", rate="120/m")
    if limited_resp:
        return limited_resp

    now = timezone.now()
    today = timezone.localdate()
    # 「有效置頂」——只有 is_pinned=True 且 pin_until 還沒過期才算置頂；
    # 原本只看 is_pinned 欄位，不會檢查是否已過期，導致 pin_until 這個
    # 「避免永久置頂被遺忘」的設計形同虛設（獨立審查找到的問題）。
    effectively_pinned = Case(
        When(is_pinned=True, pin_until__gte=today, then=0),
        default=1,
    )
    qs = Announcement.objects.filter(status=Announcement.STATUS_PUBLISHED).filter(
        Q(publish_at__isnull=True) | Q(publish_at__lte=now)
    ).filter(
        Q(unpublish_at__isnull=True) | Q(unpublish_at__gt=now)
    ).order_by(
        # 後台自建內容永遠排在爬蟲匯入內容前面（規劃文件 §3.2.1 的既有
        # 要求），不因為置頂與否而改變——這個排序鍵要放在置頂之前：原本
        # -is_pinned 是第一排序鍵，一筆被人工設成置頂的爬蟲公告會排到
        # 未置頂的自建公告前面，違反「自建一律優先」（獨立審查找到的
        # 問題）。同一個 source 內部才依置頂／時間排序。
        _announcement_source_priority(),
        effectively_pinned,
        '-created_at', '-pk',
    )

    try:
        limit = min(50, max(1, int(request.GET.get("limit", 20))))
    except ValueError:
        limit = 20

    items = list(qs[:limit])
    return JsonResponse({"results": PublicAnnouncementSerializer(items, many=True).data})


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
    data = AnnouncementSerializer(announcement).data
    data["has_pending_revision"] = bool(pending_revision_target_ids("announcement", [announcement.pk]))
    return JsonResponse(data)


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
        # 下架後這篇公告不再是「已發布」，任何殘留的待審修改都對不上現狀
        # 了——主動取消，避免核准時悄悄套用到已下架內容（見
        # revisions.cancel_stale_pending_revision 的完整說明）。
        cancel_stale_pending_revision("announcement", announcement.pk, decoded.get("uid", "anon"))

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


# 編輯已發布公告用（見 revisions.py）：不動正在生效的那一列，提案的新內容
# 先存在 PendingRevision，核准後才套用回去——公告已經有 unpublished 狀態
# 可以編輯，但那條路徑會讓公告從首頁消失，這裡補上「不下架也能編輯」的路徑。
# 核准／退件角色用 PUBLISHERS，跟公告本身的 approve/reject/unpublish 一致
# （不是題庫類內容用的 CONTENT_APPROVERS）。
_announcement_revision_views = make_revision_views(Announcement, AnnouncementSerializer, "announcement", PUBLISHERS)
announcement_pending_revision = _announcement_revision_views["pending_revision"]
announcement_revision_approve = _announcement_revision_views["approve"]
announcement_revision_reject = _announcement_revision_views["reject"]


def _sync_status_payload(status):
    return {
        "last_success_at": status.last_success_at,
        "last_failure_at": status.last_failure_at,
        "last_failure_reason": status.last_failure_reason,
        "consecutive_failures": status.consecutive_failures,
        "last_imported_count": status.last_imported_count,
        "last_skipped_count": status.last_skipped_count,
    }


@csrf_exempt
def announcement_sync_crawler(request):
    """GET：只回目前的同步狀態（給後台頁面載入時顯示「上次同步時間」用，
    不觸發任何爬取）。POST：手動觸發「把爬蟲抓到的活動/考試消息同步成
    後台公告」（見 adminapi/crawler_sync.py 的完整說明），跟考試時程的
    手動重爬（_exam_schedule_refresh）同一層級的 CONTENT_EDITORS 權限；
    限流比重爬更嚴（5/m，考試時程重爬是 10/m），因為這支同步一次會強制
    重新爬兩個外部來源，且會實際寫入資料庫。"""
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp

    if request.method == "GET":
        return JsonResponse({"status": _sync_status_payload(AnnouncementSyncStatus.load())})

    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)

    limited_resp = _rate_limited_response(request, decoded, group="announcement_sync_crawler", rate="5/m")
    if limited_resp:
        return limited_resp

    result = sync_crawler_announcements(force_refresh=True)
    status = AnnouncementSyncStatus.load()
    _write_audit_log(
        request, decoded, "sync", status,
        target_type="announcement_crawler_sync", after=result,
    )

    return JsonResponse({**result, "status": _sync_status_payload(status)})


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


@csrf_exempt
def homepage_config_admin(request):
    if request.method == "GET":
        return _get_homepage_config(request)
    if request.method == "PATCH":
        return _update_homepage_config(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _get_homepage_config(request):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    config = HomepageConfig.load()
    return JsonResponse(HomepageConfigSerializer(config).data)


def _update_homepage_config(request):
    # PUBLISHERS：這個設定直接影響公開首頁的實際顯示內容，視同「發布」動作，
    # 跟 Announcement 的核准/發布同一層級（owner／admin），不開放給 editor
    # 自己就能改公開首頁看起來的樣子。
    decoded, err_resp = require_role(request, PUBLISHERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="homepage_config_update", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    HomepageConfig.load()  # 確保單例那筆存在，鎖之前才有列可鎖
    with transaction.atomic():
        config = HomepageConfig.objects.select_for_update().get(pk=1)
        before = HomepageConfigSerializer(config).data
        serializer = HomepageConfigSerializer(config, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        config = serializer.save(updated_by=decoded.get("uid", "anon"))

        _write_audit_log(
            request, decoded, "update", config, target_type="homepage_config",
            before=before, after=HomepageConfigSerializer(config).data,
        )
    return JsonResponse(HomepageConfigSerializer(config).data)


def public_homepage_config(request):
    """公開首頁讀取用，不需要登入。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    limited_resp = _ip_rate_limited_response(request, group="public_homepage_config", rate="120/m")
    if limited_resp:
        return limited_resp
    config = HomepageConfig.load()
    return JsonResponse(PublicHomepageConfigSerializer(config).data)
