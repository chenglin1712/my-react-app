"""P3.7 統一送審佇列：跨內容類型集中顯示待審項目。

純讀取聚合端點，不提供任何動作——核准/退件/核結仍然是各自原本的端點
（公告與 5 種題庫的 submit/approve/reject、PendingRevision 的
approve/reject、reports 的 resolve/dismiss）。這裡把三種不同資料源
（Django ORM 的新內容送審、PendingRevision 的已發布內容修改提案、
Firestore 的待處理檢舉）合併成一個依時間排序的清單，每筆帶一個 link
讓前端點擊直接跳到對應的既有管理頁面。
"""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import STAFF_ROLES

from . import firebase_ops
from .models import (
    Announcement, PendingRevision, QuizChoiceItem, QuizClozePassage,
    QuizSituationItem, QuizTrueFalseItem, QuizVocabItem,
)

REVIEW_TYPE_CHOICES = ("submission", "revision", "report")


def _iso(dt):
    return dt.isoformat() if dt else None


def _vocab_title(obj):
    return f"{obj.tribe}／{obj.foreign_word}"


def _cloze_title(obj):
    return (obj.passage_chinese or obj.passage_foreign)[:30]


def _situation_title(obj):
    return obj.scenario_chinese[:30]


def _question_title(obj):
    return obj.question_ab


# (target_type, model, 標題函式, 前端管理頁面路徑) ——PendingRevision 的
# target_type 存的字串跟這裡完全一致（見 quizbank_views.py 的
# _make_content_views 呼叫、views.py 的 Announcement 端點），可以直接共用
# 同一份對照表決定「這筆待審修改屬於哪個內容型別、原始內容長什麼樣子」。
_CONTENT_TYPES = [
    ("announcement", Announcement, lambda o: o.title, "/admin/content/announcements"),
    ("quiz_vocab_item", QuizVocabItem, _vocab_title, "/admin/quiz-bank/vocab"),
    ("quiz_cloze_passage", QuizClozePassage, _cloze_title, "/admin/quiz-bank/vocab?tab=cloze"),
    ("quiz_situation_item", QuizSituationItem, _situation_title, "/admin/quiz-bank/situations"),
    ("quiz_true_false_item", QuizTrueFalseItem, _question_title, "/admin/quiz-bank/true-false"),
    ("quiz_choice_item", QuizChoiceItem, _question_title, "/admin/quiz-bank/choice"),
]


def _collect_submissions():
    items = []
    for target_type, model, title_fn, link in _CONTENT_TYPES:
        for obj in model.objects.filter(status="pending_review"):
            items.append({
                "type": "submission",
                "content_type": target_type,
                "id": obj.pk,
                "title": title_fn(obj),
                "submitted_by": obj.submitted_by,
                "submitted_at": _iso(obj.submitted_at),
                "link": link,
            })
    return items


def _collect_revisions():
    content_type_map = {t: (m, f, l) for t, m, f, l in _CONTENT_TYPES}
    items = []
    for rev in PendingRevision.objects.filter(status=PendingRevision.STATUS_PENDING_REVIEW):
        model, title_fn, link = content_type_map.get(rev.target_type, (None, None, None))
        if model is None:
            # 未知的 target_type（理論上不會發生，PendingRevision 只由
            # make_revision_views 這條路徑建立，target_type 一定是上面列出的
            # 6 種之一）——防禦性略過而不是讓整個佇列因為一筆髒資料掛掉。
            continue
        try:
            obj = model.objects.get(pk=rev.target_id)
            title = title_fn(obj)
        except model.DoesNotExist:
            title = f"{rev.target_type}#{rev.target_id}（原始內容已刪除）"
        items.append({
            "type": "revision",
            "content_type": rev.target_type,
            "id": rev.target_id,
            "title": title,
            "submitted_by": rev.submitted_by,
            "submitted_at": _iso(rev.submitted_at),
            "link": link,
        })
    return items


def _collect_reports():
    client = firebase_ops.get_firestore_client()
    items = []
    for doc in client.collection("reports").where("status", "==", "pending").stream():
        data = doc.to_dict()
        items.append({
            "type": "report",
            "content_type": data.get("targetType"),
            "id": doc.id,
            "title": f"檢舉：{data.get('reason')}",
            "submitted_by": data.get("reporterUid"),
            "submitted_at": _iso(data.get("createdAt")),
            "link": "/admin/moderation/reports",
        })
    return items


@csrf_exempt
def review_queue_list(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    items = _collect_submissions() + _collect_revisions() + _collect_reports()

    type_param = request.GET.get("type")
    if type_param in REVIEW_TYPE_CHOICES:
        items = [item for item in items if item["type"] == type_param]

    items.sort(key=lambda item: item["submitted_at"] or "", reverse=True)

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
    page_items = items[start:start + page_size]

    return JsonResponse({
        "results": page_items,
        "count": total,
        "page": page,
        "page_size": page_size,
    })
