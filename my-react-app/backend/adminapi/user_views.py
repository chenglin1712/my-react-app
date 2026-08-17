"""P3 使用者管理端點：列表／詳情／角色指派／停權／強制登出／個資匯出／刪除帳號。

跟 views.py／quizbank_views.py 的公告/題庫端點不同，這裡完全沒有對應的
Django model——資料源是 Firebase Auth（透過 firebase_ops.py 包裝）與
Firestore `users/{uid}` 文件，唯一落地在 Django ORM 的只有 AuditLog。

使用者列表刻意不建 Firestore 影子索引表（P3 規劃的既有決策）：每次開列表
都用 firebase_ops.list_all_firebase_users() 即時全量拉取，篩選/分頁在
Python 記憶體裡做，跟 Announcement.tribes 篩選同一種務實選擇。

授權規則（是否對自己動手、是否會讓系統失去最後一位 owner…）跟使用者資料
整形搬到 user_service.py（P4 review BE-16），這裡只保留 HTTP 邊界的事：
method 檢查、角色檢查、限流、request 參數解析、JsonResponse 包裝。
"""
import logging

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import ACCOUNT_MANAGERS, OWNER, ROLE_ASSIGNERS, STAFF_ROLES

from . import firebase_ops
from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    safe_write_audit_log as _safe_write_audit_log,
)
from .user_service import (
    _default_firestore_user_doc,
    _forbidden_if_self_target,
    _forbidden_if_target_outranks,
    _forbidden_if_would_remove_last_owner,
    _merge_user,
)

logger = logging.getLogger(__name__)


