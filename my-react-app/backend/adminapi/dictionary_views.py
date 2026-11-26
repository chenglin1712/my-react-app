"""P4 辭典管理：詞條 CRUD 的 Django 端點。

辭典資料活在 dictionary_db（SQLAlchemy 直連，見 dictionary_db/connect.py），
不是 Django ORM，所以這裡的送審/核准流程沒辦法沿用 quizbank_views.py 的
_make_content_views 或 revisions.py 的 make_revision_views——那兩者的核心
都是 Django model 的 select_for_update()／setattr()／full_clean()／save()，
對 SQLAlchemy session 沒有對應寫法。

架構（見規劃文件 P4 §1/§2）：草稿/送審狀態完全留在 Django 的
DictionaryRevision（見 models.py），辭典資料庫完全不知道「草稿」這個概念
存在——核准時才真的呼叫 dictionary_write.apply_word_tree() 寫入
dictionary_db，兩個資料庫之間沒有共用交易，套用 P3 已經驗證過的「主要
動作（辭典寫入）先完成，Django 端記帳／稽核／快取通知在後」精神。

核准流程「套用＋記帳」的邏輯（_APPLIERS／_finalize_approved_revision 等）
搬到 dictionary_revision_service.py（P4 review BE-16：Codex 建議這是 5 個
god view 裡風險最集中的一個，排在最後才拆，且刻意只搬移原本就已經是
獨立函式的部分，不重新設計 dictionary_revision_approve() 本身的例外處理
流程）。這裡只保留 HTTP 邊界的事：method 檢查、角色檢查、限流、request
參數解析、JsonResponse 包裝——這幾件事現在改用 _shared.guarded_action()
decorator（P4 review BE-27），dictionary_revision_approve() 這支風險最
集中的端點例外：它的核准流程本身（交易邊界、套用、重試、退回）維持完全
不動，只有最外層的 method／角色／限流檢查改用 decorator。
"""
import json
import logging

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from config.roles import CONTENT_APPROVERS, CONTENT_EDITORS, PUBLISHERS, STAFF_ROLES
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal, dictionary_write_session

from . import dictionary_write as dw
from ._shared import (
    guarded_action,
    invalid_transition as _invalid_transition,
    parse_json_body as _parse_json_body,
    stale_edit_response as _stale_edit_response,
    write_audit_log as _write_audit_log,
)
from .dictionary_revision_service import (
    _APPLIERS,
    _TREE_GETTERS,
    _finalize_approved_revision_with_retry,
    _revert_revision_to_pending_review,
    _revision_target_type,
)
# _CACHE_SCOPES 不在這個檔案裡直接用到（只有 dictionary_revision_service.py
# 的 _finalize_approved_revision() 需要），但
# reconcile_stuck_dictionary_revisions 管理指令原本就是
# `from adminapi.dictionary_views import _CACHE_SCOPES, ...`，這裡重新
# 匯入只是為了讓那個既有的匯入路徑不必更動。
from .dictionary_revision_service import _CACHE_SCOPES  # noqa: F401
from .dictionary_serializers import (
    ApproveDictionaryRevisionSerializer, DeleteProposalSerializer,
    validate_grammar_section_payload, validate_word_tree_payload,
)
from .models import DictionaryRevision
from .serializers import RejectSerializer
from .user_names import lookup_user_names

logger = logging.getLogger(__name__)

_TRIBE_ID_TO_SLUG = {t.id: t.slug for t in TRIBES}


def _tribe_slug_for(tribe_id):
    return _TRIBE_ID_TO_SLUG.get(tribe_id, "")


def _pending_revision_for(target_kind, target_id):
    return DictionaryRevision.objects.filter(
        target_kind=target_kind, target_id=target_id, status=DictionaryRevision.STATUS_PENDING_REVIEW,
    ).first()


def _open_revision_for(target_kind, target_id):
    """草稿或送審中的提案（同一個目標同時最多一筆，見 word_propose／word_delete_proposal 的 409）。
    稽核 FE7a-01：詳情頁只回 pending_review 的話，重新載入後看不見自己的草稿，再存檔就會無聲覆蓋。"""
    return DictionaryRevision.objects.filter(
        target_kind=target_kind, target_id=target_id,
        status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
    ).order_by("-updated_at").first()


def _pending_revision_summary(revision):
    if revision is None:
        return None
    return {
        "id": revision.pk, "status": revision.status, "operation": revision.operation,
        "submitted_by": revision.submitted_by,
        "submitted_at": revision.submitted_at.isoformat() if revision.submitted_at else None,
    }


def _open_revision_summary(revision):
    if revision is None:
        return None
    return {
        **_pending_revision_summary(revision),
        "created_by": revision.created_by,
        "updated_at": revision.updated_at.isoformat(),
    }


