"""P4 辭典管理：主檔（族語／分類／詞類／焦點／來源／詞綴）。

tribe（族語本身）刻意不提供任何寫入端點——5 筆的 UUID 寫死在
config/tribes.py 到處引用，且 tribe.name 本身就是 FastAPI 快取的 key，
比照既有 quiz_source_config_list 的決定（「族語清單本身由 config/tribes.py
固定，不是後台可以新增/刪除的東西」）。

其餘 5 張（source／category／part_of_speech／focus／grammar_affix）都可能
被引用，CRUD／合併邏輯集中在 dictionary_write.py（跟詞條 CRUD 共用同一個
「呼叫端負責交易邊界」的慣例），這裡只負責角色檢查／請求驗證／HTTP 轉譯。
建立/改名不經送審（跟詞條的 DictionaryRevision 流程不同）——這幾張是簡單
lookup 表，真正危險的操作是刪除／合併，各自有自己的引用防線與角色門檻
（合併限定 owner/admin，見規劃文件 P4 §4）。
"""
from sqlalchemy import func

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import ACCOUNT_MANAGERS, CONTENT_EDITORS, STAFF_ROLES
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal, dictionary_write_session

from . import dictionary_write as dw
from ._shared import (
    parse_json_body as _parse_json_body,
    rate_limited_response as _rate_limited_response,
    safe_write_audit_log as _safe_write_audit_log,
)
from .dictionary_cache import invalidate_dictionary_cache
from .dictionary_serializers import (
    GrammarAffixCreateSerializer, GrammarAffixUpdateSerializer,
    TaxonomyMergeSerializer, TaxonomyTermSerializer,
)

_WRITABLE_KINDS = ("source", "category", "part_of_speech", "focus", "grammar_affix")

_TAXONOMY_MODELS = {}  # 延遲 import dictionary_db.model，避免在 Django app 載入階段就建立 SQLAlchemy engine
_REFERENCE_JUNCTIONS = {}

_TRIBE_ID_TO_SLUG = {t.id: t.slug for t in TRIBES}


def _tribe_slug_for(tribe_id):
    return _TRIBE_ID_TO_SLUG.get(tribe_id, "")


def _taxonomy_models():
    if not _TAXONOMY_MODELS:
        from dictionary_db import model as m
        _TAXONOMY_MODELS.update({
            "source": m.Source, "category": m.Category,
            "part_of_speech": m.PartOfSpeech, "focus": m.Focus,
            "grammar_affix": m.GrammarAffix,
        })
    return _TAXONOMY_MODELS


def _reference_junctions():
    """kind -> (junction_model, fk_field_name)，只給列表端點算引用數用；
    合併/刪除實際邏輯的對應版本（含 parent_fk_name）在
    dictionary_write.taxonomy_reference_spec，兩邊各自維護一份小 dict
    是刻意的——這裡不需要 parent_fk_name，直接重用會多帶一個用不到的值。"""
    if not _REFERENCE_JUNCTIONS:
        from dictionary_db import model as m
        _REFERENCE_JUNCTIONS.update({
            "source": (m.WordSource, "source_id"),
            "category": (m.WordExplanationCategory, "category_id"),
            "part_of_speech": (m.WordExplanationPos, "pos_id"),
            "focus": (m.WordExplanationFocus, "focus_id"),
            "grammar_affix": (m.GrammarRuleAffix, "affix_id"),
        })
    return _REFERENCE_JUNCTIONS


def _serialize_taxonomy_row(kind, row, reference_count):
    if kind == "grammar_affix":
        return {
            "id": row.id, "tribe_id": row.tribe_id, "affix": row.affix,
            "affix_type": row.affix_type, "function": row.function or "",
            "example_form": row.example_form or "", "reference_count": reference_count,
        }
    return {"id": row.id, "name": row.name, "reference_count": reference_count}


@csrf_exempt
def taxonomy_list(request):
    """一次回傳全部主檔（族語 + 5 種可寫入的主檔，含各自的引用數），給前端
    做本地快取用——這幾張表都很小（source 8／category 149／part_of_speech
    26／focus 11／grammar_affix 88，族語固定 5 筆），沒有分頁的必要。"""
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    db = SessionLocal()
    try:
        result = {
            "tribes": [{"id": t.id, "slug": t.slug, "name": t.full_name} for t in TRIBES],
        }
        for kind, model in _taxonomy_models().items():
            junction_model, fk_field = _reference_junctions()[kind]
            counts = dict(
                db.query(getattr(junction_model, fk_field), func.count())
                .group_by(getattr(junction_model, fk_field)).all()
            )
            order_col = model.affix if kind == "grammar_affix" else model.name
            rows = db.query(model).order_by(order_col).all()
            result[kind] = [_serialize_taxonomy_row(kind, row, counts.get(row.id, 0)) for row in rows]
    finally:
        db.close()

    return JsonResponse(result)


@csrf_exempt
def taxonomy_item_list(request, kind):
    if kind not in _WRITABLE_KINDS:
        return JsonResponse({"detail": "不支援的主檔類型"}, status=404)
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return _taxonomy_create(request, kind)


