"""P4.3 辭典管理：文法章節（GrammarSection）的 Django 端點。

跟 dictionary_views.py 的詞條端點共用同一套送審流程（DictionaryRevision／
_APPLIERS／_TREE_GETTERS／_CACHE_SCOPES，見該檔案）——列表/詳情/建立提案/
更新提案/刪除提案的形狀完全比照 word_list/word_detail/word_propose/
word_delete_proposal，差別只在聚合單位換成「一個 grammar_section」而不是
「一個 word」。送審/撤回/核准/退件本身沒有另外重複實作，直接沿用
dictionary_views.py 的 dictionary_revision_submit/withdraw/approve/reject
（那幾支端點已經是 target_kind 泛用的）。

唯一不經送審、直接寫入 dictionary_db 的動作是章節排序——調整章節順序不
改變任何規則/例句內容，繞送審流程沒有安全效益（見規劃文件 P4 §3）。
"""
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from config.firebase_auth import require_role
from config.roles import CONTENT_EDITORS, STAFF_ROLES
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal, dictionary_write_session

from . import dictionary_write as dw
from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    safe_write_audit_log as _safe_write_audit_log,
    write_audit_log as _write_audit_log,
)
from .dictionary_cache import invalidate_dictionary_cache
from .dictionary_serializers import GrammarSectionReorderSerializer, validate_grammar_section_payload
from .models import DictionaryRevision

_TRIBE_ID_TO_SLUG = {t.id: t.slug for t in TRIBES}


def _tribe_slug_for(tribe_id):
    return _TRIBE_ID_TO_SLUG.get(tribe_id, "")


def _pending_revision_for(target_id):
    return DictionaryRevision.objects.filter(
        target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=target_id,
        status=DictionaryRevision.STATUS_PENDING_REVIEW,
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
# 章節列表／詳情
# ---------------------------------------------------------------------------

@csrf_exempt
def grammar_section_list(request):
    if request.method == "GET":
        return _grammar_section_list(request)
    if request.method == "POST":
        return _grammar_section_create_proposal(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _grammar_section_list(request):
    """扁平列表——每族語章節數約 9 個，全部族語合計不到 50，不需要伺服器端
    分頁，但一次只查一個族語（前端一次只會編輯一個族語的文法樹，跟其他
    族語的章節混在同一份清單沒有意義）。"""
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    tribe_id = request.GET.get("tribe_id", "")
    if not tribe_id:
        return JsonResponse({"detail": "tribe_id 為必填查詢參數"}, status=400)

    from dictionary_db import model as m

    db = SessionLocal()
    try:
        sections = (
            db.query(m.GrammarSection)
            .filter(m.GrammarSection.tribe_id == tribe_id)
            .order_by(m.GrammarSection.section_order)
            .all()
        )
        section_ids = [s.id for s in sections]

        rule_counts = {}
        if section_ids:
            for section_id, _rule_id in (
                db.query(m.GrammarRule.section_id, m.GrammarRule.id)
                .filter(m.GrammarRule.section_id.in_(section_ids)).all()
            ):
                rule_counts[section_id] = rule_counts.get(section_id, 0) + 1

        pending_by_id = {
            int(rev.target_id): rev for rev in
            DictionaryRevision.objects.filter(
                target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION,
                target_id__in=[str(sid) for sid in section_ids],
                status=DictionaryRevision.STATUS_PENDING_REVIEW,
            )
        }

        results = [
            {
                "id": s.id, "tribe_id": s.tribe_id, "section_key": s.section_key or "",
                "title": s.title or "", "section_order": s.section_order,
                "rule_count": rule_counts.get(s.id, 0),
                "pending_revision": _pending_revision_summary(pending_by_id.get(s.id)),
            }
            for s in sections
        ]
    finally:
        db.close()

    return JsonResponse({"results": results})


def _grammar_section_create_proposal(request):
    """新建章節：不直接寫 dictionary_db，先建立一筆 operation=create 的
    草稿提案（target_id=''，核准時才指派真正的 id），跟 word_create_proposal
    同一種精神。"""
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_grammar_create", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    cleaned, errors = validate_grammar_section_payload(data)
    if errors:
        return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)

    with transaction.atomic():
        revision = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id="",
            tribe=_tribe_slug_for(cleaned.get("tribe_id", "")),
            operation=DictionaryRevision.OPERATION_CREATE,
            payload=cleaned, title_cache=cleaned.get("title", ""),
            status=DictionaryRevision.STATUS_DRAFT,
            created_by=decoded.get("uid", "anon"), submitted_by="",
        )
        _write_audit_log(
            request, decoded, "propose_create", str(revision.pk),
            after=cleaned, target_type="dictionary_grammar_section_revision",
        )
    return JsonResponse({"revision_id": revision.pk, "payload": revision.payload}, status=201)


