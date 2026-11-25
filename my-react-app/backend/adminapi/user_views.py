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

from config.roles import ACCOUNT_MANAGERS, OWNER, ROLE_ASSIGNERS, STAFF_ROLES

from firebase_admin.exceptions import FirebaseError

from . import firebase_ops, quiz_research_service
from .user_data_locations import DELETED_USER_PLACEHOLDER, LOCATIONS, export_docs, find_docs
from .user_input import (
    AVATAR_URL_MAX, EMAIL_MAX, IDENTITY_MAX, NAME_MAX, PASSWORD_MAX,
    firebase_error_message, mask_email, text_field,
)
from ._shared import (
    guarded_action,
    mark_action_failed as _mark_action_failed,
    parse_json_body as _parse_json_body,
    safe_write_audit_log as _safe_write_audit_log,
    write_audit_log_first as _write_audit_log_first,
)
from .user_service import (
    _default_firestore_user_doc,
    _forbidden_if_self_target,
    _forbidden_if_target_is_privileged,
    _forbidden_if_target_outranks,
    _forbidden_if_would_remove_last_owner,
    _merge_user,
)

logger = logging.getLogger(__name__)


def _audit_value(key, value):
    return mask_email(value) if key == "email" else value


def _count_query(query):
    """稽核 BE2a-18：用 Firestore 的 count() 聚合查詢取筆數，不把整批文件讀回來；聚合不可用時退回逐筆計數。"""
    try:
        value = query.count().get()[0][0].value
        if isinstance(value, int):
            return value
    except Exception:
        logger.debug("count() 聚合查詢不可用，改用逐筆計數", exc_info=True)
    return len(list(query.stream()))


@csrf_exempt
def user_list(request):
    if request.method == "GET":
        return _list_users(request)
    if request.method == "POST":
        return _create_user(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="GET", role=STAFF_ROLES)
