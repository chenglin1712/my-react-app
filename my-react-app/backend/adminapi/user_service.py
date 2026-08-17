"""使用者管理的授權規則與資料整形，從 user_views.py 抽出來（P4 review
BE-16）：這裡的函式是「這個帳號管理動作該不該被允許」的業務規則（是否
對自己動手、是否會讓系統失去最後一位 owner、目標是不是位階更高的
owner…）跟「怎麼把 Firebase Auth record + Firestore 文件整理成 API
回應形狀」，都不直接處理 HTTP 方法檢查/限流這些請求解析層的事——那是
user_views.py 的事。guard 函式回傳 JsonResponse（而不是拋自訂例外）是
刻意維持跟原本 inline 時一致的形狀，views.py 呼叫端沿用同一套
`if forbidden_resp: return forbidden_resp` 寫法，不必重新設計錯誤傳遞
機制。"""
from datetime import datetime
from datetime import timezone as dt_timezone

from django.http import JsonResponse

from config.roles import OWNER

from . import firebase_ops


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


def _forbidden_if_self_target(decoded, uid, action_label):
    """降級／停權／刪除自己的帳號沒有任何正當使用情境，只有誤操作或誤點
    一種可能，而且後果可能是永久鎖死（尤其唯一 owner 誤降級自己，之後
    沒有人能再指派 owner）。直接擋在最前面，比後面的 last-owner 檢查更
    根本——不管系統還有幾位 owner，都不該允許對自己動這幾個動作。"""
    if uid == decoded.get("uid"):
        return JsonResponse({"detail": f"不能對自己的帳號執行「{action_label}」，請由其他管理者協助"}, status=403)
    return None


def _count_active_owners(exclude_uid=None):
    """目前有效（未停權）的 owner 人數。exclude_uid 用來回答「如果對這個人
    動手之後，系統還剩幾位 owner」。

    這是 read-then-write，不是資料庫交易——firebase_ops.list_all_firebase_users()
    只是即時拉取 Firebase Auth 全量使用者（跟使用者列表頁同一種既有做法，
    見本檔案開頭說明），沒有鎖，也沒有辦法鎖（Firebase Auth 不是我們自己的
    資料庫）。兩位 owner 同時各自對另一位動手的極端競態理論上仍可能同時
    通過檢查，這裡只做 best-effort 防呆，擋掉絕大多數的誤操作，不是強一致
    保證。"""
    count = 0
    for u in firebase_ops.list_all_firebase_users():
        if exclude_uid and u.uid == exclude_uid:
            continue
        if (u.custom_claims or {}).get("role") == OWNER and not u.disabled:
            count += 1
    return count


def _forbidden_if_would_remove_last_owner(target_user_record, uid):
    """只有「目標現在確實是有效 owner」才需要檢查；呼叫端負責先判斷這次
    操作是否真的會讓對方失去 owner 身分（例如 user_role 只在把 owner 改成
    別的角色時才呼叫這裡，改成同樣是 owner 或本來就不是 owner 都不需要）。"""
    target_role = (target_user_record.custom_claims or {}).get("role")
    if target_role != OWNER or target_user_record.disabled:
        return None
    if _count_active_owners(exclude_uid=uid) < 1:
        return JsonResponse({
            "detail": "系統目前只剩這一位 owner，無法對這個帳號執行此操作，請先指派另一位 owner 後再試",
        }, status=409)
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


def _default_firestore_user_doc(email, name, identity, avatar_url):
    """新帳號的 Firestore users/{uid} 文件初始形狀，逐欄位比照前台
    userServive.jsx 的 registerWithImg()——後台建立的帳號跟前台註冊出來的
    帳號要長得一模一樣，不能讓某些欄位（例如 favorites／user_errors）
    缺漏，否則這個使用者第一次用某些前台功能時會因為欄位不存在而出錯
    （initUserFields 雖然會補欄位，但那是要等使用者登入後才會跑一次，
    後台建立當下就該是完整的）。"""
    return {
        "name": name,
        "email": email,
        "identity": identity,
        "favorites": [
            {"id": 1, "title": "基礎詞彙", "content": []},
            {"id": 2, "title": "日常對話", "content": []},
            {"id": 3, "title": "旅遊用語", "content": []},
        ],
        "user_errors": {},
        "joinDate": datetime.now(dt_timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "avatarUrl": avatar_url or "",
    }