def _with_actor_names(body):
    """WP-8 追加：他人草稿／送審中提示原本只有 uid，看不出是誰。單筆詳情才附姓名
    （列表不附，避免每列都要查），一次批次查建立者與送審者；查不到或查詢失敗時為空字串，
    前端退回顯示 uid。"""
    if body is None:
        return None
    names = lookup_user_names([body.get("created_by") or "", body.get("submitted_by") or ""])
    body["created_by_name"] = names.get(body.get("created_by") or "", "")
    body["submitted_by_name"] = names.get(body.get("submitted_by") or "", "")
    return body


# 稽核 FE7a-07：「核准刪除時一併解除所有引用」會改動其他詞條的標註，只有 owner／admin 能提出
# （WP-8 追加：核准端點不再限制，reviewer 可核准，見 dictionary_revision_approve）
_UNLINK_ROLES = PUBLISHERS


def _unlink_forbidden_response(decoded, unlink_references):
    if unlink_references is True and decoded.get("role") not in _UNLINK_ROLES:
        return JsonResponse({
            "detail": "只有擁有者或管理員可以在刪除提案中一併解除引用",
            "errors": {"unlink_references": ["權限不足"]},
        }, status=403)
    return None


def _not_draft_owner_response(decoded, revision, *, allow_submitter=False):
    """稽核 WP-8 驗證：草稿是建立者自己的工作副本，別人不能改寫、捨棄或代為送審
    （owner／admin 例外，用來處理離職或卡住的草稿）。allow_submitter：撤回時，
    送審的人也可以撤回自己送出的提案。通過回傳 None。"""
    uid = decoded.get("uid", "anon")
    if decoded.get("role") in PUBLISHERS or revision.created_by == uid:
        return None
    if allow_submitter and revision.submitted_by and revision.submitted_by == uid:
        return None
    return JsonResponse({
        "detail": "這是其他人建立的草稿，只有建立者本人或擁有者／管理員可以操作",
        "code": "not_draft_owner",
    }, status=403)


def _pop_lock_data(data):
    """WP-8 追加：把 base_updated_at 從請求內容取出來（它不是提案內容，不能進內容驗證或存進 payload）。"""
    if isinstance(data, dict) and "base_updated_at" in data:
        return {"base_updated_at": data.pop("base_updated_at")}
    return {}


def _propose_overwrite_lock_response(decoded, existing, lock_data):
    """WP-8 追加：propose 寫入「既有草稿」時的樂觀鎖。

    owner／admin 可以透過 propose 覆寫別人的草稿（_not_draft_owner_response 放行），但 propose
    原本沒有任何版本比對：停在舊頁面（載入時還沒有這份草稿）的管理員一按儲存，就會無聲蓋掉
    建立者剛寫的內容。所以覆寫別人的草稿時必須帶 base_updated_at，且要與目前的 updated_at 相同；
    沒帶就回 409 edit_conflict，前端既有的衝突提示會請他重新載入、看到這份草稿後改走 PUT
    （PUT 對他人草稿一直有帶 base_updated_at）。

    覆寫自己的草稿維持原本行為、不要求帶；有帶的話一樣比對（同一人在兩個分頁各存一次的情況）。
    409 會附上 revision_id：走 propose 的頁面原本不知道有這份草稿，前端「載入最新內容」靠它找到要載入哪一筆。
    呼叫端必須已經 select_for_update 鎖住 existing。通過回傳 None。"""
    if existing.created_by != decoded.get("uid", "anon") and "base_updated_at" not in lock_data:
        return JsonResponse({
            "detail": "這個項目已經有一份其他人建立的草稿，請重新載入草稿、確認對方的內容後再編輯",
            "code": "edit_conflict",
            "errors": {"base_updated_at": ["覆寫其他人的草稿時必須帶上載入時的草稿版本"]},
            "revision_id": existing.pk,
        }, status=409)
    stale = _stale_edit_response(lock_data, existing.updated_at)
    if stale is not None and stale.status_code == 409:
        return JsonResponse({**json.loads(stale.content), "revision_id": existing.pk}, status=409)
    return stale


# ---------------------------------------------------------------------------
# 詞條列表／詳情
# ---------------------------------------------------------------------------

@csrf_exempt
def word_list(request):
    if request.method == "GET":
        return _word_list(request)
    if request.method == "POST":
        return _word_create_proposal(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="GET", role=STAFF_ROLES)
