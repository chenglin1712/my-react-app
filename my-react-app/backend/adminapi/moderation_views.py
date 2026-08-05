"""P3 內容審核端點：分享筆記／發音錄音的下架與刪除、檢舉佇列。

跟 user_views.py 一樣，資料源不是 Django ORM，而是用 Admin SDK 直接讀寫
Firestore（繞過 firestore.rules——這是後端用服務帳戶身分操作，不是使用者
本人，client 端規則本來就不適用）。

檢舉（reports collection）的「建立」不經過這裡——前端直接寫 Firestore
（見 frontend/src/userServives/reportService.jsx），這個集合的 create 規則
本身就足以擋掉濫用，不需要額外的後端端點；這裡只提供 staff 查詢與核結/
駁回。
"""
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import ACCOUNT_MANAGERS, STAFF_ROLES

from . import firebase_ops
from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    safe_write_audit_log as _safe_write_audit_log,
)

logger = logging.getLogger(__name__)

REPORT_STATUS_CHOICES = ("pending", "resolved", "dismissed")


def _paginate(items, request):
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(100, max(1, int(request.GET.get("page_size", 20))))
    except ValueError:
        page_size = 20
    total = len(items)
    start = (page - 1) * page_size
    return items[start:start + page_size], total, page, page_size


def _pending_report_counts(client):
    """{(targetType, targetId): 未結案檢舉數} ——給筆記/錄音列表合併顯示用。"""
    counts = {}
    for doc in client.collection("reports").where("status", "==", "pending").stream():
        data = doc.to_dict()
        key = (data.get("targetType"), data.get("targetId"))
        counts[key] = counts.get(key, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# 分享筆記
# ---------------------------------------------------------------------------

@csrf_exempt
def note_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    from firebase_admin import firestore
    client = firebase_ops.get_firestore_client()
    qs_ref = client.collection("sharedNotes")

    deleted_param = request.GET.get("deleted")
    if deleted_param in ("true", "false"):
        qs_ref = qs_ref.where("deleted", "==", deleted_param == "true")

    docs = list(qs_ref.order_by("createdAt", direction=firestore.Query.DESCENDING).stream())
    report_counts = _pending_report_counts(client)

    items = []
    for doc in docs:
        data = doc.to_dict()
        items.append({
            "id": doc.id,
            "preview": data.get("preview"),
            "image": data.get("image"),
            "uid": data.get("uid"),
            "username": data.get("username"),
            "likes": data.get("likes", 0),
            "deleted": data.get("deleted", False),
            "created_at": data.get("createdAt"),
            "report_count": report_counts.get(("note", doc.id), 0),
        })

    keyword = request.GET.get("keyword", "").strip().lower()
    if keyword:
        items = [
            item for item in items
            if keyword in (item["preview"] or "").lower()
            or keyword in (item["username"] or "").lower()
        ]

    if request.GET.get("has_reports") == "true":
        items = [item for item in items if item["report_count"] > 0]

    page_items, total, page, page_size = _paginate(items, request)
    return JsonResponse({"results": page_items, "count": total, "page": page, "page_size": page_size})


@csrf_exempt
def note_toggle_deleted(request, note_id):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="note_toggle_deleted", rate="30/m")
    if limited_resp:
        return limited_resp

    client = firebase_ops.get_firestore_client()
    doc_ref = client.collection("sharedNotes").document(note_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        return JsonResponse({"detail": "找不到這則分享筆記"}, status=404)

    current = snapshot.to_dict().get("deleted", False)
    new_value = not current
    doc_ref.update({"deleted": new_value})
    _safe_write_audit_log(
        request, decoded, "toggle_note_deleted", note_id, target_type="shared_note",
        before={"deleted": current}, after={"deleted": new_value},
    )
    return JsonResponse({"id": note_id, "deleted": new_value})


# ---------------------------------------------------------------------------
# 發音錄音
# ---------------------------------------------------------------------------

@csrf_exempt
def recording_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    client = firebase_ops.get_firestore_client()
    docs = list(client.collection_group("recordings").stream())
    report_counts = _pending_report_counts(client)

    items = []
    for doc in docs:
        data = doc.to_dict()
        # pronunciations/{tribe}/recordings/{id} ——tribe 要從文件路徑取出，
        # 文件本身也有存一份 tribe 欄位（見 pronunciationRecordingService.js
        # 的 saveRecordingMeta），但路徑才是絕對可靠的來源，兩者理論上一致。
        path_parts = doc.reference.path.split("/")
        tribe = path_parts[1] if len(path_parts) >= 2 else data.get("tribe")
        items.append({
            "id": doc.id,
            "tribe": tribe,
            "word": data.get("word"),
            "uid": data.get("uid"),
            "score": data.get("score"),
            "storage_url": data.get("storageUrl"),
            "created_at": data.get("createdAt"),
            "report_count": report_counts.get(("recording", doc.id), 0),
        })

    items.sort(key=lambda item: item["created_at"] or 0, reverse=True)

    tribe_param = request.GET.get("tribe")
    if tribe_param:
        items = [item for item in items if item["tribe"] == tribe_param]

    if request.GET.get("has_reports") == "true":
        items = [item for item in items if item["report_count"] > 0]

    page_items, total, page, page_size = _paginate(items, request)
    return JsonResponse({"results": page_items, "count": total, "page": page, "page_size": page_size})


@csrf_exempt
def recording_delete(request, tribe, recording_id):
    if request.method != "DELETE":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="recording_delete", rate="30/m", method="DELETE")
    if limited_resp:
        return limited_resp

    client = firebase_ops.get_firestore_client()
    doc_ref = (
        client.collection("pronunciations").document(tribe)
        .collection("recordings").document(recording_id)
    )
    snapshot = doc_ref.get()
    if not snapshot.exists:
        return JsonResponse({"detail": "找不到這筆錄音"}, status=404)

    data = snapshot.to_dict()
    storage_url = data.get("storageUrl")
    storage_deleted = firebase_ops.delete_storage_file_by_download_url(storage_url) if storage_url else False
    doc_ref.delete()

    _safe_write_audit_log(
        request, decoded, "delete_recording", f"{tribe}/{recording_id}",
        target_type="pronunciation_recording",
        before={**data, "storage_deleted": storage_deleted},
    )
    return JsonResponse({"tribe": tribe, "id": recording_id, "deleted": True, "storage_deleted": storage_deleted})