def _list_users(request, decoded):
    users = firebase_ops.list_all_firebase_users(use_cache=True)     # 稽核 BE2a-18：列表頁容許 45 秒前的資料

    client = firebase_ops.get_firestore_client()
    refs = [client.collection("users").document(u.uid) for u in users]
    docs_by_id = {}
    if refs:
        for doc in client.get_all(refs):
            if doc.exists:
                docs_by_id[doc.id] = doc.to_dict()

    # 只有能管理帳號的角色（owner、admin）看得到 email；其他員工角色不給 email，
    # 關鍵字也不比對 email，否則可以靠搜尋結果反推某個 email 是否註冊過（稽核 FLW-6）
    can_see_email = decoded.get("role") in ACCOUNT_MANAGERS
    merged = [_merge_user(u, docs_by_id.get(u.uid, {}), include_email=can_see_email) for u in users]
    merged.sort(key=lambda item: item["created_at"] or 0, reverse=True)

    keyword = request.GET.get("keyword", "").strip().lower()
    if keyword:
        merged = [
            item for item in merged
            if (can_see_email and keyword in (item["email"] or "").lower())
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


@guarded_action(method="POST", role=ACCOUNT_MANAGERS, rate_limit=("user_create", "10/m"))
def _create_user(request, decoded):
    """後台直接建立使用者帳號——不一定要透過前台 /register 走一次公開
    註冊流程（P3.8 的既有決策）。ACCOUNT_MANAGERS 就能建立一般帳號，但
    建立當下要順便指派角色（role 欄位非 null）時，額外要求呼叫者是
    owner——跟獨立的角色指派端點（user_role）同一道防線，不能因為走的是
    建立帳號這條路就繞過「只有 owner 能指派角色」。"""
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    # 稽核 BE2a-12：每個欄位先驗證型別與長度（非字串原本會讓 .strip() 丟 500）
    email, err_resp = text_field(data, "email", "email", max_len=EMAIL_MAX)
    if err_resp:
        return err_resp
    name, err_resp = text_field(data, "name", "姓名", max_len=NAME_MAX)
    if err_resp:
        return err_resp
    identity, err_resp = text_field(data, "identity", "身分", max_len=IDENTITY_MAX, default="學生")
    if not err_resp and not identity:
        identity = "學生"  # 清空欄位送來空字串時，與沒帶一樣用預設
    if err_resp:
        return err_resp
    avatar_url, err_resp = text_field(data, "avatar_url", "大頭貼網址", max_len=AVATAR_URL_MAX)
    if err_resp:
        return err_resp
    password = data.get("password") or ""
    if not isinstance(password, str) or len(password) > PASSWORD_MAX:
        return JsonResponse({"detail": "密碼格式錯誤"}, status=400)
    role = data.get("role")

    if not email or not name:
        return JsonResponse({"detail": "email 與姓名為必填"}, status=400)
    if len(password) < 6:
        return JsonResponse({"detail": "密碼至少需要 6 個字元"}, status=400)
    if role is not None and role not in STAFF_ROLES:
        return JsonResponse({"detail": "無效的角色"}, status=400)
    if role is not None and decoded.get("role") != OWNER:
        return JsonResponse({"detail": "只有 owner 可以在建立帳號時指派角色"}, status=403)

    # 稽核 BE2a-04：先寫稽核紀錄再建立帳號（含要指派的角色）。這時還沒有 uid，target 先用遮罩後的 email；
    # 建立成功後另外記一筆帶 uid 的 create_user，失敗則補一筆 create_user_failed。
    pending_target = mask_email(email)
    _write_audit_log_first(
        request, decoded, "create_user_requested", pending_target, target_type="user",
        after={"email": mask_email(email), "name": name, "identity": identity, "role": role},
    )

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.create_firebase_user(email, password, display_name=name)
    except firebase_auth.EmailAlreadyExistsError:
        _mark_action_failed(request, decoded, "create_user", pending_target, reason="email_exists")
        return JsonResponse({"detail": "這個 email 已經被使用"}, status=400)
    except (ValueError, FirebaseError) as e:
        # 稽核 BE2a-13：例外原文只寫伺服器日誌，回給前端的是固定的中文訊息
        _mark_action_failed(request, decoded, "create_user", pending_target, reason="firebase_rejected")
        return JsonResponse({"detail": firebase_error_message(e)}, status=400)

    client = firebase_ops.get_firestore_client()
    try:
        client.collection("users").document(user_record.uid).set(
            _default_firestore_user_doc(email, name, identity, avatar_url)
        )
    except Exception:
        # Firestore 文件沒建成功的帳號能登入、但前台幾乎每個功能都會因為
        # users/{uid} 不存在而出錯——這種「半殘帳號」比完全沒建立更糟，
        # 寧可把剛剛建立的 Auth 帳號刪掉、讓整個操作乾淨失敗，也不要留著。
        logger.exception("建立使用者 %s 的 Firestore 文件失敗，嘗試 rollback Auth 帳號", mask_email(email))
        _mark_action_failed(request, decoded, "create_user", pending_target, reason="firestore_failed")
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
            _mark_action_failed(request, decoded, "create_user", user_record.uid, reason="role_assignment_failed")
            logger.exception(
                "建立使用者 %s 後指派角色 %s 失敗，帳號已建立但角色未設定，需至使用者詳情頁重新指派",
                user_record.uid, role,
            )

    _safe_write_audit_log(
        request, decoded, "create_user", user_record.uid, target_type="user",
        after={"email": mask_email(email), "name": name, "identity": identity, "role": role if role_assigned else None},
    )

    payload = _merge_user(user_record, {"name": name, "identity": identity, "avatarUrl": avatar_url})
    payload["role_assigned"] = role_assigned
    return JsonResponse(payload, status=201)


@csrf_exempt
@guarded_action(method="GET", role=STAFF_ROLES)
def user_detail(request, decoded, uid):
    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)

    client = firebase_ops.get_firestore_client()
    doc = client.collection("users").document(uid).get()
    firestore_data = doc.to_dict() if doc.exists else {}

    notes_count = _count_query(client.collection("sharedNotes").where("uid", "==", uid))
    recordings_count = _count_query(client.collection_group("recordings").where("uid", "==", uid))

    can_see_email = decoded.get("role") in ACCOUNT_MANAGERS
    payload = _merge_user(user_record, firestore_data, include_email=can_see_email)
    payload["provider_ids"] = [p.provider_id for p in (user_record.provider_data or [])]
    # 整份 users 文件裡有 email；不能管理帳號的角色拿掉它（稽核 FLW-6）
    payload["firestore"] = firestore_data if can_see_email else {
        key: value for key, value in firestore_data.items() if key != "email"
    }
    payload["content_counts"] = {
        "shared_notes": notes_count,
        "pronunciations": recordings_count,
    }
    return JsonResponse(payload)