def _word_list(request, decoded):
    """扁平、伺服器端分頁的列表——本機約 3 萬筆詞條不可能一次全部載入
    （跟題庫類內容的小表不同），比照 word_data.py 的既有紀律：批次查詢，
    不要每列各自查一次。"""
    if request.GET.get("revisions") == "new":
        return _new_word_revision_list(request, decoded)
    tribe_id = request.GET.get("tribe_id", "")
    keyword = request.GET.get("keyword", "").strip()
    has_pending = request.GET.get("has_pending", "").lower() in ("1", "true")
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(100, max(1, int(request.GET.get("page_size", 20))))
    except ValueError:
        page_size = 20

    from dictionary_db import model as m

    # has_pending 篩選的資料源在 Django（DictionaryRevision），詞條本身在
    # dictionary_db（SQLAlchemy）——沒有辦法下一條跨資料庫的 SQL join，
    # 先在 Django 側查出符合的 word_id 清單，再拿去篩 SQLAlchemy 查詢。
    # 這批 id 數量以「目前待審中的提案數」為界，不是全部詞條，跟其他
    # list 端點「先在小的那邊過濾、再查大表」的務實作法一致。
    pending_word_ids = None
    if has_pending:
        pending_word_ids = list(
            DictionaryRevision.objects.filter(
                target_kind=DictionaryRevision.TARGET_WORD,
                status=DictionaryRevision.STATUS_PENDING_REVIEW,
            ).exclude(target_id="").values_list("target_id", flat=True)
        )
        if not pending_word_ids:
            return JsonResponse({"results": [], "count": 0, "page": page, "page_size": page_size})

    db = SessionLocal()
    try:
        query = db.query(m.Word)
        if tribe_id:
            query = query.filter(m.Word.tribe_id == tribe_id)
        if keyword:
            query = query.filter(m.Word.name.ilike(f"{keyword}%"))
        if pending_word_ids is not None:
            query = query.filter(m.Word.id.in_(pending_word_ids))
        query = query.order_by(m.Word.name, m.Word.id)

        total = query.count()
        start = (page - 1) * page_size
        words = query.offset(start).limit(page_size).all()
        word_ids = [w.id for w in words]

        explanation_counts = {}
        sentence_counts = {}
        anaphora_ref_counts = {}
        if word_ids:
            for word_id, count in (
                db.query(m.WordExplanation.word_id, m.WordExplanation.id)
                .filter(m.WordExplanation.word_id.in_(word_ids)).all()
            ):
                explanation_counts[word_id] = explanation_counts.get(word_id, 0) + 1

            sentence_rows = (
                db.query(m.Word.id, m.WordExplanationSentence.id)
                .join(m.WordExplanation, m.WordExplanation.word_id == m.Word.id)
                .join(m.WordExplanationSentence, m.WordExplanationSentence.explanation_id == m.WordExplanation.id)
                .filter(m.Word.id.in_(word_ids))
                .all()
            )
            for word_id, _sentence_id in sentence_rows:
                sentence_counts[word_id] = sentence_counts.get(word_id, 0) + 1

            for word_id, count in (
                db.query(m.WordExplanationAnaphoraItem.word_id, m.WordExplanationAnaphoraItem.id)
                .filter(m.WordExplanationAnaphoraItem.word_id.in_(word_ids)).all()
            ):
                anaphora_ref_counts[word_id] = anaphora_ref_counts.get(word_id, 0) + 1

        pending_by_id = {
            rev.target_id: rev for rev in
            DictionaryRevision.objects.filter(
                target_kind=DictionaryRevision.TARGET_WORD,
                target_id__in=word_ids, status=DictionaryRevision.STATUS_PENDING_REVIEW,
            )
        }

        results = [
            {
                "id": w.id, "tribe_id": w.tribe_id, "name": w.name, "dialect": w.dialect,
                "pinyin": w.pinyin, "frequency": w.frequency,
                "explanation_count": explanation_counts.get(w.id, 0),
                "sentence_count": sentence_counts.get(w.id, 0),
                "referenced_by_anaphora_items": anaphora_ref_counts.get(w.id, 0),
                "pending_revision": _pending_revision_summary(pending_by_id.get(w.id)),
            }
            for w in words
        ]
    finally:
        db.close()

    return JsonResponse({"results": results, "count": total, "page": page, "page_size": page_size})


_NEW_REVISION_LIST_LIMIT = 100


def _new_word_revision_list(request, decoded):
    """稽核 FE7a-02：新建詞條的提案沒有 word_id，詞條列表找不到它，離開頁面就回不去。
    這裡列出「自己的新建草稿」與「所有送審中的新建提案」（審核者要能開啟核准），
    別人的草稿仍不列出——草稿是提案者自己的工作副本（見 listWords 的說明）。"""
    from django.db.models import Q

    # kind=grammar_section：文法章節的新建提案一樣沒有章節 id，共用同一套查詢
    kind = request.GET.get("kind", DictionaryRevision.TARGET_WORD)
    if kind not in (DictionaryRevision.TARGET_WORD, DictionaryRevision.TARGET_GRAMMAR_SECTION):
        return JsonResponse({"detail": "請求參數錯誤", "errors": {"kind": ["不支援的類型"]}}, status=400)
    uid = decoded.get("uid", "anon")
    revisions = DictionaryRevision.objects.filter(
        Q(status=DictionaryRevision.STATUS_DRAFT, created_by=uid)
        | Q(status=DictionaryRevision.STATUS_PENDING_REVIEW),
        target_kind=kind,
        operation=DictionaryRevision.OPERATION_CREATE,
    ).order_by("-updated_at")[:_NEW_REVISION_LIST_LIMIT]
    results = [
        {
            **_open_revision_summary(rev),
            "title": rev.title_cache, "tribe": rev.tribe,
            "mine": rev.created_by == uid,
        }
        for rev in revisions
    ]
    return JsonResponse({"results": results})


