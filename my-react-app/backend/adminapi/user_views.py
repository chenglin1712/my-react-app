"""P3 使用者管理端點：列表／詳情／角色指派／停權／強制登出／個資匯出／刪除帳號。

跟 views.py／quizbank_views.py 的公告/題庫端點不同，這裡完全沒有對應的
Django model——資料源是 Firebase Auth（透過 firebase_ops.py 包裝）與
Firestore `users/{uid}` 文件，唯一落地在 Django ORM 的只有 AuditLog。

使用者列表刻意不建 Firestore 影子索引表（P3 規劃的既有決策）：每次開列表
都用 firebase_ops.list_all_firebase_users() 即時全量拉取，篩選/分頁在
Python 記憶體裡做，跟 Announcement.tribes 篩選同一種務實選擇。
"""
import logging

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import ACCOUNT_MANAGERS, OWNER, ROLE_ASSIGNERS, STAFF_ROLES

from . import firebase_ops
from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    safe_write_audit_log as _safe_write_audit_log,
)

logger = logging.getLogger(__name__)


def _forbidden_if_target_outranks(decoded, target_user_record):
    """ACCOUNT_MANAGERS（owner／admin）的帳號管理動作，如果目標本身是 owner，
    只有 owner 自己能動——不然 admin 可以停權/強制登出/匯出/刪除 owner，等於
    在角色階層之外多開一條迂迴的權限提升路徑。跟 ROLE_ASSIGNERS 刻意只留給
    owner（見 config/roles.py 的說明）是同一道防線，這裡補齊帳號管理動作也
    要遵守，不能因為這幾支端點的角色門檻是 ACCOUNT_MANAGERS 就繞過去。"""
    target_role = (target_user_record.custom_claims or {}).get("role")
    if target_role == OWNER and decoded.get("role") != OWNER:
        return JsonResponse({"detail": "沒有權限對這個帳號執行此操作"}, status=403)
    return None


def _merge_user(user_record, firestore_data):
    claims = user_record.custom_claims or {}
    metadata = user_record.user_metadata
    return {
        "uid": user_record.uid,
        "email": user_record.email,
        "email_verified": user_record.email_verified,
        "disabled": user_record.disabled,
        "role": claims.get("role"),
        "name": firestore_data.get("name"),
        "identity": firestore_data.get("identity"),
        "avatar_url": firestore_data.get("avatarUrl"),
        "join_date": firestore_data.get("joinDate"),
        # 毫秒 epoch，前端自行格式化——跟 Firestore serverTimestamp 存下來的
        # 值不同型別，故意不在後端轉成 ISO 字串，避免時區換算邏輯分散兩處。
        "created_at": metadata.creation_timestamp,
        "last_sign_in_at": metadata.last_sign_in_timestamp,
    }


@csrf_exempt
def user_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    users = firebase_ops.list_all_firebase_users()

    client = firebase_ops.get_firestore_client()
    refs = [client.collection("users").document(u.uid) for u in users]
    docs_by_id = {}
    if refs:
        for doc in client.get_all(refs):
            if doc.exists:
                docs_by_id[doc.id] = doc.to_dict()

    merged = [_merge_user(u, docs_by_id.get(u.uid, {})) for u in users]
    merged.sort(key=lambda item: item["created_at"] or 0, reverse=True)

    keyword = request.GET.get("keyword", "").strip().lower()
    if keyword:
        merged = [
            item for item in merged
            if keyword in (item["email"] or "").lower()
            or keyword in (item["name"] or "").lower()
            or keyword in item["uid"].lower()
        ]

    role_param = request.GET.get("role")
    if role_param:
        merged = [item for item in merged if item["role"] == role_param]

    identity_param = request.GET.get("identity")
    if identity_param:
        merged = [item for item in merged if item["identity"] == identity_param]

    disabled_param = request.GET.get("disabled")
    if disabled_param in ("true", "false"):
        want_disabled = disabled_param == "true"
        merged = [item for item in merged if item["disabled"] == want_disabled]

    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(100, max(1, int(request.GET.get("page_size", 20))))
    except ValueError:
        page_size = 20

    total = len(merged)
    start = (page - 1) * page_size
    items = merged[start:start + page_size]

    return JsonResponse({
        "results": items,
        "count": total,
        "page": page,
        "page_size": page_size,
    })