@csrf_exempt
def taxonomy_item_detail(request, kind, pk):
    if kind not in _WRITABLE_KINDS:
        return JsonResponse({"detail": "不支援的主檔類型"}, status=404)
    if request.method == "PATCH":
        return _taxonomy_update(request, kind, pk)
    if request.method == "DELETE":
        return _taxonomy_delete(request, kind, pk)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
def taxonomy_item_merge(request, kind, pk):
    if kind not in _WRITABLE_KINDS:
        return JsonResponse({"detail": "不支援的主檔類型"}, status=404)
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    return _taxonomy_merge(request, kind, pk)


def _taxonomy_create(request, kind):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_taxonomy_write", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer_cls = GrammarAffixCreateSerializer if kind == "grammar_affix" else TaxonomyTermSerializer
    serializer = serializer_cls(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    try:
        with dictionary_write_session() as write_db:
            row = dw.create_taxonomy_term(write_db, kind, dict(serializer.validated_data))
            result = _serialize_taxonomy_row(kind, row, 0)
    except dw.DictionaryWriteError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    _safe_write_audit_log(
        request, decoded, "create_taxonomy_term", f"{kind}:{result['id']}",
        after=result, target_type="dictionary_taxonomy",
    )
    # 剛建立的主檔目前 0 引用，沒有任何已快取的詞條/文法資料用到它，
    # 不需要通知 FastAPI 清快取。
    return JsonResponse(result, status=201)


def _taxonomy_update(request, kind, pk):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_taxonomy_write", rate="30/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer_cls = GrammarAffixUpdateSerializer if kind == "grammar_affix" else TaxonomyTermSerializer
    serializer = serializer_cls(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    tribe_id_for_cache = None
    try:
        with dictionary_write_session() as write_db:
            row = dw.update_taxonomy_term(write_db, kind, pk, dict(serializer.validated_data))
            ref_count = dw.count_taxonomy_references(write_db, kind, pk)
            result = _serialize_taxonomy_row(kind, row, ref_count)
            if kind == "grammar_affix":
                tribe_id_for_cache = row.tribe_id
    except dw.TaxonomyNotFoundError:
        return JsonResponse({"detail": "主檔項目不存在"}, status=404)
    except dw.DictionaryWriteError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    _safe_write_audit_log(
        request, decoded, "update_taxonomy_term", f"{kind}:{pk}",
        after=result, target_type="dictionary_taxonomy",
    )

    if ref_count > 0:
        # 已經有詞條/規則引用這筆主檔，快取裡可能嵌著改名前的舊字串
        # （見 dictionary_db/word_data.py、grammar.py 的 _fetch_rule_affix_map
        # 都是直接把 name/affix 字串組進快取內容，不是存 id），需要失效。
        if kind == "grammar_affix":
            tribes = [_tribe_slug_for(tribe_id_for_cache)] if tribe_id_for_cache else None
            invalidate_dictionary_cache(["grammar", "grammar_affixes", "grammar_quiz"], tribes=tribes)
        else:
            invalidate_dictionary_cache(["words"], tribes=None)

    return JsonResponse(result)


def _taxonomy_delete(request, kind, pk):
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_taxonomy_write", rate="30/m")
    if limited_resp:
        return limited_resp

    try:
        with dictionary_write_session() as write_db:
            snapshot = dw.delete_taxonomy_term(write_db, kind, pk)
    except dw.TaxonomyNotFoundError:
        return JsonResponse({"detail": "主檔項目不存在"}, status=404)
    except dw.ReferencedError as exc:
        return JsonResponse({"detail": str(exc), "references": exc.counts}, status=409)

    _safe_write_audit_log(
        request, decoded, "delete_taxonomy_term", f"{kind}:{pk}",
        before=snapshot, target_type="dictionary_taxonomy",
    )
    # 刪除只有在引用數 0 時才會成功，代表沒有任何已快取的詞條/文法資料
    # 用到它，不需要通知快取失效。
    return JsonResponse({"detail": "已刪除"})


def _taxonomy_merge(request, kind, pk):
    decoded, err_resp = require_role(request, ACCOUNT_MANAGERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_taxonomy_merge", rate="20/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = TaxonomyMergeSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    target_id = serializer.validated_data["target_id"]

    try:
        with dictionary_write_session() as write_db:
            result = dw.merge_taxonomy_terms(write_db, kind, pk, target_id)
    except dw.TaxonomyNotFoundError as exc:
        return JsonResponse({"detail": str(exc)}, status=404)
    except dw.CrossTribeReferenceError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    except dw.DictionaryWriteError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)

    _safe_write_audit_log(
        request, decoded, "merge_taxonomy_term", f"{kind}:{pk}",
        before={"source_id": pk}, after=result, target_type="dictionary_taxonomy",
    )

    if kind == "grammar_affix":
        tribe_id = result.get("tribe_id")
        tribes = [_tribe_slug_for(tribe_id)] if tribe_id else None
        invalidate_dictionary_cache(["grammar", "grammar_affixes", "grammar_quiz"], tribes=tribes)
    else:
        invalidate_dictionary_cache(["words"], tribes=None)

    return JsonResponse(result)