@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("dictionary_word_create", "30/m"))
def _word_create_proposal(request, decoded):
    """新建詞條：不直接寫 dictionary_db，先建立一筆 operation=create 的
    草稿提案（target_id=''，核准時才指派真正的 UUID）。"""
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    cleaned, errors = validate_word_tree_payload(data)
    if errors:
        return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)

    with transaction.atomic():
        revision = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id="",
            tribe=_tribe_slug_for(cleaned.get("tribe_id", "")),
            operation=DictionaryRevision.OPERATION_CREATE,
            payload=cleaned, title_cache=cleaned.get("name", ""),
            status=DictionaryRevision.STATUS_DRAFT,
            created_by=decoded.get("uid", "anon"), submitted_by="",
        )
        _write_audit_log(
            request, decoded, "propose_create", str(revision.pk),
            after=cleaned, target_type="dictionary_word_revision",
        )
    return JsonResponse({
        "revision_id": revision.pk, "payload": revision.payload,
        "updated_at": revision.updated_at.isoformat(),
    }, status=201)


@csrf_exempt
@guarded_action(method="GET", role=STAFF_ROLES)
def word_detail(request, decoded, word_id):
    db = SessionLocal()
    try:
        try:
            tree = dw.get_word_tree(db, word_id)
        except dw.WordNotFoundError:
            return JsonResponse({"detail": "詞條不存在"}, status=404)
    finally:
        db.close()

    tree["meta"]["pending_revision"] = _pending_revision_summary(
        _pending_revision_for(DictionaryRevision.TARGET_WORD, word_id)
    )
    # 稽核 FE7a-01：pending_revision 維持原意（只有送審中），另外回傳含草稿的 open_revision 給編輯器載入
    tree["meta"]["open_revision"] = _with_actor_names(_open_revision_summary(
        _open_revision_for(DictionaryRevision.TARGET_WORD, word_id)
    ))
    return JsonResponse(tree)


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("dictionary_word_propose", "60/m"))
def word_propose(request, decoded, word_id):
    """對既有詞條建立/更新草稿提案——不動正在生效的辭典資料，比照
    PendingRevision 的既有精神。"""
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    base_hash = data.pop("base_hash", "") if isinstance(data, dict) else ""
    # WP-8 追加：base_updated_at 是覆寫既有草稿時的樂觀鎖，不是詞條內容（見 _propose_overwrite_lock_response）
    lock_data = _pop_lock_data(data)
    # 更新既有內容必須帶 base_hash（稽核 FLW-5）：它是核准時比對「有沒有人在你之後改過」的依據，
    # 省略等於關掉樂觀鎖。前端的編輯器一直都有帶（取自載入時的 content_hash）。
    if not isinstance(base_hash, str) or not base_hash.strip() or len(base_hash) > 71:
        return JsonResponse({
            "detail": "請求參數錯誤",
            "errors": {"base_hash": "更新時必須帶上載入時取得的 content_hash，請重新載入後再編輯"},
        }, status=400)
    cleaned, errors = validate_word_tree_payload(data)
    if errors:
        return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)

    db = SessionLocal()
    try:
        try:
            current_tree = dw.get_word_tree(db, word_id)
        except dw.WordNotFoundError:
            return JsonResponse({"detail": "詞條不存在"}, status=404)
    finally:
        db.close()
    # 稽核 BE2b-08：修改提案不能把詞條搬到別的族語
    if cleaned.get("tribe_id") != current_tree.get("tribe_id"):
        return JsonResponse({
            "detail": "請求參數錯誤", "errors": {"tribe_id": "不能變更詞條所屬的族語"},
        }, status=400)

    with transaction.atomic():
        # 稽核 BE2b-03：查詢與建立在同一個交易裡，並鎖住既有草稿，兩個請求不會各自建一筆
        existing = DictionaryRevision.objects.select_for_update().filter(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=word_id,
            status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
        ).first()
        if existing and existing.status == DictionaryRevision.STATUS_PENDING_REVIEW:
            return JsonResponse({"detail": "這個詞條已經有一筆待審核的提案，請先撤回或等待審核完成"}, status=409)
        if existing and existing.operation != DictionaryRevision.OPERATION_UPDATE:
            return JsonResponse({
                "detail": "這個詞條已經有一筆「刪除」草稿，請先丟棄或處理它再提出修改",
            }, status=409)
        if existing:
            # WP-8 追加：與 PUT 同規則——建立者本人或 owner／admin 可寫入既有草稿，其他人 403。
            # 「刪除」草稿在上面就已 409，不會被改寫成內容提案。
            not_owner = _not_draft_owner_response(decoded, existing)
            if not_owner:
                return not_owner
            stale = _propose_overwrite_lock_response(decoded, existing, lock_data)
            if stale:
                return stale
            existing.payload = cleaned
            existing.base_hash = base_hash
            existing.tribe = _tribe_slug_for(cleaned.get("tribe_id", ""))
            existing.title_cache = cleaned.get("name", "")
            existing.save(update_fields=["payload", "base_hash", "tribe", "title_cache", "updated_at"])
            revision = existing
            created = False
        else:
            revision = DictionaryRevision.objects.create(
                target_kind=DictionaryRevision.TARGET_WORD, target_id=word_id,
                tribe=_tribe_slug_for(cleaned.get("tribe_id", "")),
                operation=DictionaryRevision.OPERATION_UPDATE,
                payload=cleaned, base_hash=base_hash, title_cache=cleaned.get("name", ""),
                status=DictionaryRevision.STATUS_DRAFT,
                created_by=decoded.get("uid", "anon"), submitted_by="",
            )
            created = True

        _write_audit_log(
            request, decoded, "propose_update" if created else "update_proposal", word_id,
            after=cleaned, target_type="dictionary_word_revision",
        )
    return JsonResponse({
        "revision_id": revision.pk, "payload": revision.payload,
        "updated_at": revision.updated_at.isoformat(),
    }, status=201 if created else 200)


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("dictionary_word_delete_proposal", "30/m"))
def word_delete_proposal(request, decoded, word_id):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = DeleteProposalSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    forbidden = _unlink_forbidden_response(decoded, serializer.validated_data["unlink_references"])
    if forbidden:
        return forbidden

    db = SessionLocal()
    try:
        try:
            tree = dw.get_word_tree(db, word_id)
        except dw.WordNotFoundError:
            return JsonResponse({"detail": "詞條不存在"}, status=404)
    finally:
        db.close()

    existing = DictionaryRevision.objects.filter(
        target_kind=DictionaryRevision.TARGET_WORD, target_id=word_id,
        status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
    ).first()
    if existing:
        return JsonResponse({"detail": "這個詞條已經有一筆待處理的提案，請先撤回"}, status=409)

    with transaction.atomic():
        revision = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_WORD, target_id=word_id,
            tribe=_tribe_slug_for(tree.get("tribe_id", "")),
            operation=DictionaryRevision.OPERATION_DELETE,
            payload={"unlink_references": serializer.validated_data["unlink_references"]},
            base_hash=tree.get("content_hash", ""), title_cache=tree.get("name", ""),
            status=DictionaryRevision.STATUS_DRAFT,
            created_by=decoded.get("uid", "anon"), submitted_by="",
        )
        _write_audit_log(
            request, decoded, "propose_delete", word_id,
            before=tree, target_type="dictionary_word_revision",
        )
    return JsonResponse({
        "revision_id": revision.pk, "payload": revision.payload,
        "updated_at": revision.updated_at.isoformat(),
    }, status=201)