@csrf_exempt
@guarded_action(method="POST", role=ROLE_ASSIGNERS, rate_limit=("user_role", "30/m"))
def user_role(request, decoded, uid):
    """僅 owner 可指派/收回角色（ROLE_ASSIGNERS 目前唯一的使用場景）。"""
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
    # 先寫稽核紀錄再動手（稽核 FLW-4）：寫不進去就中止，不會有「角色變了卻沒有紀錄」
    _write_audit_log_first(
        request, decoded, "assign_role", uid, target_type="user",
        before={"role": old_role}, after={"role": role},
    )
    try:
        firebase_ops.set_user_role(uid, role)
        firebase_ops.revoke_sessions(uid)
    except Exception:
        _mark_action_failed(request, decoded, "assign_role", uid, reason="firebase_error")
        raise
    return JsonResponse({"uid": uid, "role": role})


@csrf_exempt
@guarded_action(method="PATCH", role=ACCOUNT_MANAGERS, rate_limit=("user_profile", "30/m"))
def user_profile(request, decoded, uid):
    """編輯使用者基本資料——name／identity／avatar_url 是 Firestore
    users/{uid} 文件的欄位，email 選填、有帶才同步更新 Firebase Auth
    （前台註冊時兩邊各存一份，見 userServive.jsx 的 registerWithImg，
    這裡改了 Auth 這邊也要跟著改，不然兩邊會不一致）。partial update：
    body 裡沒帶到的欄位維持原值不動。"""
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_is_privileged(decoded, user_record)
    if forbidden_resp:
        return forbidden_resp

    client = firebase_ops.get_firestore_client()
    doc_ref = client.collection("users").document(uid)
    before_snapshot = doc_ref.get()
    before_data = before_snapshot.to_dict() if before_snapshot.exists else {}

    # 稽核 BE2a-12：型別與長度先驗證，非字串原本會讓 .strip() 丟 500
    firestore_updates = {}
    if "name" in data:
        name, err_resp = text_field(data, "name", "姓名", max_len=NAME_MAX)
        if err_resp:
            return err_resp
        if not name:
            return JsonResponse({"detail": "姓名不可為空"}, status=400)
        firestore_updates["name"] = name
    if "identity" in data:
        identity, err_resp = text_field(data, "identity", "身分", max_len=IDENTITY_MAX)
        if err_resp:
            return err_resp
        firestore_updates["identity"] = identity
    if "avatar_url" in data:
        avatar_url, err_resp = text_field(data, "avatar_url", "大頭貼網址", max_len=AVATAR_URL_MAX)
        if err_resp:
            return err_resp
        firestore_updates["avatarUrl"] = avatar_url

    original_email = user_record.email
    new_email = data.get("email")
    if new_email is not None:
        new_email, err_resp = text_field(data, "email", "email", max_len=EMAIL_MAX)
        if err_resp:
            return err_resp
        if not new_email:
            return JsonResponse({"detail": "email 不可為空"}, status=400)
    email_will_change = new_email is not None and new_email != user_record.email
    planned_updates = {**firestore_updates, **({"email": new_email} if email_will_change else {})}

    # 先寫稽核紀錄再動手（稽核 FLW-4）：改 email 等於能接管帳號，寫不進去就中止。
    # 動作本身失敗時，apply_changes 回傳錯誤回應，下面補一筆 update_profile_failed。
    if planned_updates:
        # 稽核 BE2a-03：只記錄這次實際要改的欄位（差異），不存整份使用者文件；email 遮罩
        _write_audit_log_first(
            request, decoded, "update_profile", uid, target_type="user",
            before={key: _audit_value(key, before_data.get(key)) for key in planned_updates},
            after={key: _audit_value(key, value) for key, value in planned_updates.items()},
        )

    def apply_changes():
        email_changed = False
        if email_will_change:
            try:
                firebase_ops.set_user_email(uid, new_email)
            except firebase_auth.EmailAlreadyExistsError:
                return JsonResponse({"detail": "這個 email 已經被使用"}, status=400)
            except (ValueError, FirebaseError) as e:
                return JsonResponse({"detail": firebase_error_message(e)}, status=400)
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
        return None

    try:
        failed_response = apply_changes()
    except Exception:
        if planned_updates:
            _mark_action_failed(request, decoded, "update_profile", uid, reason="exception")
        raise
    if failed_response is not None:
        if planned_updates:
            _mark_action_failed(
                request, decoded, "update_profile", uid, reason=f"http_{failed_response.status_code}",
            )
        return failed_response

    updated_record = firebase_ops.get_firebase_user(uid)
    updated_doc = doc_ref.get()
    payload = _merge_user(updated_record, updated_doc.to_dict() if updated_doc.exists else {})
    return JsonResponse(payload)


