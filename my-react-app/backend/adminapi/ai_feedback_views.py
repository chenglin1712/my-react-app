"""後台「AI 回饋」頁的資料端點（路線圖 #30）：檢視學生對助手回覆的讚／倒讚，並把倒讚案例標成評測題組候選。

權限：只有 owner／admin（config.roles.FEEDBACK_VIEWERS）。內容含學生自己寫的問題與說明，可能有個資；
uid 只存單向雜湊，這裡只顯示雜湊的前 8 碼讓管理者看出「同一個人的幾則」，看不出是誰。
標成候選的案例會被 `run_ai_eval --include-feedback` 讀進評測題組（見 AIModel/evals/feedback_cases.py）。
"""
import math

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.roles import FEEDBACK_VIEWERS
from core.firebase_auth import require_role

from ._shared import parse_json_body, write_audit_log
from .models import AiFeedback
from .models.ai_feedback import REASONS, RATING_DOWN, RATING_UP

PAGE_SIZE = 20
TARGET_TYPE = "ai_feedback"


def _serialize(row: AiFeedback) -> dict:
    return {
        "id": row.pk,
        "createdAt": row.created_at.isoformat(),
        "rating": row.rating,
        "reason": row.reason,
        "comment": row.comment,
        "question": row.question_text,
        "reply": row.reply_text,
        "tribe": row.tribe,
        "model": row.model,
        "promptVersion": row.prompt_version,
        "requestId": row.request_id,
        "user": row.uid_hash[:8],
        "evalCandidate": row.eval_candidate,
        "evalNote": row.eval_note,
        "evalQuestion": row.eval_question,
    }


def _summary() -> dict:
    by_rating = dict(AiFeedback.objects.values_list("rating").annotate(n=Count("id")))
    by_reason = dict(
        AiFeedback.objects.filter(rating=RATING_DOWN).values_list("reason").annotate(n=Count("id")))
    return {
        "total": sum(by_rating.values()),
        "up": by_rating.get(RATING_UP, 0),
        "down": by_rating.get(RATING_DOWN, 0),
        "byReason": {reason: by_reason.get(reason, 0) for reason in (*REASONS, "")},
        "candidates": AiFeedback.objects.filter(eval_candidate=True).count(),
    }


@csrf_exempt
def ai_feedback_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, FEEDBACK_VIEWERS)
    if err_resp:
        return err_resp

    queryset = AiFeedback.objects.all()
    rating = request.GET.get("rating", "")
    if rating:
        if rating not in (RATING_UP, RATING_DOWN):
            return JsonResponse({"detail": "rating 只能是 up 或 down"}, status=400)
        queryset = queryset.filter(rating=rating)
    reason = request.GET.get("reason", "")
    if reason:
        if reason not in REASONS:
            return JsonResponse({"detail": "reason 不合法"}, status=400)
        queryset = queryset.filter(reason=reason)
    if request.GET.get("candidate") == "1":
        queryset = queryset.filter(eval_candidate=True)
    try:
        page = max(int(request.GET.get("page", "1")), 1)
    except ValueError:
        return JsonResponse({"detail": "page 必須是整數"}, status=400)

    total = queryset.count()
    pages = max(math.ceil(total / PAGE_SIZE), 1)
    page = min(page, pages)
    rows = queryset.order_by("-created_at", "-id")[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return JsonResponse({
        "summary": _summary(), "items": [_serialize(r) for r in rows],
        "page": page, "pages": pages, "pageSize": PAGE_SIZE, "count": total,
    })


@csrf_exempt
def ai_feedback_eval_candidate(request, pk):
    """把一則回饋標成（或取消）評測題組候選，可附一句說明（例如「正確答案應是…」）。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, FEEDBACK_VIEWERS)
    if err_resp:
        return err_resp
    body, err = parse_json_body(request)
    if err:
        return err
    candidate, note, question = body.get("candidate"), body.get("note", ""), body.get("question", "")
    if (not isinstance(candidate, bool) or not isinstance(note, str) or len(note) > 300
            or not isinstance(question, str) or len(question) > 300):
        return JsonResponse({"detail": "candidate 必須是布林值，note 與 question 必須是 300 字內的字串"}, status=400)
    if candidate and not question.strip():
        return JsonResponse({"detail": "加入評測題組要填「重播的問題」（請先去掉個資）"}, status=400)

    try:
        row = AiFeedback.objects.get(pk=pk)
    except AiFeedback.DoesNotExist:
        return JsonResponse({"detail": "找不到這則回饋"}, status=404)
    before = {"evalCandidate": row.eval_candidate, "evalNote": row.eval_note}
    row.eval_candidate, row.eval_note = candidate, note.strip() if candidate else ""
    row.eval_question = question.strip() if candidate else ""
    row.eval_marked_by = decoded.get("uid", "") if candidate else ""
    row.save(update_fields=["eval_candidate", "eval_note", "eval_question", "eval_marked_by", "updated_at"])
    write_audit_log(
        request, decoded, "ai_feedback_eval_mark", row, before=before,
        after={"evalCandidate": row.eval_candidate, "evalNote": row.eval_note}, target_type=TARGET_TYPE,
    )
    return JsonResponse(_serialize(row))