# ---------------------------------------------------------------------------
# 提案的送審流程（詞條與未來的文法章節共用，見 _APPLIERS）
# 實際的套用/記帳邏輯（_APPLIERS／_CACHE_SCOPES／_TREE_GETTERS／
# _finalize_approved_revision_with_retry 等）在 dictionary_revision_service.py
# ---------------------------------------------------------------------------

@csrf_exempt
def dictionary_revision_detail(request, pk):
    if request.method == "GET":
        return _revision_get(request, pk)
    if request.method == "PUT":
        return _revision_update_payload(request, pk)
    if request.method == "DELETE":
        return _revision_discard(request, pk)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="PUT", role=CONTENT_EDITORS, rate_limit=("dictionary_revision_update", "60/m"))
def _revision_update_payload(request, decoded, pk):
    """更新一筆草稿提案的內容——給「新建詞條」這種沒有既有 word_id 可以掛
    word_propose 的情境用（word_propose 是 /words/{word_id}/propose/，
    新建當下根本還沒有 word_id）。只能更新 draft 狀態的提案，跟
    word_propose／_revision_discard 一樣的限制：送審中的要先撤回才能改。
    """
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    # 稽核 FE7a-06：草稿 PUT 的樂觀鎖。base_updated_at 不是提案內容的一部分，先取出來，
    # 不然內容驗證會把它當成未知欄位（或存進 payload）。
    lock_data = {}
    if isinstance(data, dict) and "base_updated_at" in data:
        lock_data["base_updated_at"] = data.pop("base_updated_at")

    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_DRAFT:
            return _invalid_transition(revision.status, "update")
        not_owner = _not_draft_owner_response(decoded, revision)
        if not_owner:
            return not_owner
        stale = _stale_edit_response(lock_data, revision.updated_at)
        if stale:
            return stale

        if revision.operation == DictionaryRevision.OPERATION_DELETE:
            # 稽核 BE2b-13：刪除提案的內容只有 unlink_references，一樣要驗型別，不能存入任意 payload
            delete_serializer = DeleteProposalSerializer(data=data)
            if not delete_serializer.is_valid():
                return JsonResponse({"detail": "請求參數錯誤", "errors": delete_serializer.errors}, status=400)
            forbidden = _unlink_forbidden_response(decoded, delete_serializer.validated_data["unlink_references"])
            if forbidden:
                return forbidden
            cleaned = {"unlink_references": delete_serializer.validated_data["unlink_references"]}
        elif revision.target_kind == DictionaryRevision.TARGET_WORD:
            cleaned, errors = validate_word_tree_payload(data)
            if errors:
                return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)
            if revision.target_id:
                tribe_db = SessionLocal()
                try:
                    try:
                        current_tribe = dw.get_word_tree(tribe_db, revision.target_id).get("tribe_id")
                    except dw.WordNotFoundError:
                        current_tribe = None
                finally:
                    tribe_db.close()
                if current_tribe is not None and cleaned.get("tribe_id") != current_tribe:
                    return JsonResponse({
                        "detail": "請求參數錯誤", "errors": {"tribe_id": "不能變更詞條所屬的族語"},
                    }, status=400)
            revision.tribe = _tribe_slug_for(cleaned.get("tribe_id", ""))
            revision.title_cache = cleaned.get("name", "")
        elif revision.target_kind == DictionaryRevision.TARGET_GRAMMAR_SECTION:
            cleaned, errors = validate_grammar_section_payload(data)
            if errors:
                return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)
            revision.tribe = _tribe_slug_for(cleaned.get("tribe_id", ""))
            revision.title_cache = cleaned.get("title", "")
        else:
            cleaned = data

        revision.payload = cleaned
        revision.save(update_fields=["payload", "tribe", "title_cache", "updated_at"])
        _write_audit_log(
            request, decoded, "update_proposal", revision.target_id or f"revision:{pk}",
            after=cleaned, target_type=_revision_target_type(revision),
        )

    return JsonResponse({
        "id": revision.pk, "payload": revision.payload, "updated_at": revision.updated_at.isoformat(),
    })