@csrf_exempt
@guarded_action(method="POST", role=ACCOUNT_MANAGERS, rate_limit=("user_password", "10/m"))
def user_password(request, decoded, uid):
    """管理員代使用者變更密碼——比停權/刪除更敏感（等於能無聲完整接管
    帳號登入身分），比照刪除帳號的確認強度，要求輸入目標帳號 email 逐字
    相符才會執行；成功後強制 revoke_sessions，被改密碼的人手上所有舊
    登入立刻失效（也是在提示使用者「有異常」的唯一訊號，因為我們不會
    寄信通知）。稽核紀錄故意不存新密碼本身，只記錄「密碼已變更」這個
    事實，避免明文密碼留在 AuditLog 裡。"""
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
    forbidden_resp = _forbidden_if_target_is_privileged(decoded, user_record)
    if forbidden_resp:
        return forbidden_resp

    confirm_email = (data.get("confirm_email") or "").strip()
    if not confirm_email or confirm_email != user_record.email:
        return JsonResponse({"detail": "輸入的 email 與目標帳號不符"}, status=400)

    # 先寫稽核紀錄再動手（稽核 FLW-4）；紀錄只有「要改密碼」這個事實，不含密碼本身
    _write_audit_log_first(
        request, decoded, "change_password", uid, target_type="user", after={"password_changed": True},
    )
    try:
        firebase_ops.set_user_password(uid, new_password)
    except Exception:
        _mark_action_failed(request, decoded, "change_password", uid, reason="firebase_error")
        raise
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
            request, decoded, "change_password_sessions_not_revoked", uid, target_type="user",
            after={"password_changed": True, "sessions_revoked": False},
        )
    return JsonResponse({"uid": uid, "password_changed": True, "sessions_revoked": sessions_revoked})


@csrf_exempt
def user_suspend(request, uid):
    return _set_suspended(request, uid, True)


@csrf_exempt
def user_unsuspend(request, uid):
    return _set_suspended(request, uid, False)


