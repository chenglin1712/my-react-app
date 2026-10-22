"""後台「AI 助手設定」頁的資料端點（路線圖 #35、#28）：離題處理、開場白、建議問題、補充風格指示的版本化編輯、
回滾、試跑，以及內容審核事件檢視。

權限：只有 owner／admin（config.roles.FEEDBACK_VIEWERS）。每次儲存與回滾都新增一個版本並寫稽核紀錄，
舊版本從不修改。試跑只用草稿內容回答管理者自己輸入的問題，不寫資料庫、不影響學生看到的設定。
審核事件只含學生訊息開頭 120 字的摘錄與單向雜湊的使用者代號（見 models/ai_assistant.py）。
"""
import logging
import math

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from AIModel import assistant_settings, moderation
from AIModel.prompt_version import prompt_version
from config.llm import prompt_version_var
from config.roles import FEEDBACK_VIEWERS
from core.firebase_auth import require_role

from ._shared import parse_json_body, rate_limited_response, write_audit_log
from .models import AiAssistantSettingsVersion, AiModerationEvent
from .models.ai_assistant import INTENTS

logger = logging.getLogger(__name__)

TARGET_TYPE = "ai_assistant_settings"
VERSION_LIST_SIZE = 30
PAGE_SIZE = 20
TRIAL_MAX_MESSAGES = 3
TRIAL_MAX_LEN = 200
TRIAL_UID = "admin-trial"


def _serialize_version(row: AiAssistantSettingsVersion, active_id: int) -> dict:
    return {
        "id": row.pk, "createdAt": row.created_at.isoformat(), "createdBy": row.created_by[:8] if row.created_by else "",
        "note": row.note, "source": row.source, "content": row.content, "active": row.pk == active_id,
    }


def _limits() -> dict:
    return {
        "offTopicMessage": assistant_settings.MAX_OFF_TOPIC_MESSAGE, "greeting": assistant_settings.MAX_GREETING,
        "suggestion": assistant_settings.MAX_SUGGESTION, "chatExtra": assistant_settings.MAX_CHAT_EXTRA,
        "note": assistant_settings.NOTE_MAX,
    }


def _overview() -> dict:
    content, version = assistant_settings.active_with_version()
    rows = list(AiAssistantSettingsVersion.objects.order_by("-id")[:VERSION_LIST_SIZE])
    return {
        "activeVersion": version, "active": content, "defaults": assistant_settings.DEFAULTS,
        "promptVersion": prompt_version(), "limits": _limits(),
        "versions": [_serialize_version(r, version) for r in rows],
    }


@csrf_exempt
def ai_assistant_settings(request):
    """GET 目前設定與版本紀錄；POST 儲存成新版本（立即生效，本機 process 立刻、其他 worker 最久 30 秒）。"""
    if request.method not in ("GET", "POST"):
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, FEEDBACK_VIEWERS)
    if err_resp:
        return err_resp
    if request.method == "GET":
        return JsonResponse(_overview())

    body, err = parse_json_body(request)
    if err:
        return err
    note = body.get("note", "")
    if not isinstance(note, str):
        return JsonResponse({"detail": "備註必須是文字"}, status=400)
    before_content, before_version = assistant_settings.active_with_version()
    try:
        row = assistant_settings.save_version(
            body.get("content"), created_by=decoded.get("uid", ""), note=note,
        )
    except assistant_settings.SettingsError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    write_audit_log(
        request, decoded, "ai_assistant_settings_save", row, before={"version": before_version},
        after={"version": row.pk}, target_type=TARGET_TYPE,
    )
    return JsonResponse(_overview(), status=201)