@guarded_action(method="GET", role=STAFF_ROLES)
def _revision_get(request, decoded, pk):
    revision = get_object_or_404(DictionaryRevision, pk=pk)
    body = {
        "id": revision.pk, "target_kind": revision.target_kind, "target_id": revision.target_id,
        "operation": revision.operation, "status": revision.status, "payload": revision.payload,
        "base_hash": revision.base_hash, "tribe": revision.tribe,
        "title": revision.title_cache,
        "updated_at": revision.updated_at.isoformat(),
        "created_by": revision.created_by,
        "submitted_by": revision.submitted_by,
        "submitted_at": revision.submitted_at.isoformat() if revision.submitted_at else None,
        "review_comment": revision.review_comment,
        "apply_error": revision.apply_error,
    }
    _with_actor_names(body)
    # 稽核 FE7a-07：審核刪除提案時要看得到「核准後會解除幾筆引用」；以目前的引用數為準
    # （送出提案後引用數可能變動，核准時才是真正的解除範圍）。
    if (
        revision.target_kind == DictionaryRevision.TARGET_WORD
        and revision.operation == DictionaryRevision.OPERATION_DELETE
        and revision.target_id
    ):
        db = SessionLocal()
        try:
            body["reference_counts"] = dw.count_word_references(db, revision.target_id)
        finally:
            db.close()
    return JsonResponse(body)