@guarded_action(method="POST", role=ACCOUNT_MANAGERS, rate_limit=("user_suspend", "30/m"))
def _set_suspended(request, decoded, uid, disabled):
    if disabled:
        forbidden_resp = _forbidden_if_self_target(decoded, uid, "停權")
        if forbidden_resp:
            return forbidden_resp

    from firebase_admin import auth as firebase_auth
    try:
        target_user = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_is_privileged(decoded, target_user)
    if forbidden_resp:
        return forbidden_resp
    if disabled:
        forbidden_resp = _forbidden_if_would_remove_last_owner(target_user, uid)
        if forbidden_resp:
            return forbidden_resp

    action = "suspend" if disabled else "unsuspend"
    _write_audit_log_first(
        request, decoded, action, uid, target_type="user",
        before={"disabled": not disabled}, after={"disabled": disabled},
    )
    try:
        firebase_ops.set_user_disabled(uid, disabled)
        firebase_ops.revoke_sessions(uid)
    except Exception:
        _mark_action_failed(request, decoded, action, uid, reason="firebase_error")
        raise
    return JsonResponse({"uid": uid, "disabled": disabled})


@csrf_exempt
@guarded_action(method="POST", role=ACCOUNT_MANAGERS, rate_limit=("user_force_logout", "30/m"))
def user_force_logout(request, decoded, uid):
    from firebase_admin import auth as firebase_auth
    try:
        target_user = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    forbidden_resp = _forbidden_if_target_outranks(decoded, target_user)
    if forbidden_resp:
        return forbidden_resp

    # 強制登出是防禦動作：稽核資料庫壞掉時不該連它一起擋，所以維持事後 best-effort 寫入（有測試保護這個決定）
    firebase_ops.revoke_sessions(uid)
    _safe_write_audit_log(request, decoded, "force_logout", uid, target_type="user")
    return JsonResponse({"uid": uid, "revoked": True})


def _django_side_summary(uid):
    """存在 Django 資料庫、無法直接以 uid 查得的資料：只能給出筆數（研究事件是假名、AI 回饋是單向雜湊）。"""
    summary = {}
    try:
        from config import quiz_research as QR
        from .models import QuizSkillEvent
        pseud = QR.pseudonym(uid)
        summary["quiz_research_events"] = (
            QuizSkillEvent.objects.filter(pseudonym=pseud).count() if pseud is not None else "未設定假名鹽，無法對應"
        )
    except Exception:
        logger.exception("統計使用者 %s 的研究事件筆數失敗", uid)
        summary["quiz_research_events"] = "統計失敗"
    try:
        from AIModel.feedback import hash_uid
        from .models import AiFeedback
        summary["ai_feedback"] = AiFeedback.objects.filter(uid_hash=hash_uid(uid)).count()
    except Exception:
        logger.exception("統計使用者 %s 的 AI 回饋筆數失敗", uid)
        summary["ai_feedback"] = "統計失敗"
    return summary