@csrf_exempt
def grammar_section_detail(request, section_id):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    db = SessionLocal()
    try:
        try:
            tree = dw.get_grammar_section_tree(db, section_id)
        except dw.GrammarSectionNotFoundError:
            return JsonResponse({"detail": "文法章節不存在"}, status=404)
    finally:
        db.close()

    tree["meta"]["pending_revision"] = _pending_revision_summary(
        _pending_revision_for(str(section_id))
    )
    return JsonResponse(tree)


@csrf_exempt
def grammar_section_propose(request, section_id):
    """對既有章節建立/更新草稿提案——不動正在生效的辭典資料，跟
    word_propose 同一種精神。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_grammar_propose", rate="60/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    base_hash = data.pop("base_hash", "") if isinstance(data, dict) else ""
    cleaned, errors = validate_grammar_section_payload(data)
    if errors:
        return JsonResponse({"detail": "請求參數錯誤", "errors": errors}, status=400)

    db = SessionLocal()
    try:
        try:
            dw.get_grammar_section_tree(db, section_id)
        except dw.GrammarSectionNotFoundError:
            return JsonResponse({"detail": "文法章節不存在"}, status=404)
    finally:
        db.close()

    target_id = str(section_id)
    existing = DictionaryRevision.objects.filter(
        target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=target_id,
        status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
    ).first()
    if existing and existing.status == DictionaryRevision.STATUS_PENDING_REVIEW:
        return JsonResponse({"detail": "這個章節已經有一筆待審核的提案，請先撤回或等待審核完成"}, status=409)

    with transaction.atomic():
        if existing:
            existing.payload = cleaned
            existing.base_hash = base_hash
            existing.tribe = _tribe_slug_for(cleaned.get("tribe_id", ""))
            existing.title_cache = cleaned.get("title", "")
            existing.save(update_fields=["payload", "base_hash", "tribe", "title_cache", "updated_at"])
            revision = existing
            created = False
        else:
            revision = DictionaryRevision.objects.create(
                target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=target_id,
                tribe=_tribe_slug_for(cleaned.get("tribe_id", "")),
                operation=DictionaryRevision.OPERATION_UPDATE,
                payload=cleaned, base_hash=base_hash, title_cache=cleaned.get("title", ""),
                status=DictionaryRevision.STATUS_DRAFT,
                created_by=decoded.get("uid", "anon"), submitted_by="",
            )
            created = True

        _write_audit_log(
            request, decoded, "propose_update" if created else "update_proposal", target_id,
            after=cleaned, target_type="dictionary_grammar_section_revision",
        )
    return JsonResponse({"revision_id": revision.pk, "payload": revision.payload}, status=201 if created else 200)


@csrf_exempt
def grammar_section_delete_proposal(request, section_id):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(
        request, decoded, group="dictionary_grammar_delete_proposal", rate="30/m",
    )
    if limited_resp:
        return limited_resp

    db = SessionLocal()
    try:
        try:
            tree = dw.get_grammar_section_tree(db, section_id)
        except dw.GrammarSectionNotFoundError:
            return JsonResponse({"detail": "文法章節不存在"}, status=404)
    finally:
        db.close()

    target_id = str(section_id)
    existing = DictionaryRevision.objects.filter(
        target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=target_id,
        status__in=[DictionaryRevision.STATUS_DRAFT, DictionaryRevision.STATUS_PENDING_REVIEW],
    ).first()
    if existing:
        return JsonResponse({"detail": "這個章節已經有一筆待處理的提案，請先撤回"}, status=409)

    with transaction.atomic():
        revision = DictionaryRevision.objects.create(
            target_kind=DictionaryRevision.TARGET_GRAMMAR_SECTION, target_id=target_id,
            tribe=_tribe_slug_for(tree.get("tribe_id", "")),
            operation=DictionaryRevision.OPERATION_DELETE,
            payload={}, base_hash=tree.get("content_hash", ""), title_cache=tree.get("title", ""),
            status=DictionaryRevision.STATUS_DRAFT,
            created_by=decoded.get("uid", "anon"), submitted_by="",
        )
        _write_audit_log(
            request, decoded, "propose_delete", target_id,
            before=tree, target_type="dictionary_grammar_section_revision",
        )
    return JsonResponse({"revision_id": revision.pk}, status=201)


# ---------------------------------------------------------------------------
# 章節排序（直接寫入，不經送審，見檔案開頭說明）
# ---------------------------------------------------------------------------

@csrf_exempt
def grammar_section_reorder(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_grammar_reorder", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = GrammarSectionReorderSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    tribe_id = serializer.validated_data["tribe_id"]
    section_ids = serializer.validated_data["section_ids"]

    try:
        with dictionary_write_session() as write_db:
            dw.reorder_grammar_sections(write_db, tribe_id, section_ids)
    except dw.DictionaryWriteError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    _safe_write_audit_log(
        request, decoded, "reorder_grammar_sections", tribe_id,
        after={"section_ids": section_ids}, target_type="dictionary_grammar_section",
    )
    invalidate_dictionary_cache(["grammar", "grammar_quiz"], tribes=[_tribe_slug_for(tribe_id)])
    return JsonResponse({"detail": "已更新排序"})