@guarded_action(method="DELETE", role=CONTENT_EDITORS)
def _revision_discard(request, decoded, pk):
    """丟棄一筆草稿提案——只能丟棄還沒送審的（draft），送審中的要先撤回。"""
    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_DRAFT:
            return _invalid_transition(revision.status, "discard")
        not_owner = _not_draft_owner_response(decoded, revision)
        if not_owner:
            return not_owner
        _write_audit_log(
            request, decoded, "discard_proposal", revision.target_id or f"revision:{pk}",
            before=revision.payload, target_type=_revision_target_type(revision),
        )
        revision.delete()
    return JsonResponse({"detail": "已丟棄"})


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("dictionary_revision_submit", "60/m"))
def dictionary_revision_submit(request, decoded, pk):
    try:
        with transaction.atomic():
            revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
            if revision.status != DictionaryRevision.STATUS_DRAFT:
                return _invalid_transition(revision.status, "submit")
            not_owner = _not_draft_owner_response(decoded, revision)
            if not_owner:
                return not_owner
            revision.status = DictionaryRevision.STATUS_PENDING_REVIEW
            revision.submitted_by = decoded.get("uid", "anon")
            revision.submitted_at = timezone.now()
            revision.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])
            _write_audit_log(
                request, decoded, "submit_proposal", revision.target_id or f"revision:{pk}",
                target_type=_revision_target_type(revision),
            )
    except IntegrityError:
        # 稽核 BE2b-03：同一個目標已經有另一筆待審提案（部分唯一約束），回 409 而不是 500
        return JsonResponse({"detail": "這個項目已經有另一筆待審核的提案，請先處理它"}, status=409)
    return JsonResponse({"id": revision.pk, "status": revision.status, "updated_at": revision.updated_at.isoformat()})


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_EDITORS, rate_limit=("dictionary_revision_withdraw", "60/m"))
def dictionary_revision_withdraw(request, decoded, pk):
    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_PENDING_REVIEW:
            return _invalid_transition(revision.status, "withdraw")
        # 撤回會把提案退回草稿、讓它離開審核佇列；別的編輯者不該能把它撤掉
        # （否則可以藉撤回＋改寫繞過所有權）。建立者、送審者本人或 owner／admin 可以撤回。
        not_owner = _not_draft_owner_response(decoded, revision, allow_submitter=True)
        if not_owner:
            return not_owner
        revision.status = DictionaryRevision.STATUS_DRAFT
        revision.save(update_fields=["status", "updated_at"])
        _write_audit_log(
            request, decoded, "withdraw_proposal", revision.target_id or f"revision:{pk}",
            target_type=_revision_target_type(revision),
        )
    return JsonResponse({"id": revision.pk, "status": revision.status, "updated_at": revision.updated_at.isoformat()})


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_APPROVERS, rate_limit=("dictionary_revision_approve", "60/m"))
def dictionary_revision_approve(request, decoded, pk):
    """核准流程（見規劃文件 P4 §1 的跨系統一致性說明，加上 codex 獨立審查
    抓到的併發缺口修正）：

    (1) 在鎖定的 Django 交易內立刻把狀態從 pending_review「認領」成
        approved，關閉「兩個審核者同時核准同一筆提案」的競態窗口——第二個
        請求的 select_for_update() 會被第一個持有的鎖擋住，等第一個交易
        提交後才能繼續，這時候狀態已經不是 pending_review，會被狀態檢查
        擋下，兩邊都不會真的呼叫套用邏輯。
    (2) 辭典 DB 寫入並 commit（在認領交易之外，因為這是另一個資料庫的
        連線，沒辦法包進同一個 Django 交易；套用函式在拿到列鎖之後會重新
        比對 base_hash，見 dictionary_write.py 的 ConcurrentModificationError
        說明——這裡交易外的初次比對只是省一次不必要的鎖定寫入的快速路徑，
        不是正確性保證本身）。
    (3) 套用失敗（base_hash 過期或其他 DictionaryWriteError）時退回
        pending_review、記下 apply_error，讓審核者可以重新整理後再試一次，
        不會卡在一個「已認領但沒套用成功」的死狀態。
    (4) 套用成功才寫最終結果（target_id／applied_at）＋稽核紀錄＋快取失效
        通知，快取失效通知在交易區塊外（順序原因見規劃文件 P4 §1）。
    """
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = ApproveDictionaryRevisionSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_PENDING_REVIEW:
            return _invalid_transition(revision.status, "approve")
        # 稽核 BE1-03：審核者核准的是他看到的那一版提案內容，送審後被改過就擋（帶 base_updated_at 時比對）
        stale = _stale_edit_response(data, revision.updated_at)
        if stale:
            return stale
        # WP-8 追加（放寬 FE7a-07）：「一併解除引用」只限制提出者——建立刪除提案與 PUT 更新時
        # unlink_references=true 仍只有 owner／admin 能設定；核准是審核者的正常職責，reviewer
        # 也可以核准（審核畫面會明確顯示核准後會解除幾筆引用，見 _revision_get 的 reference_counts）。

        applier = _APPLIERS.get(revision.target_kind)
        if applier is None:
            return JsonResponse({"detail": f"不支援的內容類型：{revision.target_kind}"}, status=400)

        revision.status = DictionaryRevision.STATUS_APPROVED
        revision.reviewed_by = decoded.get("uid", "anon")
        revision.reviewed_at = timezone.now()
        revision.review_comment = serializer.validated_data["review_comment"]
        revision.apply_error = ""
        revision.save(update_fields=[
            "status", "reviewed_by", "reviewed_at", "review_comment", "apply_error", "updated_at",
        ])

    # 從這裡開始到套用成功之前，任何例外（不只是預期中的
    # ConcurrentModificationError／DictionaryWriteError）都必須讓提案退回
    # pending_review——revision 在上面那個交易裡已經認領成 approved，如果
    # 這段拋出沒被特別處理的例外（例如 tree_getter／applier 內部的非預期
    # SQLAlchemy 錯誤），沒有這層 except Exception 的話，提案會永久卡在
    # 「已核准但未套用」的死狀態，且完全沒有回報（獨立審查找到的問題）。
    try:
        # base_hash 快速路徑檢查：只在「這個提案有一個明確的既有目標」時做
        # （更新/刪除），新建（target_id 空字串）沒有「目前狀態」可比對。開
        # 草稿當下若沒有帶 base_hash，直接略過檢查——這個欄位是併發保護的
        # 加分項，不是必要條件；真正的正確性保證在套用函式拿到列鎖之後的
        # 重新比對。
        if revision.operation != DictionaryRevision.OPERATION_CREATE and revision.target_id and revision.base_hash:
            tree_getter = _TREE_GETTERS.get(revision.target_kind)
            read_db = SessionLocal()
            try:
                try:
                    current_tree = tree_getter(read_db, revision.target_id)
                    current_hash = current_tree["content_hash"]
                except dw.DictionaryWriteError:
                    current_hash = None
            finally:
                read_db.close()
            if current_hash != revision.base_hash:
                _revert_revision_to_pending_review(pk, "base_hash 快速路徑檢查失敗：內容已被其他人變更")
                return JsonResponse({
                    "detail": "這筆內容在你編輯的期間已經被其他人變更，請重新整理後再試一次",
                }, status=409)

        with dictionary_write_session() as write_db:
            result_id, result_payload = applier(write_db, revision)
    except dw.ConcurrentModificationError:
        _revert_revision_to_pending_review(pk, "套用時重新比對 base_hash 失敗：內容已被其他人變更")
        return JsonResponse({
            "detail": "這筆內容在你編輯的期間已經被其他人變更，請重新整理後再試一次",
        }, status=409)
    except dw.DictionaryWriteError as exc:
        _revert_revision_to_pending_review(pk, str(exc))
        return JsonResponse({"detail": str(exc)}, status=400)
    except Exception:
        logger.exception("辭典提案 #%s 核准套用時發生未預期例外", pk)
        _revert_revision_to_pending_review(pk, "套用時發生未預期錯誤")
        return JsonResponse({"detail": "套用失敗，已退回待審狀態，請稍後再試"}, status=500)

    # 到這裡，辭典 DB 的寫入已經真的 commit 了——內容已經生效。不管接下來
    # 記帳這步發生什麼事，都不能再把 revision 退回 pending_review：那樣
    # 下次核准會對同一個 target 重新套用一次，可能重複建立或跟已生效內容
    # 打架。finalize 函式本身是冪等的，這裡先做幾次短重試。
    try:
        revision = _finalize_approved_revision_with_retry(pk, result_id, result_payload, request, decoded)
    except Exception:
        # 重試過仍失敗：記下完整資訊讓值班人員能手動處理，或之後執行
        # reconcile_stuck_dictionary_revisions 管理指令補完成。狀態刻意
        # 維持在 approved + applied_at=NULL、不動它——這個組合本身就是
        # 「內容已生效但記帳沒寫完」的可掃描標記，管理指令靠它找出待補的
        # revision。
        logger.exception(
            "辭典提案 #%s 內容已套用成功（target_id=%s），但最終狀態記錄重試 3 次後仍然失敗，"
            "需要人工介入或執行 reconcile_stuck_dictionary_revisions 管理指令補完成。"
            "result_payload=%s",
            pk, result_id, json.dumps(result_payload, default=str, ensure_ascii=False),
        )
        return JsonResponse({
            "detail": "內容已套用成功，但後台狀態記錄發生問題，請稍後重新整理查看，不要重新核准；"
                      "如果狀態一直沒有更新請聯繫工程人員",
            "target_id": result_id,
        }, status=502)

    return JsonResponse({"id": revision.pk, "status": revision.status, "target_id": revision.target_id})