@csrf_exempt
@guarded_action(method="GET", role=ACCOUNT_MANAGERS, rate_limit=("user_export", "10/m", "GET"))
def user_export(request, decoded, uid):
    """個資匯出——把 Firebase Auth 記錄 + Firestore 使用者文件 + 該 uid 名下
    sharedNotes/pronunciations 全部文件包成一個 JSON 檔下載。匯出本身也是
    敏感動作，要寫稽核紀錄。"""
    from firebase_admin import auth as firebase_auth
    try:
        user_record = firebase_ops.get_firebase_user(uid)
    except firebase_auth.UserNotFoundError:
        return JsonResponse({"detail": "找不到這個使用者"}, status=404)
    # 匯出管理者帳號的個資跟接管類動作同等敏感，只有 owner 可以（稽核 FLW-3）；本人與一般使用者不受限
    forbidden_resp = _forbidden_if_target_is_privileged(decoded, user_record)
    if forbidden_resp:
        return forbidden_resp

    # 先寫稽核紀錄再讀資料（稽核 FLW-4）：個資一旦交出去就收不回來，紀錄寫不進去就不匯出
    _write_audit_log_first(request, decoded, "export_personal_data", uid, target_type="user")

    client = firebase_ops.get_firestore_client()
    doc = client.collection("users").document(uid).get()
    firestore_data = doc.to_dict() if doc.exists else None

    # 稽核 BE2a-02：與刪除帳號共用同一份位置清單（user_data_locations.LOCATIONS），匯出與刪除範圍一致
    exported = export_docs(client, uid)

    from AIModel import memory_store

    export_payload = {
        "auth": _merge_user(user_record, firestore_data or {}),
        "firestore_user_document": firestore_data,
        # 既有鍵名維持不變（前端與使用者習慣的格式）
        "shared_notes": exported.pop("shared_notes", []),
        "pronunciations": exported.pop("pronunciations", []),
        # 其餘位置（雲端筆記、行事曆、作答紀錄、學習統計、規則熟練度、檢舉…）
        "other_firestore_data": exported,
        "ai_learner_memory": {
            "consented": memory_store.has_consent(uid),
            "files": memory_store.list_files(uid),
        },
        "django_side": _django_side_summary(uid),
    }

    import json
    from django.core.serializers.json import DjangoJSONEncoder
    body = json.dumps(export_payload, ensure_ascii=False, indent=2, cls=DjangoJSONEncoder)
    response = HttpResponse(body, content_type="application/json; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="user_export_{uid}.json"'
    return response


def _delete_recordings(uid, recordings):
    """刪除錄音文件與對應的 Storage 音檔，回傳 {"deleted", "storage_cleanup_failed"}。"""
    deleted_count = 0
    storage_failed = 0
    for rec in recordings:
        rec_data = rec.to_dict() or {}
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
            expected_uid=uid,
        ):
            storage_failed += 1
            logger.warning("刪除帳號 %s 的錄音 %s 時，Storage 音檔清除失敗：%s", uid, rec.id, storage_url)
        rec.reference.delete()
        deleted_count += 1
    return {"deleted": deleted_count, "storage_cleanup_failed": storage_failed}


