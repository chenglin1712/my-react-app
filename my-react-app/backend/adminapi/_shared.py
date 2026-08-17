"""adminapi 內部共用、跟任何特定內容型別無關的小工具。

原本 _rate_limited_response／_ip_rate_limited_response／_parse_json_body／
_write_audit_log／_invalid_transition 定義在 views.py，quizbank_views.py
從那裡 import。新增的 revisions.py（已發布內容的編輯中修改）也需要同一批
工具，但 views.py 之後要反過來 import revisions.py 的函式給 Announcement
的端點用——views.py 依賴 revisions.py、revisions.py 又依賴 views.py 會
造成循環 import，所以把這批完全通用（不碰任何特定 model）的工具抽到這裡，
views.py／quizbank_views.py／revisions.py 三邊都改成從這裡 import，
views.py 保留原本的名稱重新 export，外部既有的 `from .views import X`
不用改。
"""
import functools
import json
import logging

from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited

from core.firebase_auth import require_role

from .models import AuditLog
from .rate_limits import get_configured_rate

logger = logging.getLogger(__name__)


def rate_limited_response(request, decoded, group, rate="60/m", method="POST"):
    """依已登入使用者的 uid 限速，邏輯與 AIModel/views.py、CrosswordPuzzle/views.py 一致。

    rate 參數現在只是「資料庫裡沒有這個 group 對應的 RateLimitRule 時」的
    退回值——見 rate_limits.get_configured_rate() 的說明，呼叫端不需要
    因為這次改動修改任何一個既有呼叫點。"""
    uid = decoded.get("uid", "anon")
    effective_rate = get_configured_rate(group, rate)
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: uid,
        rate=effective_rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


def ip_rate_limited_response(request, group, rate="60/m", method="GET"):
    """給匿名公開端點用（沒有登入者 uid 可綁），依 IP 限速。"""
    client_ip = request.META.get("REMOTE_ADDR", "unknown")
    effective_rate = get_configured_rate(group, rate)
    limited = is_ratelimited(
        request, group=group, key=lambda g, r: client_ip,
        rate=effective_rate, method=method, increment=True,
    )
    if limited:
        return JsonResponse({"detail": "請求過於頻繁，請稍後再試"}, status=429)
    return None


def parse_json_body(request):
    """回傳 (data, error_response)；格式錯誤回 400 而不是讓 JSONDecodeError
    一路往外拋變成 Django 預設的 500 HTML 頁（跟全站其他端點的慣例一致）。"""
    if not request.body:
        return {}, None
    try:
        return json.loads(request.body), None
    except json.JSONDecodeError:
        return None, JsonResponse({"detail": "請求格式錯誤"}, status=400)


def write_audit_log(request, decoded, action, target, before=None, after=None, target_type="announcement"):
    """target_type 預設 "announcement" 是為了不動到既有呼叫點——這個函式
    最早只給 Announcement 用，後來加入的資源呼叫時要記得自己帶對應的
    target_type，不然會被誤記成公告的稽核紀錄。

    target 通常是 Django model 實例（用 .pk 當 target_id），但 P3 的使用者
    管理／Firestore 內容審核動作沒有對應的 Django model——target_id 是
    Firebase uid 或 Firestore 文件 ID 這類字串。這裡改成沒有 .pk 屬性時
    直接把 target 本身當成 target_id，讓呼叫端可以傳一個 model 實例，
    也可以直接傳一個字串，不用為了寫稽核紀錄硬包一個假的 model 物件。"""
    target_id = target.pk if hasattr(target, "pk") else target
    AuditLog.objects.create(
        actor_uid=decoded.get("uid", "anon"),
        actor_role=decoded.get("role"),
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        before=before,
        after=after,
        ip_address=request.META.get("REMOTE_ADDR"),
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:1000] or None),
    )


def safe_write_audit_log(*args, **kwargs):
    """給 P3 這種「主要動作是呼叫 Firebase Admin SDK／Firestore，不是 Django
    ORM 寫入」的呼叫端用：Announcement／quizbank 那批端點把 write_audit_log
    包在 transaction.atomic() 裡，稽核紀錄寫入失敗時連同主要動作一起回滾，
    兩者要嘛一起成功要嘛一起失敗；但 Firebase 端的動作（停權、刪除帳號、
    刪除 Firestore 文件…）沒辦法參與 Django 的 transaction，一旦執行就是真的
    發生了，沒有回滾機制。這裡用同名但吞例外的版本：稽核紀錄寫入失敗只記錄
    下來讓 Sentry 能告警，不會讓「Firebase 動作已經成功」被回報成 500，
    誤導呼叫端以為操作完全沒有生效。刻意不修改 write_audit_log 本身——
    Announcement／quizbank 那邊依賴它會拋例外才能觸發交易回滾，不能改掉。"""
    try:
        write_audit_log(*args, **kwargs)
    except Exception:
        logger.exception("P3 稽核紀錄寫入失敗（主要操作已完成，不影響呼叫端回應結果）")


def guarded_action(method, role, rate_limit=None):
    """view function 開頭幾乎每次都重複的「method 檢查 → require_role →
    （可選）限流」三件事，抽成一個 decorator（P4 review BE-27：原本
    views.py／dictionary_views.py／quizbank_views.py／user_views.py／
    dictionary_import_views.py 每支單一動作的 view 都各自手寫這三行）。

    刻意只抽這三件完全機械化、逐字重複的檢查，不動 JSON 解析／serializer
    驗證／狀態轉移這些真正因內容型別而異的邏輯——那些留在各自的 view
    body 裡，不同內容類型的工作流程細節（哪些欄位可以改、狀態機轉換規則）
    本來就不該被一個通用框架吃掉（見 codex 對這個 BE-27 修正的建議：先做
    「這三件事」這種純粹重複的原子操作，不要一次跳到「approve/reject/
    withdraw 通用框架」那種更大的抽象——各內容類型在交易邊界/併發保護上
    的細節往往不一樣，勉強套同一個框架反而會抹平這些必要的差異）。

    method：這個 view 只接受的單一 HTTP method（多 method 分派的 view，
    例如 GET 走列表、POST 走建立，繼續維持原本「外層 dispatcher 函式 if
    request.method == ... 各自呼叫對應內層函式」的寫法，只在內層單一
    method 的函式套用這個 decorator）。
    role：傳給 require_role() 的角色集合。
    rate_limit：None 表示這個 view 不需要限流；否則傳
    (group, rate) 或 (group, rate, method) tuple，對應
    rate_limited_response() 的參數（method 預設 "POST"，GET 端點需要的話
    要自己傳 "GET"）。

    包好之後的 view 收到的第二個參數固定是 require_role() 解出來的
    decoded token（不是原本各自在函式內部才呼叫 require_role() 拿到的那個
    區域變數），其餘位置參數（例如 pk／uid／phase 這些 URL 帶的值）原封
    不動照樣傳進去。
    """
    def decorator(view_func):
        @functools.wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if request.method != method:
                return JsonResponse({"detail": "Method not allowed"}, status=405)
            decoded, err_resp = require_role(request, role)
            if err_resp:
                return err_resp
            if rate_limit is not None:
                group, rate, *rest = rate_limit
                limit_method = rest[0] if rest else "POST"
                limited_resp = rate_limited_response(request, decoded, group=group, rate=rate, method=limit_method)
                if limited_resp:
                    return limited_resp
            return view_func(request, decoded, *args, **kwargs)
        return wrapper
    return decorator


def invalid_transition(current_status, action):
    return JsonResponse(
        {"detail": f"目前狀態「{current_status}」無法執行「{action}」"},
        status=409,
    )