@csrf_exempt
@guarded_action(method="POST", role=CONTENT_APPROVERS, rate_limit=("dictionary_revision_reject", "60/m"))
def dictionary_revision_reject(request, decoded, pk):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = RejectSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_PENDING_REVIEW:
            return _invalid_transition(revision.status, "reject")
        revision.status = DictionaryRevision.STATUS_REJECTED
        revision.reviewed_by = decoded.get("uid", "anon")
        revision.reviewed_at = timezone.now()
        revision.review_comment = serializer.validated_data["review_comment"]
        revision.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment", "updated_at"])
        _write_audit_log(
            request, decoded, "reject_proposal", revision.target_id or f"revision:{pk}",
            after={"rejected_payload": revision.payload}, target_type=_revision_target_type(revision),
        )
    return JsonResponse({"id": revision.pk, "status": revision.status, "updated_at": revision.updated_at.isoformat()})


# ---------------------------------------------------------------------------
# 詞條刪除引用檢查（給前端在開啟刪除提案 Modal 前先查引用數用，不經送審）
# ---------------------------------------------------------------------------

@csrf_exempt
@guarded_action(method="GET", role=STAFF_ROLES)
def word_references(request, decoded, word_id):
    db = SessionLocal()
    try:
        counts = dw.count_word_references(db, word_id)
        sample = dw.sample_word_references(db, word_id) if counts["anaphora_items"] else []
    finally:
        db.close()
    return JsonResponse({"counts": counts, "sample": sample})