@csrf_exempt
@guarded_action(method="POST", role=ACCOUNT_MANAGERS, rate_limit=("user_delete", "10/m"))
def user_delete(request, decoded, uid):
    """刪除帳號——body 必填 confirm_email，逐字比對目標帳號真實 email 才會
    真的執行（P3 規劃的既有決策：後台必須輸入該帳號 email 才能刪）。

    Firestore／Storage／Firebase Auth 之間沒有跨系統交易，每一步各自
    try/except，回傳每一步的成功/失敗，讓管理者知道哪個環節沒刪乾淨需要
    人工複查，不假設「要嘛全成功要嘛全失敗」。"""
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
    forbidden_resp = _forbidden_if_target_is_privileged(decoded, user_record)
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
    # 稽核 BE2a-03：稽核紀錄是永久保存的，被刪帳號的個資不能留在裡面——只記 uid、角色與停權狀態，
    # 不存 email 與使用者文件內容；各集合刪了幾筆由結尾的 delete_account_result 記錄。
    before_snapshot = {
        "uid": user_record.uid,
        "role": (user_record.custom_claims or {}).get("role"),
        "disabled": user_record.disabled,
    }

    # 先寫稽核紀錄再動手（稽核 FLW-4）：刪除是不可逆的，寫不進去就中止。動作的結果（每一段刪了多少、
    # 哪一段失敗）要到最後才知道，另外在結尾補一筆 delete_account_result。
    _write_audit_log_first(
        request, decoded, "delete_account", uid, target_type="user",
        before=before_snapshot, after={"status": "started"},
    )

    results = {}

    # 稽核 BE2a-09：先停權並撤銷所有登入，確定這個帳號無法再登入、寫入新資料，才開始清資料；
    # 否則清到一半使用者還能重新登入，留下刪不掉的孤兒資料。停權失敗就整個中止（尚未刪任何東西）。
    # 之後 Auth 刪除失敗時，帳號也維持停權狀態，不會是「資料沒了但人還能登入」。
    try:
        firebase_ops.set_user_disabled(uid, True)
        firebase_ops.revoke_sessions(uid)
        results["suspended"] = {"disabled": True}
        results["sessions_revoked"] = {"revoked": True}
    except Exception:
        logger.exception("刪除帳號 %s 前停權／撤銷登入失敗，已中止刪除", uid)
        _mark_action_failed(request, decoded, "delete_account", uid, reason="suspend_failed")
        return JsonResponse({"detail": "無法先停用這個帳號，已中止刪除，沒有刪除任何資料（帳號可能已被停用），請稍後再試"}, status=502)

    # 稽核 BE2a-01：個人資料位置由 user_data_locations.LOCATIONS 統一列出（匯出與刪除共用）
    for location in LOCATIONS:
        try:
            docs = find_docs(client, uid, location)
            if location.kind == "group_query":
                results[location.key] = _delete_recordings(uid, docs)
            elif location.kind == "anonymize":
                for doc in docs:
                    doc.reference.update({location.field: DELETED_USER_PLACEHOLDER})
                results[location.key] = {"anonymized": len(docs)}
            else:
                for doc in docs:
                    doc.reference.delete()
                results[location.key] = {"deleted": len(docs)}
        except Exception:
            logger.exception("刪除帳號 %s 的「%s」失敗", uid, location.label)
            results[location.key] = {"deleted": 0, "error": "刪除失敗，需人工複查"}

    try:
        # AI 助手的學習記憶（路線圖 #21）存在 Django 資料庫，不在 Firestore：刪除記憶檔與同意紀錄。
        from AIModel import memory_store
        results["learner_memory"] = {"deleted": memory_store.revoke_consent(uid)}
    except Exception:
        logger.exception("刪除帳號 %s 的學習記憶失敗", uid)
        results["learner_memory"] = {"deleted": 0, "error": "刪除失敗，需人工複查"}

    try:
        # 經同意記錄的假名化研究事件：刪除帳號時一併清除，並把同意紀錄標記為已撤回。
        results["quiz_research"] = quiz_research_service.purge_user(uid)
    except Exception:
        logger.exception("刪除帳號 %s 的詞素學習研究事件失敗", uid)
        results["quiz_research"] = {"error": "刪除失敗，需人工複查"}

    try:
        if firestore_snapshot.exists:
            doc_ref.delete()
        results["firestore_user_document"] = {"deleted": True}
    except Exception:
        logger.exception("刪除帳號 %s 的 users 文件失敗", uid)
        results["firestore_user_document"] = {"deleted": False, "error": "刪除失敗，需人工複查"}

    # 任何一個資料位置刪除失敗時不刪 Auth 帳號（維持停權）：Auth 一刪，同一個端點就找不到人，
    # 殘留資料沒辦法再用它補刪；留著讓管理者重試
    partial_failure = any(isinstance(value, dict) and value.get("error") for value in results.values())
    try:
        if partial_failure:
            results["firebase_auth"] = {"deleted": False, "error": "部分資料刪除失敗，帳號維持停用，請重新執行刪除"}
        else:
            firebase_ops.delete_firebase_user(uid)
            results["firebase_auth"] = {"deleted": True}
    except Exception:
        logger.exception("刪除帳號 %s 的 Firebase Auth 記錄失敗", uid)
        results["firebase_auth"] = {"deleted": False, "error": "刪除失敗，需人工複查"}

    _safe_write_audit_log(
        request, decoded, "delete_account_result", uid, target_type="user",
        after=results,
    )
    return JsonResponse({"uid": uid, "results": results})