# ---------------------------------------------------------------------------
# 檢舉佇列
# ---------------------------------------------------------------------------

def _fetch_report_target_summary(client, data):
    """盡量帶出目標內容的摘要，讓管理者不用跳頁就能初步判斷。抓不到（內容
    已被刪除）時回傳 None，前端顯示「內容已不存在」。"""
    target_type = data.get("targetType")
    target_id = data.get("targetId")
    try:
        if target_type == "note":
            doc = client.collection("sharedNotes").document(target_id).get()
            if not doc.exists:
                return None
            note = doc.to_dict()
            return {"preview": note.get("preview"), "username": note.get("username")}
        if target_type == "recording":
            tribe = data.get("targetTribe")
            if not tribe:
                return None
            doc = (
                client.collection("pronunciations").document(tribe)
                .collection("recordings").document(target_id).get()
            )
            if not doc.exists:
                return None
            rec = doc.to_dict()
            return {"word": rec.get("word"), "tribe": tribe, "score": rec.get("score")}
    except Exception:
        logger.exception("讀取檢舉目標摘要失敗：%s/%s", target_type, target_id)
        return None
    return None


@csrf_exempt
def report_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    from firebase_admin import firestore
    client = firebase_ops.get_firestore_client()
    qs_ref = client.collection("reports")

    # 只用 Firestore 查詢過濾 status（唯一需要真正複合索引的維度，firestore.
    # indexes.json 有補 status+createdAt），target_type 留到下面在 Python
    # 記憶體裡過濾——四種篩選組合（無/status/target_type/兩者皆有）各自需要
    # 一份獨立複合索引，對這種低流量的內部審核佇列不值得，跟 P3.2 使用者
    # 列表同一種「小規模資料在記憶體篩選」的務實選擇。
    status_param = request.GET.get("status")
    if status_param in REPORT_STATUS_CHOICES:
        qs_ref = qs_ref.where("status", "==", status_param).order_by(
            "createdAt", direction=firestore.Query.DESCENDING
        )
    else:
        qs_ref = qs_ref.order_by("createdAt", direction=firestore.Query.DESCENDING)

    docs = list(qs_ref.stream())

    items = []
    for doc in docs:
        data = doc.to_dict()
        items.append({
            "id": doc.id,
            "target_type": data.get("targetType"),
            "target_id": data.get("targetId"),
            "target_tribe": data.get("targetTribe"),
            "reporter_uid": data.get("reporterUid"),
            "reason": data.get("reason"),
            "reason_text": data.get("reasonText"),
            "status": data.get("status"),
            "created_at": data.get("createdAt"),
            "resolved_by": data.get("resolvedBy"),
            "resolved_at": data.get("resolvedAt"),
            "resolution_note": data.get("resolutionNote"),
            "target_summary": _fetch_report_target_summary(client, data),
        })

    target_type_param = request.GET.get("target_type")
    if target_type_param in ("note", "recording"):
        items = [item for item in items if item["target_type"] == target_type_param]

    page_items, total, page, page_size = _paginate(items, request)
    return JsonResponse({"results": page_items, "count": total, "page": page, "page_size": page_size})


def _resolve_report(request, report_id, new_status):
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="report_resolve", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    from firebase_admin import firestore
    client = firebase_ops.get_firestore_client()
    doc_ref = client.collection("reports").document(report_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        return JsonResponse({"detail": "找不到這筆檢舉"}, status=404)

    before_status = snapshot.to_dict().get("status")
    resolution_note = (data.get("resolution_note") or "").strip()
    doc_ref.update({
        "status": new_status,
        "resolvedBy": decoded.get("uid", "anon"),
        "resolvedAt": firestore.SERVER_TIMESTAMP,
        "resolutionNote": resolution_note,
    })
    _safe_write_audit_log(
        request, decoded, f"report_{new_status}", report_id, target_type="report",
        before={"status": before_status}, after={"status": new_status, "resolution_note": resolution_note},
    )
    return JsonResponse({"id": report_id, "status": new_status})


@csrf_exempt
def report_resolve(request, report_id):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return _resolve_report(request, report_id, "resolved")


@csrf_exempt
def report_dismiss(request, report_id):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return _resolve_report(request, report_id, "dismissed")
