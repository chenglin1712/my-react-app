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
參數解析、JsonResponse 包裝。
"""
import json
import logging

from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import CONTENT_APPROVERS, CONTENT_EDITORS, STAFF_ROLES
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal, dictionary_write_session

from . import dictionary_write as dw
from ._shared import (
    invalid_transition as _invalid_transition,
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
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

logger = logging.getLogger(__name__)

_TRIBE_ID_TO_SLUG = {t.id: t.slug for t in TRIBES}


def _tribe_slug_for(tribe_id):
    return _TRIBE_ID_TO_SLUG.get(tribe_id, "")


def _pending_revision_for(target_kind, target_id):
    return DictionaryRevision.objects.filter(
        target_kind=target_kind, target_id=target_id, status=DictionaryRevision.STATUS_PENDING_REVIEW,
    ).first()


def _pending_revision_summary(revision):
    if revision is None:
        return None
    return {
        "id": revision.pk, "status": revision.status, "operation": revision.operation,
        "submitted_by": revision.submitted_by,
        "submitted_at": revision.submitted_at.isoformat() if revision.submitted_at else None,
    }


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


def _word_list(request):
    """扁平、伺服器端分頁的列表——本機約 3 萬筆詞條不可能一次全部載入
    （跟題庫類內容的小表不同），比照 word_data.py 的既有紀律：批次查詢，
    不要每列各自查一次。"""
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

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


def _word_create_proposal(request):
    """新建詞條：不直接寫 dictionary_db，先建立一筆 operation=create 的
    草稿提案（target_id=''，核准時才指派真正的 UUID）。"""
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_word_create", rate="30/m")
    if limited_resp:
        return limited_resp

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
    return JsonResponse({"revision_id": revision.pk, "payload": revision.payload}, status=201)


@csrf_exempt
def word_detail(request, word_id):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

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
    return JsonResponse(tree)


@csrf_exempt
def word_propose(request, word_id):
    """對既有詞條建立/更新草稿提案——不動正在生效的辭典資料，比照
    PendingRevision 的既有精神。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_word_propose", rate="60/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    base_hash = data.pop("base_hash", "") if isinstance(data, dict) else ""
    cleaned, errors = validate_word_tree_payload(data)
    if errors:
        return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)

    db = SessionLocal()
    try:
        try:
            dw.get_word_tree(db, word_id)
        except dw.WordNotFoundError:
            return JsonResponse({"detail": "詞條不存在"}, status=404)
    finally:
        db.close()

    existing = DictionaryRevision.objects.filter(
        target_kind=DictionaryRevision.TARGET_WORD, target_id=word_id,
        status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
    ).first()
    if existing and existing.status == DictionaryRevision.STATUS_PENDING_REVIEW:
        return JsonResponse({"detail": "這個詞條已經有一筆待審核的提案，請先撤回或等待審核完成"}, status=409)

    with transaction.atomic():
        if existing:
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
    return JsonResponse({"revision_id": revision.pk, "payload": revision.payload}, status=201 if created else 200)


@csrf_exempt
def word_delete_proposal(request, word_id):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_word_delete_proposal", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = DeleteProposalSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

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
    return JsonResponse({"revision_id": revision.pk}, status=201)


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


def _revision_update_payload(request, pk):
    """更新一筆草稿提案的內容——給「新建詞條」這種沒有既有 word_id 可以掛
    word_propose 的情境用（word_propose 是 /words/{word_id}/propose/，
    新建當下根本還沒有 word_id）。只能更新 draft 狀態的提案，跟
    word_propose／_revision_discard 一樣的限制：送審中的要先撤回才能改。
    """
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_revision_update", rate="60/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp

    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_DRAFT:
            return _invalid_transition(revision.status, "update")

        if revision.operation == DictionaryRevision.OPERATION_DELETE:
            cleaned = data
        elif revision.target_kind == DictionaryRevision.TARGET_WORD:
            cleaned, errors = validate_word_tree_payload(data)
            if errors:
                return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)
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

    return JsonResponse({"id": revision.pk, "payload": revision.payload})


def _revision_get(request, pk):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    revision = get_object_or_404(DictionaryRevision, pk=pk)
    return JsonResponse({
        "id": revision.pk, "target_kind": revision.target_kind, "target_id": revision.target_id,
        "operation": revision.operation, "status": revision.status, "payload": revision.payload,
        "base_hash": revision.base_hash, "tribe": revision.tribe,
        "submitted_by": revision.submitted_by,
        "submitted_at": revision.submitted_at.isoformat() if revision.submitted_at else None,
    })


def _revision_discard(request, pk):
    """丟棄一筆草稿提案——只能丟棄還沒送審的（draft），送審中的要先撤回。"""
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_DRAFT:
            return _invalid_transition(revision.status, "discard")
        _write_audit_log(
            request, decoded, "discard_proposal", revision.target_id or f"revision:{pk}",
            before=revision.payload, target_type=_revision_target_type(revision),
        )
        revision.delete()
    return JsonResponse({"detail": "已丟棄"})


@csrf_exempt
def dictionary_revision_submit(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_revision_submit")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_DRAFT:
            return _invalid_transition(revision.status, "submit")
        revision.status = DictionaryRevision.STATUS_PENDING_REVIEW
        revision.submitted_by = decoded.get("uid", "anon")
        revision.submitted_at = timezone.now()
        revision.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])
        _write_audit_log(
            request, decoded, "submit_proposal", revision.target_id or f"revision:{pk}",
            target_type=_revision_target_type(revision),
        )
    return JsonResponse({"id": revision.pk, "status": revision.status})


@csrf_exempt
def dictionary_revision_withdraw(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_revision_withdraw")
    if limited_resp:
        return limited_resp

    with transaction.atomic():
        revision = get_object_or_404(DictionaryRevision.objects.select_for_update(), pk=pk)
        if revision.status != DictionaryRevision.STATUS_PENDING_REVIEW:
            return _invalid_transition(revision.status, "withdraw")
        revision.status = DictionaryRevision.STATUS_DRAFT
        revision.save(update_fields=["status", "updated_at"])
        _write_audit_log(
            request, decoded, "withdraw_proposal", revision.target_id or f"revision:{pk}",
            target_type=_revision_target_type(revision),
        )
    return JsonResponse({"id": revision.pk, "status": revision.status})


@csrf_exempt
def dictionary_revision_approve(request, pk):
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
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_revision_approve")
    if limited_resp:
        return limited_resp

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
    # 打架。finalize 函式本身是幂等的，這裡先做幾次短重試。
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
def dictionary_revision_reject(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_revision_reject")
    if limited_resp:
        return limited_resp

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
    return JsonResponse({"id": revision.pk, "status": revision.status})


# ---------------------------------------------------------------------------
# 詞條刪除引用檢查（給前端在開啟刪除提案 Modal 前先查引用數用，不經送審）
# ---------------------------------------------------------------------------

@csrf_exempt
def word_references(request, word_id):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    db = SessionLocal()
    try:
        counts = dw.count_word_references(db, word_id)
        sample = dw.sample_word_references(db, word_id) if counts["anaphora_items"] else []
    finally:
        db.close()
    return JsonResponse({"counts": counts, "sample": sample})