@csrf_exempt
def ai_assistant_settings_rollback(request, pk):
    """回滾：把舊版本的內容再存成一個新版本（歷史不改寫，可以再回滾回來）。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, FEEDBACK_VIEWERS)
    if err_resp:
        return err_resp
    try:
        old = AiAssistantSettingsVersion.objects.get(pk=pk)
    except AiAssistantSettingsVersion.DoesNotExist:
        return JsonResponse({"detail": "找不到這個版本"}, status=404)
    _, before_version = assistant_settings.active_with_version()
    try:
        row = assistant_settings.save_version(
            old.content, created_by=decoded.get("uid", ""), note=f"回滾到 v{old.pk}", source=f"rollback:{old.pk}",
        )
    except assistant_settings.SettingsError as exc:
        # 舊版本在驗證規則改嚴之後可能不再合法：明講原因，不硬存
        return JsonResponse({"detail": f"這個版本現在不符合規則，無法回滾：{exc}"}, status=400)
    write_audit_log(
        request, decoded, "ai_assistant_settings_rollback", row, before={"version": before_version},
        after={"version": row.pk, "from": old.pk}, target_type=TARGET_TYPE,
    )
    return JsonResponse(_overview(), status=201)


@csrf_exempt
def ai_assistant_settings_trial(request):
    """用草稿設定回答管理者輸入的幾個問題（付費、每分鐘 3 次），讓管理者在儲存前看到實際效果。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, FEEDBACK_VIEWERS)
    if err_resp:
        return err_resp
    limited = rate_limited_response(request, decoded, group="ai_assistant_trial", rate="3/m")
    if limited:
        return limited
    body, err = parse_json_body(request)
    if err:
        return err
    messages = body.get("messages")
    if (not isinstance(messages, list) or not 1 <= len(messages) <= TRIAL_MAX_MESSAGES
            or any(not isinstance(m, str) or not m.strip() or len(m) > TRIAL_MAX_LEN for m in messages)):
        return JsonResponse(
            {"detail": f"請提供 1～{TRIAL_MAX_MESSAGES} 個問題，每個不超過 {TRIAL_MAX_LEN} 字"}, status=400)
    try:
        with assistant_settings.override(body.get("content")):
            draft_version = prompt_version()
            token = prompt_version_var.set(draft_version)
            try:
                replies = _run_trial([m.strip() for m in messages])
            finally:
                prompt_version_var.reset(token)
    except assistant_settings.SettingsError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    except EnvironmentError:
        return JsonResponse({"detail": "伺服器沒有設定 ANTHROPIC_API_KEY，無法試跑"}, status=503)
    return JsonResponse({"promptVersion": draft_version, "replies": replies})


def _run_trial(messages: list) -> list:
    from AIModel.services import run_tayal_chat
    from config.llm import get_llm_client

    client = get_llm_client()
    replies = []
    for text in messages:
        try:
            result = run_tayal_chat(client, "泰雅語", text, None, uid=TRIAL_UID, history=None, lookup=None, memory=False)
            replies.append({"question": text, "reply": result.get("message", ""), "refused": bool(result.get("refused"))})
        except Exception as exc:  # noqa: BLE001 - 一題失敗不要讓其他題的結果消失
            logger.warning("[adminapi] 助手設定試跑失敗：%s", type(exc).__name__)
            replies.append({"question": text, "reply": "", "error": "這一題呼叫模型失敗，請稍後再試"})
    return replies


def _moderation_summary() -> dict:
    by_intent = dict(AiModerationEvent.objects.values_list("intent").annotate(n=Count("id")))
    return {"total": sum(by_intent.values()), "byIntent": {i: by_intent.get(i, 0) for i in INTENTS}}


@csrf_exempt
def ai_moderation_list(request):
    """被攔下或引導的訊息（含大模型自己拒答的），供檢視誤攔與漏攔。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, FEEDBACK_VIEWERS)
    if err_resp:
        return err_resp
    moderation.purge_old()          # 沒有排程也不會無限累積：每次有人檢視就順手清掉過期的
    queryset = AiModerationEvent.objects.all()
    intent = request.GET.get("intent", "")
    if intent:
        if intent not in INTENTS:
            return JsonResponse({"detail": "intent 不合法"}, status=400)
        queryset = queryset.filter(intent=intent)
    try:
        page = max(int(request.GET.get("page", "1")), 1)
    except ValueError:
        return JsonResponse({"detail": "page 必須是整數"}, status=400)
    total = queryset.count()
    pages = max(math.ceil(total / PAGE_SIZE), 1)
    page = min(page, pages)
    rows = queryset.order_by("-created_at", "-id")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return JsonResponse({
        "summary": _moderation_summary(),
        "items": [{
            "id": r.pk, "createdAt": r.created_at.isoformat(), "intent": r.intent, "action": r.action,
            "excerpt": r.excerpt, "tribe": r.tribe, "user": r.uid_hash[:8],
        } for r in rows],
        "page": page, "pages": pages, "pageSize": PAGE_SIZE, "count": total,
    })