@csrf_exempt
def user_list(request):
    if request.method == "GET":
        return _list_users(request)
    if request.method == "POST":
        return _create_user(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _list_users(request):
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


def _create_user(request):
    """後台直接建立使用者帳號——不一定要透過前台 /register 走一次公開
    註冊流程（P3.8 的既有決策）。ACCOUNT_MANAGERS 就能建立一般帳號，但
    建立當下要順便指派角色（role 欄位非 null）時，額外要求呼叫者是
    owner——跟獨立的角色指派端點（user_role）同一道防線，不能因為走的是
    建立帳號這條路就繞過「只有 owner 能指派角色」。"""
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_create", rate="10/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()
    identity = (data.get("identity") or "學生").strip()
    avatar_url = (data.get("avatar_url") or "").strip()
    role = data.get("role")

    if not email or not name:
        return JsonResponse({"detail": "email 與姓名為必填"}, status=400)
    if len(password) < 6:
        return JsonResponse({"detail": "密碼至少需要 6 個字元"}, status=400)
    if role is not None and role not in STAFF_ROLES:
        return JsonResponse({"detail": "無效的角色"}, status=400)
    if role is not None and decoded.get("role") != OWNER:
        return JsonResponse({"detail": "只有 owner 可以在建立帳號時指派角色"}, status=403)

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.create_firebase_user(email, password, display_name=name)
    except firebase_auth.EmailAlreadyExistsError:
        return JsonResponse({"detail": "這個 email 已經被使用"}, status=400)
    except (ValueError, firebase_auth.FirebaseError) as e:
        # ValueError 是 Admin SDK 對 email 格式等參數做用戶端驗證失敗時丟出；
        # FirebaseError 涵蓋其餘伺服器端拒絕的情況。訊息本身是英文但已經
        # 夠明確，直接透出比自己重新設計一份錯誤訊息更不容易漏掉 SDK
        # 版本更新後新增的檢查項目。
        return JsonResponse({"detail": str(e)}, status=400)

    client = firebase_ops.get_firestore_client()
    try:
        client.collection("users").document(user_record.uid).set(
            _default_firestore_user_doc(email, name, identity, avatar_url)
        )
    except Exception:
        # Firestore 文件沒建成功的帳號能登入、但前台幾乎每個功能都會因為
        # users/{uid} 不存在而出錯——這種「半殘帳號」比完全沒建立更糟，
        # 寧可把剛剛建立的 Auth 帳號刪掉、讓整個操作乾淨失敗，也不要留著。
        logger.exception("建立使用者 %s 的 Firestore 文件失敗，嘗試 rollback Auth 帳號", email)
        try:
            firebase_ops.delete_firebase_user(user_record.uid)
        except Exception:
            # rollback 也失敗——這個 uid 現在是「Auth 帳號存在、Firestore
            # 文件不存在」的半殘狀態，不能只寫 log 就回一句籠統的失敗訊息，
            # 不然管理者完全不知道這個 uid 還留著、需要人工清理（獨立審查
            # 找到的問題）。
            logger.exception("rollback 建立失敗的 Auth 帳號 %s 也失敗，需人工複查", user_record.uid)
            return JsonResponse({
                "detail": "建立使用者失敗，且清理未完成的帳號也失敗，這個帳號需要人工複查",
                "uid": user_record.uid, "auth_created": True, "firestore_created": False,
                "cleanup_required": True,
            }, status=500)
        return JsonResponse({"detail": "建立使用者失敗，請稍後再試"}, status=500)

    # 帳號＋Firestore 文件都建立成功後才指派角色——這一步失敗不該讓整個
    # 建立操作回報成失敗（帳號本身是完整可用的，只是還沒有角色，屬於
    # 「事後到使用者詳情頁重新指派」就能修好的溫和缺陷，不需要走破壞性
    # 更大的 rollback）；但也不能靜默吞掉，前端要能看到 role_assigned
    # 才知道需要提醒管理者手動補指派（獨立審查找到的問題）。
    role_assigned = True
    if role is not None:
        try:
            firebase_ops.set_user_role(user_record.uid, role)
        except Exception:
            role_assigned = False
            logger.exception(
                "建立使用者 %s 後指派角色 %s 失敗，帳號已建立但角色未設定，需至使用者詳情頁重新指派",
                user_record.uid, role,
            )

    _safe_write_audit_log(
        request, decoded, "create_user", user_record.uid, target_type="user",
        after={"email": email, "name": name, "identity": identity, "role": role if role_assigned else None},
    )

    payload = _merge_user(user_record, {"name": name, "identity": identity, "avatarUrl": avatar_url})
    payload["role_assigned"] = role_assigned
    return JsonResponse(payload, status=201)


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

    forbidden_resp = _forbidden_if_self_target(decoded, uid, "指派角色")
    if forbidden_resp:
        return forbidden_resp

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
    if old_role == OWNER and role != OWNER:
        forbidden_resp = _forbidden_if_would_remove_last_owner(user_record, uid)
        if forbidden_resp:
            return forbidden_resp
    firebase_ops.set_user_role(uid, role)
    firebase_ops.revoke_sessions(uid)
    _safe_write_audit_log(
        request, decoded, "assign_role", uid, target_type="user",
        before={"role": old_role}, after={"role": role},
    )
    return JsonResponse({"uid": uid, "role": role})


@csrf_exempt
def user_profile(request, uid):
    """編輯使用者基本資料——name／identity／avatar_url 是 Firestore
    users/{uid} 文件的欄位，email 選填、有帶才同步更新 Firebase Auth
    （前台註冊時兩邊各存一份，見 userServive.jsx 的 registerWithImg，
    這裡改了 Auth 這邊也要跟著改，不然兩邊會不一致）。partial update：
    body 裡沒帶到的欄位維持原值不動。"""
    if request.method != "PATCH":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_profile", rate="30/m")
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

    client = firebase_ops.get_firestore_client()
    doc_ref = client.collection("users").document(uid)
    before_snapshot = doc_ref.get()
    before_data = before_snapshot.to_dict() if before_snapshot.exists else {}

    firestore_updates = {}
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return JsonResponse({"detail": "姓名不可為空"}, status=400)
        firestore_updates["name"] = name
    if "identity" in data:
        firestore_updates["identity"] = (data.get("identity") or "").strip()
    if "avatar_url" in data:
        firestore_updates["avatarUrl"] = (data.get("avatar_url") or "").strip()

    email_changed = False
    original_email = user_record.email
    new_email = data.get("email")
    if new_email is not None:
        new_email = new_email.strip()
        if not new_email:
            return JsonResponse({"detail": "email 不可為空"}, status=400)
        if new_email != user_record.email:
            try:
                firebase_ops.set_user_email(uid, new_email)
            except firebase_auth.EmailAlreadyExistsError:
                return JsonResponse({"detail": "這個 email 已經被使用"}, status=400)
            except (ValueError, firebase_auth.FirebaseError) as e:
                return JsonResponse({"detail": str(e)}, status=400)
            email_changed = True
            firestore_updates["email"] = new_email

    if firestore_updates:
        try:
            doc_ref.set(firestore_updates, merge=True)
        except Exception:
            logger.exception("更新使用者 %s 的 Firestore 資料失敗", uid)
            if not email_changed:
                return JsonResponse({"detail": "更新使用者資料失敗，請稍後再試"}, status=500)
            # email 兩邊各存一份（Firebase Auth／Firestore users/{uid}），
            # Auth 已經改成功了——這裡的 Firestore 寫入如果失敗，兩邊會
            # 永久不一致，且下次重試時因為 Auth 那邊的 email 已經是新值，
            # `new_email != user_record.email` 會判斷成不需要再改，
            # Firestore 的舊 email 永遠沒有機會自動修正。失敗時嘗試把
            # Auth email 回復成原值，讓兩邊至少維持一致（都是舊值），而
            # 不是留下一個只有這裡才知道、事後也修不回去的不一致狀態
            # （獨立審查找到的問題）。
            try:
                firebase_ops.set_user_email(uid, original_email)
            except Exception:
                logger.exception("回復使用者 %s 的 Auth email 也失敗，Auth 與資料庫已經不一致，需人工複查", uid)
                return JsonResponse({
                    "detail": "更新 email 失敗，且 Auth 與資料庫的 email 可能已經不一致，需要人工複查",
                    "uid": uid,
                }, status=500)
            return JsonResponse({"detail": "更新 email 失敗，請稍後再試"}, status=500)

    _safe_write_audit_log(
        request, decoded, "update_profile", uid, target_type="user",
        before=before_data, after={**before_data, **firestore_updates},
    )

    updated_record = firebase_ops.get_firebase_user(uid)
    updated_doc = doc_ref.get()
    payload = _merge_user(updated_record, updated_doc.to_dict() if updated_doc.exists else {})
    return JsonResponse(payload)


@csrf_exempt
def user_password(request, uid):
    """管理員代使用者變更密碼——比停權/刪除更敏感（等於能無聲完整接管
    帳號登入身分），比照刪除帳號的確認強度，要求輸入目標帳號 email 逐字
    相符才會執行；成功後強制 revoke_sessions，被改密碼的人手上所有舊
    登入立刻失效（也是在提示使用者「有異常」的唯一訊號，因為我們不會
    寄信通知）。稽核紀錄故意不存新密碼本身，只記錄「密碼已變更」這個
    事實，避免明文密碼留在 AuditLog 裡。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="user_password", rate="10/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    new_password = data.get("new_password") or ""
    if len(new_password) < 6:
        return JsonResponse({"detail": "密碼至少需要 6 個字元"}, status=400)

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

    firebase_ops.set_user_password(uid, new_password)
    # 密碼本身已經改成功——這是不可逆的既成事實，接下來的 revoke_sessions
    # 失敗不該讓整個請求變成一個誤導人的 500（管理者會以為密碼沒改成功，
    # 但實際上新密碼已經生效，舊 session 卻還沒撤銷，這在「帳號疑似被
    # 接管」的情境下尤其危險：越以為沒生效，越不會意識到需要進一步處理）。
    # 誠實回報 sessions_revoked，不要用 bare except 吞掉也不要讓它一路
    # 往外拋（獨立審查找到的問題）。
    sessions_revoked = True
    try:
        firebase_ops.revoke_sessions(uid)
    except Exception:
        sessions_revoked = False
        logger.exception("使用者 %s 密碼已變更，但撤銷登入狀態失敗，舊登入可能仍然有效，需人工複查", uid)
    _safe_write_audit_log(
        request, decoded, "change_password", uid, target_type="user",
        after={"password_changed": True, "sessions_revoked": sessions_revoked},
    )
    return JsonResponse({"uid": uid, "password_changed": True, "sessions_revoked": sessions_revoked})


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

    if disabled:
        forbidden_resp = _forbidden_if_self_target(decoded, uid, "停權")
        if forbidden_resp:
            return forbidden_resp

    from firebase_admin import auth as firebase_auth
    try:
        target_user = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_outranks(decoded, target_user)
    if forbidden_resp:
        return forbidden_resp
    if disabled:
        forbidden_resp = _forbidden_if_would_remove_last_owner(target_user, uid)
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

    forbidden_resp = _forbidden_if_self_target(decoded, uid, "刪除帳號")
    if forbidden_resp:
        return forbidden_resp

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
    forbidden_resp = _forbidden_if_would_remove_last_owner(user_record, uid)
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
            # 用文件真正的路徑區段（pronunciations/{tribe}/recordings/{id}）
            # 組出預期前綴，不是信任文件內部欄位——避免偽造的 storageUrl
            # 誘使刪除同 bucket 裡不相關的物件。
            rec_tribe = rec.reference.parent.parent.id
            # Storage 音檔刪除失敗時（例如物件已不存在、網址格式不符預期）不能
            # 悄悄略過——這裡仍然刪掉 Firestore 文件（審核者的意圖是整筆錄音都
            # 不該再留），但把失敗筆數回報出來，讓管理者知道有孤兒音檔需要
            # 人工到 Storage 主控台複查，而不是被 "deleted" 數字誤導成全部乾淨。
            if storage_url and not firebase_ops.delete_storage_file_by_download_url(
                storage_url, expected_path_prefix=f"pronunciations/{rec_tribe}/",
            ):
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