@csrf_exempt
def user_detail(request, uid):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)

    client = firebase_ops.get_firestore_client()
    doc = client.collection("users").document(uid).get()
    firestore_data = doc.to_dict() if doc.exists else {}

    notes_count = len(list(
        client.collection("sharedNotes").where("uid", "==", uid).stream()
    ))
    recordings_count = len(list(
        client.collection_group("recordings").where("uid", "==", uid).stream()
    ))

    payload = _merge_user(user_record, firestore_data)
    payload["provider_ids"] = [p.provider_id for p in (user_record.provider_data or [])]
    payload["firestore"] = firestore_data
    payload["content_counts"] = {
        "shared_notes": notes_count,
        "pronunciations": recordings_count,
    }
    return JsonResponse(payload)


@csrf_exempt
def user_role(request, uid):
    """僅 owner 可指派/收回角色（ROLE_ASSIGNERS 目前唯一的使用場景）。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ROLE_ASSIGNERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_role", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    role = data.get("role")
    if role is not None and role not in STAFF_ROLES:
        return JsonResponse({"detail": "無效的角色"}, status=400)

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)

    old_role = (user_record.custom_claims or {}).get("role")
    firebase_ops.set_user_role(uid, role)
    firebase_ops.revoke_sessions(uid)
    _safe_write_audit_log(
        request, decoded, "assign_role", uid, target_type="user",
        before={"role": old_role}, after={"role": role},
    )
    return JsonResponse({"uid": uid, "role": role})


@csrf_exempt
def user_suspend(request, uid):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return _set_suspended(request, uid, True)


@csrf_exempt
def user_unsuspend(request, uid):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return _set_suspended(request, uid, False)


def _set_suspended(request, uid, disabled):
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_suspend", rate="30/m")
    if limited_resp:
        return limited_resp

    from firebase_admin import auth as firebase_auth
    try:
        target_user = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_outranks(decoded, target_user)
    if forbidden_resp:
        return forbidden_resp

    firebase_ops.set_user_disabled(uid, disabled)
    firebase_ops.revoke_sessions(uid)
    action = "suspend" if disabled else "unsuspend"
    _safe_write_audit_log(
        request, decoded, action, uid, target_type="user",
        before={"disabled": not disabled}, after={"disabled": disabled},
    )
    return JsonResponse({"uid": uid, "disabled": disabled})


@csrf_exempt
def user_force_logout(request, uid):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_force_logout", rate="30/m")
    if limited_resp:
        return limited_resp

    from firebase_admin import auth as firebase_auth
    try:
        target_user = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_outranks(decoded, target_user)
    if forbidden_resp:
        return forbidden_resp

    firebase_ops.revoke_sessions(uid)
    _safe_write_audit_log(request, decoded, "force_logout", uid, target_type="user")
    return JsonResponse({"uid": uid, "revoked": True})


@csrf_exempt
def user_export(request, uid):
    """個資匯出——把 Firebase Auth 記錄 + Firestore 使用者文件 + 該 uid 名下
    sharedNotes/pronunciations 全部文件包成一個 JSON 檔下載。匯出本身也是
    敏感動作，要寫稽核紀錄。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_export", rate="10/m", method="GET")
    if limited_resp:
        return limited_resp

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_outranks(decoded, user_record)
    if forbidden_resp:
        return forbidden_resp

    client = firebase_ops.get_firestore_client()
    doc = client.collection("users").document(uid).get()
    firestore_data = doc.to_dict() if doc.exists else None

    notes = [
        {"id": d.id, **d.to_dict()}
        for d in client.collection("sharedNotes").where("uid", "==", uid).stream()
    ]
    recordings = [
        {"id": d.id, "path": d.reference.path, **d.to_dict()}
        for d in client.collection_group("recordings").where("uid", "==", uid).stream()
    ]

    export_payload = {
        "auth": _merge_user(user_record, firestore_data or {}),
        "firestore_user_document": firestore_data,
        "shared_notes": notes,
        "pronunciations": recordings,
    }

    _safe_write_audit_log(request, decoded, "export_personal_data", uid, target_type="user")

    import json
    from django.core.serializers.json import DjangoJSONEncoder
    body = json.dumps(export_payload, ensure_ascii=False, indent=2, cls=DjangoJSONEncoder)
    response = HttpResponse(body, content_type="application/json; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="user_export_{uid}.json"'
    return response


@csrf_exempt
def user_delete(request, uid):
    """刪除帳號——body 必填 confirm_email，逐字比對目標帳號真實 email 才會
    真的執行（P3 規劃的既有決策：後台必須輸入該帳號 email 才能刪）。

    Firestore／Storage／Firebase Auth 之間沒有跨系統交易，每一步各自
    try/except，回傳每一步的成功/失敗，讓管理者知道哪個環節沒刪乾淨需要
    人工複查，不假設「要嘛全成功要嘛全失敗」。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_delete", rate="10/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_outranks(decoded, user_record)
    if forbidden_resp:
        return forbidden_resp

    confirm_email = (data.get("confirm_email") or "").strip()
    if not confirm_email or confirm_email != user_record.email:
        return JsonResponse({"detail": "輸入的 email 與目標帳號不符"}, status=400)

    client = firebase_ops.get_firestore_client()
    doc_ref = client.collection("users").document(uid)
    firestore_snapshot = doc_ref.get()
    before_snapshot = {
        "auth": {
            "uid": user_record.uid, "email": user_record.email,
            "disabled": user_record.disabled,
            "custom_claims": user_record.custom_claims,
        },
        "firestore_user_document": firestore_snapshot.to_dict() if firestore_snapshot.exists else None,
    }

    results = {}

    try:
        notes = list(client.collection("sharedNotes").where("uid", "==", uid).stream())
        for note in notes:
            note.reference.delete()
        results["shared_notes"] = {"deleted": len(notes)}
    except Exception:
        logger.exception("刪除帳號 %s 的 sharedNotes 失敗", uid)
        results["shared_notes"] = {"deleted": 0, "error": "刪除失敗，需人工複查"}

    try:
        recordings = list(client.collection_group("recordings").where("uid", "==", uid).stream())
        deleted_count = 0
        storage_failed = 0
        for rec in recordings:
            rec_data = rec.to_dict()
            storage_url = rec_data.get("storageUrl")
            # Storage 音檔刪除失敗時（例如物件已不存在、網址格式不符預期）不能
            # 悄悄略過——這裡仍然刪掉 Firestore 文件（審核者的意圖是整筆錄音都
            # 不該再留），但把失敗筆數回報出來，讓管理者知道有孤兒音檔需要
            # 人工到 Storage 主控台複查，而不是被 "deleted" 數字誤導成全部乾淨。
            if storage_url and not firebase_ops.delete_storage_file_by_download_url(storage_url):
                storage_failed += 1
                logger.warning("刪除帳號 %s 的錄音 %s 時，Storage 音檔清除失敗：%s", uid, rec.id, storage_url)
            rec.reference.delete()
            deleted_count += 1
        results["pronunciations"] = {"deleted": deleted_count, "storage_cleanup_failed": storage_failed}
    except Exception:
        logger.exception("刪除帳號 %s 的 pronunciations 失敗", uid)
        results["pronunciations"] = {"deleted": 0, "error": "刪除失敗，需人工複查"}

    try:
        if firestore_snapshot.exists:
            doc_ref.delete()
        results["firestore_user_document"] = {"deleted": True}
    except Exception:
        logger.exception("刪除帳號 %s 的 users 文件失敗", uid)
        results["firestore_user_document"] = {"deleted": False, "error": "刪除失敗，需人工複查"}

    try:
        firebase_ops.delete_firebase_user(uid)
        results["firebase_auth"] = {"deleted": True}
    except Exception:
        logger.exception("刪除帳號 %s 的 Firebase Auth 記錄失敗", uid)
        results["firebase_auth"] = {"deleted": False, "error": "刪除失敗，需人工複查"}

    _safe_write_audit_log(
        request, decoded, "delete_account", uid, target_type="user",
        before=before_snapshot, after=results,
    )
    return JsonResponse({"uid": uid, "results": results})
