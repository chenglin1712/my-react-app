"""P4.4 辭典管理：批次匯入／匯出精靈的 Django 端點。

`DictionaryImportJob`（P4.0 已建立）是四步精靈之間的狀態載體：上傳
（結構檢查）→ 檢視解析結果（前端純顯示，不需要額外端點）→ 預檢報告
（真的查資料庫，`dictionary_import.resolve_import_bundle()`）→ 核准套用
（逐筆各自一個交易，見 `_apply_import_job` 說明）。整個匯入工作本身走
它自己的狀態機（`STATUS_UPLOADED → VALIDATED → PENDING_REVIEW →
APPLIED/APPLIED_WITH_ERRORS` 或 `REJECTED`），不是每筆詞條各自建一筆
`DictionaryRevision`（一次匯入 500 筆會直接洗版送審佇列）。
"""
import json
import logging
import uuid

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from core.firebase_auth import require_role
from config.roles import CONTENT_APPROVERS, CONTENT_EDITORS, OWNER, STAFF_ROLES
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
from .dictionary_import import (
    create_missing_taxonomies, export_tribe_bundle, import_report_hash, resolve_import_bundle,
)
from .dictionary_serializers import validate_import_bundle_structure
from .models import DictionaryImportJob
from .serializers import RejectSerializer

_TRIBE_SLUG_TO_ID = {t.slug: t.id for t in TRIBES}
_TRIBE_ID_TO_SLUG = {t.id: t.slug for t in TRIBES}

logger = logging.getLogger(__name__)


def _job_summary(job):
    return {
        "id": job.pk, "filename": job.filename, "tribe": job.tribe, "status": job.status,
        "new_count": job.new_count, "update_count": job.update_count,
        "error_count": job.error_count, "applied_count": job.applied_count, "failed_count": job.failed_count,
        "uploaded_by": job.uploaded_by, "uploaded_at": job.uploaded_at.isoformat() if job.uploaded_at else None,
        "reviewed_by": job.reviewed_by, "reviewed_at": job.reviewed_at.isoformat() if job.reviewed_at else None,
        "review_comment": job.review_comment,
        "applied_by": job.applied_by, "applied_at": job.applied_at.isoformat() if job.applied_at else None,
    }


def _job_detail(job):
    return {**_job_summary(job), "payload": job.payload, "report": job.report}


# ---------------------------------------------------------------------------
# 上傳／列表
# ---------------------------------------------------------------------------

@csrf_exempt
def import_job_list(request):
    if request.method == "GET":
        return _import_job_list(request)
    if request.method == "POST":
        return _import_job_upload(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


def _import_job_list(request):
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp

    tribe = request.GET.get("tribe", "")
    qs = DictionaryImportJob.objects.all()
    if tribe:
        qs = qs.filter(tribe=tribe)
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    page_size = 20
    total = qs.count()
    start = (page - 1) * page_size
    jobs = qs[start:start + page_size]

    return JsonResponse({
        "results": [_job_summary(job) for job in jobs],
        "count": total, "page": page, "page_size": page_size,
    })


def _import_job_upload(request):
    """步驟一「上傳」：只做結構檢查（schema/version/tribe/words 外層形狀 +
    逐筆詞條結構），不查資料庫——詞條層級的結構錯誤不會擋掉上傳本身，讓
    使用者在「檢視解析結果」步驟就能看到哪幾列有問題，不用重新上傳。"""
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_upload", rate="10/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    if not isinstance(data, dict):
        return JsonResponse({"detail": "請求格式錯誤"}, status=400)

    filename = data.get("filename", "")
    bundle = data.get("bundle")
    tribe_slug, words, row_errors = validate_import_bundle_structure(bundle)
    if tribe_slug is None:
        return JsonResponse({"detail": "請求參數錯誤", "errors": row_errors}, status=400)
    if tribe_slug not in _TRIBE_SLUG_TO_ID:
        return JsonResponse({"detail": f"不支援的族語：{tribe_slug}"}, status=400)

    with transaction.atomic():
        job = DictionaryImportJob.objects.create(
            filename=filename[:255], tribe=tribe_slug, payload=bundle,
            status=DictionaryImportJob.STATUS_UPLOADED, uploaded_by=decoded.get("uid", "anon"),
        )
        _write_audit_log(
            request, decoded, "upload_import_job", str(job.pk),
            after={"filename": filename, "tribe": tribe_slug, "word_count": len(words)},
            target_type="dictionary_import_job",
        )
    return JsonResponse({
        **_job_summary(job), "word_count": len(words), "row_errors": row_errors,
    }, status=201)


@csrf_exempt
def import_job_detail(request, pk):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    job = get_object_or_404(DictionaryImportJob, pk=pk)
    return JsonResponse(_job_detail(job))


# ---------------------------------------------------------------------------
# 預檢報告／自動建立缺漏主檔
# ---------------------------------------------------------------------------

@csrf_exempt
def import_job_preflight(request, pk):
    """步驟三「預檢報告」：真的查資料庫解析名稱、判斷新建/更新，結果存回
    job.report／preflight_hash，狀態轉成 VALIDATED。UPLOADED 或已經
    VALIDATED 過的工作都可以重新預檢（例如自動建立缺漏主檔之後）。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_preflight", rate="20/m")
    if limited_resp:
        return limited_resp

    job = get_object_or_404(DictionaryImportJob, pk=pk)
    if job.status not in (DictionaryImportJob.STATUS_UPLOADED, DictionaryImportJob.STATUS_VALIDATED):
        return JsonResponse({"detail": f"目前狀態「{job.status}」無法預檢"}, status=409)

    tribe_id = _TRIBE_SLUG_TO_ID[job.tribe]
    db = SessionLocal()
    try:
        report = resolve_import_bundle(db, tribe_id, job.payload.get("words", []))
    finally:
        db.close()

    job.report = report
    job.preflight_hash = import_report_hash(report)
    job.status = DictionaryImportJob.STATUS_VALIDATED
    job.new_count = report["new_count"]
    job.update_count = report["update_count"]
    job.error_count = report["error_count"]
    with transaction.atomic():
        job.save(update_fields=["report", "preflight_hash", "status", "new_count", "update_count", "error_count"])
        _write_audit_log(
            request, decoded, "preflight_import_job", str(job.pk),
            after={"new_count": job.new_count, "update_count": job.update_count, "error_count": job.error_count},
            target_type="dictionary_import_job",
        )
    return JsonResponse(_job_detail(job))


@csrf_exempt
def import_job_auto_create_taxonomies(request, pk):
    """owner-only：把這份 bundle 用到、但資料庫裡還沒有的分類/詞類/焦點/
    來源名稱建起來，然後立刻重新預檢一次（避免使用者忘記重新預檢、看到
    一份還是「找不到」的舊報告）。"""
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, (OWNER,))
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_autocreate", rate="10/m")
    if limited_resp:
        return limited_resp

    job = get_object_or_404(DictionaryImportJob, pk=pk)
    if job.status not in (DictionaryImportJob.STATUS_UPLOADED, DictionaryImportJob.STATUS_VALIDATED):
        return JsonResponse({"detail": f"目前狀態「{job.status}」無法自動建立主檔"}, status=409)

    tribe_id = _TRIBE_SLUG_TO_ID[job.tribe]
    with dictionary_write_session() as write_db:
        created = create_missing_taxonomies(write_db, job.payload.get("words", []))

    db = SessionLocal()
    try:
        report = resolve_import_bundle(db, tribe_id, job.payload.get("words", []))
    finally:
        db.close()

    job.report = report
    job.preflight_hash = import_report_hash(report)
    job.status = DictionaryImportJob.STATUS_VALIDATED
    job.new_count = report["new_count"]
    job.update_count = report["update_count"]
    job.error_count = report["error_count"]
    job.save(update_fields=["report", "preflight_hash", "status", "new_count", "update_count", "error_count"])

    # 分類/詞類/焦點/來源已經真的寫進 dictionary_db 並 commit 了——稽核紀錄
    # 寫入失敗不該讓呼叫端收到 500、誤以為這批主檔沒有建立成功（跟
    # dictionary_taxonomy_views.py 的 _taxonomy_create() 等函式同一種精神，
    # 這裡是 codex 獨立審查抓到的一個沒套用到位的疏漏）。
    _safe_write_audit_log(
        request, decoded, "auto_create_import_taxonomies", str(job.pk),
        after={"created": created}, target_type="dictionary_import_job",
    )
    return JsonResponse({**_job_detail(job), "created_taxonomies": created})


# ---------------------------------------------------------------------------
# 送審流程
# ---------------------------------------------------------------------------

@csrf_exempt
def import_job_submit(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_submit")
    if limited_resp:
        return limited_resp

    job = get_object_or_404(DictionaryImportJob, pk=pk)
    if job.status != DictionaryImportJob.STATUS_VALIDATED:
        return JsonResponse({"detail": f"目前狀態「{job.status}」無法送審，請先完成預檢"}, status=409)

    job.status = DictionaryImportJob.STATUS_PENDING_REVIEW
    with transaction.atomic():
        job.save(update_fields=["status"])
        _write_audit_log(request, decoded, "submit_import_job", str(job.pk), target_type="dictionary_import_job")
    return JsonResponse(_job_summary(job))


@csrf_exempt
def import_job_withdraw(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_EDITORS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_withdraw")
    if limited_resp:
        return limited_resp

    job = get_object_or_404(DictionaryImportJob, pk=pk)
    if job.status != DictionaryImportJob.STATUS_PENDING_REVIEW:
        return JsonResponse({"detail": f"目前狀態「{job.status}」無法撤回"}, status=409)

    job.status = DictionaryImportJob.STATUS_VALIDATED
    with transaction.atomic():
        job.save(update_fields=["status"])
        _write_audit_log(request, decoded, "withdraw_import_job", str(job.pk), target_type="dictionary_import_job")
    return JsonResponse(_job_summary(job))


def _revert_import_job_to_pending_review(pk):
    """核准流程「認領後才發現不能套用」時的退回動作——見
    import_job_approve() 的說明，跟 dictionary_views.py 的
    _revert_revision_to_pending_review() 是同一種手法。"""
    with transaction.atomic():
        job = DictionaryImportJob.objects.select_for_update().get(pk=pk)
        job.status = DictionaryImportJob.STATUS_PENDING_REVIEW
        job.save(update_fields=["status"])


# 批次匯入新建列的 deterministic id 用固定命名空間推導，同一個
# (job_id, row) 不管重跑幾次都會得到同一個 id——見 import_job_approve()
# 逐列 checkpoint 的說明：這是「同一列重跑會對回同一筆詞條，而不是每次
# 建一筆新的」這個保證的根本，沒有這個就無法安全續跑 create 列。
_IMPORT_ROW_ID_NAMESPACE = uuid.UUID("f2e6b9d0-9b1a-4b7a-9f3a-6c2f6f9a7d31")


def _deterministic_import_row_id(job_pk, row):
    return str(uuid.uuid5(_IMPORT_ROW_ID_NAMESPACE, f"dictionary-import-job:{job_pk}:row:{row}"))


@csrf_exempt
def import_job_approve(request, pk):
    """核准套用，分五步（BE-2 修正：新增「先標記處理中、逐列 checkpoint」，
    取代原本「先標終態、整個迴圈跑完才一次寫回」的做法——後者如果 process
    在迴圈中途被中斷，Django 端會停在一個外表看起來「已套用」、實際上只
    套用了一部分、而且無法透過這個端點重跑的死狀態）：

    (1) 在鎖定的 Django 交易內把工作狀態從 pending_review「認領」成
        applying（不是直接標成終態）——關閉「兩個審核者同時核准同一個
        匯入工作」的競態窗口，跟 dictionary_views.dictionary_revision_approve()
        同一種手法：第二個請求的 select_for_update() 會被第一個持有的鎖
        擋住，等第一個交易提交後才能繼續，這時狀態已經不是 pending_review，
        直接被擋下，不會真的重複套用整批。
    (2) 重新呼叫 resolve_import_bundle() 並比對雜湊（見
        dictionary_import.import_report_hash 的說明）——這份雜湊現在也
        包含每個更新目標「當下」的內容雜湊，不是只比對這份 bundle 自己的
        內容有沒有變；比對失敗就退回 pending_review。
    (3) 每一筆詞條各自開一個 dictionary_write_session()（見規劃文件 P4 §5
        「一筆詞條一個交易」）——Postgres 交易裡一旦有一筆出錯，同一個交易
        後續每一筆都會變成 current transaction is aborted，整批一個交易會
        導致「查出 3 個錯誤，0 筆成功套用，還得全部重跑」；逐筆交易讓錯誤
        互相隔離，呼應 crawler_sync.py「不應該讓已經成功匯入的其他筆全部
        回滾」的既有精神。除了 DictionaryWriteError（含 apply_word_tree
        在鎖定目標列之後重新比對 current_hash 失敗的 ConcurrentModificationError）
        之外，也攔截任何非預期例外（例如底層 SQLAlchemy/DBAPI 錯誤）避免
        單一列的意外中斷整個迴圈、讓後面的列完全沒有機會套用。每處理完
        一列立刻把結果 checkpoint 回 Django（report／applied_count／
        failed_count），不是等整個迴圈跑完才一次寫入——process 中途被
        中斷，Django 端至少留著「處理到第幾筆」的真實記錄。新建列用
        deterministic id（見 _deterministic_import_row_id()），同一列如果
        需要重跑會對回同一筆詞條，不會重複建立。
    (4) 迴圈跑完後才把 job 標成最終的 applied／applied_with_errors。
    (5) 稽核紀錄在套用迴圈跑完之後才寫——套用已經是真的發生了，稽核寫入
        失敗不能讓已完成的操作誤報失敗。

    已知限制（這是縮小範圍後的版本，不是完整的分散式安全方案）：如果
    process 剛好死在「某一列的 dictionary DB 已經 commit、但這一列的
    checkpoint 還沒寫回 Django」這個窄窗口內，job 會卡在 status=applying、
    且這一列在 report 裡沒有記錄。這個端點本身**不會**自動續跑卡住的
    工作（狀態不是 pending_review 一律擋下，避免兩個請求同時續跑同一個
    job 的併發風險）——需要用
    `python manage.py resume_stuck_dictionary_import <job_id>` 這支管理
    指令由人工確認後手動續跑；它會先用 dictionary DB 的實際內容核對每一
    列是否真的已經套用，不是盲目相信 report 裡記錄的內容。
    """
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_approve", rate="10/m")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    review_comment = (data or {}).get("review_comment", "") if isinstance(data, dict) else ""

    with transaction.atomic():
        job = get_object_or_404(DictionaryImportJob.objects.select_for_update(), pk=pk)
        if job.status != DictionaryImportJob.STATUS_PENDING_REVIEW:
            if job.status == DictionaryImportJob.STATUS_APPLYING:
                return JsonResponse({
                    "detail": "這個匯入工作目前是「套用中」狀態，可能仍在處理或先前已中斷；"
                              "請聯繫工程人員確認，必要時用復原指令手動續跑，不要重複點核准",
                }, status=409)
            return JsonResponse({"detail": f"目前狀態「{job.status}」無法核准"}, status=409)

        job.status = DictionaryImportJob.STATUS_APPLYING
        job.reviewed_by = decoded.get("uid", "anon")
        job.reviewed_at = timezone.now()
        job.review_comment = review_comment
        job.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment"])

    # 工作在上面那個交易裡已經認領成 applying——這裡重新解析 bundle 如果
    # 拋出非預期例外（不只是雜湊不符），沒有 except Exception 兜底的話，
    # 工作會永久卡在「已認領但未套用」的死狀態，且完全沒有回報（獨立審查
    # 找到的問題，跟 dictionary_views.dictionary_revision_approve() 是
    # 同一種缺口）。
    tribe_id = _TRIBE_SLUG_TO_ID[job.tribe]
    try:
        read_db = SessionLocal()
        try:
            fresh_report = resolve_import_bundle(read_db, tribe_id, job.payload.get("words", []))
        finally:
            read_db.close()
    except Exception:
        logger.exception("匯入工作 #%s 核准時重新解析 bundle 發生未預期例外", pk)
        _revert_import_job_to_pending_review(pk)
        return JsonResponse({"detail": "重新驗證失敗，已退回待審狀態，請稍後再試"}, status=500)

    if import_report_hash(fresh_report) != job.preflight_hash:
        _revert_import_job_to_pending_review(pk)
        return JsonResponse({
            "detail": "資料庫狀態自預檢後已經變化（可能有分類改名、其他人新建了同名詞條，"
                      "或目標詞條的內容被其他人異動），請重新預檢後再核准",
        }, status=409)

    applied_count = 0
    failed_count = 0
    outcomes = []
    for item in fresh_report["items"]:
        row = item["row"]
        if item["action"] == "error":
            outcome = {"row": row, "name": item["name"], "outcome": "skipped", "detail": item["errors"]}
        else:
            try:
                with dictionary_write_session() as write_db:
                    result_id = dw.apply_word_tree(
                        write_db, item["payload"], word_id=item["word_id"], expected_hash=item.get("current_hash"),
                        create_id=_deterministic_import_row_id(pk, row) if not item["word_id"] else None,
                    )
                applied_count += 1
                outcome = {"row": row, "name": item["name"], "outcome": "applied", "word_id": result_id}
            except dw.DictionaryWriteError as exc:
                failed_count += 1
                outcome = {"row": row, "name": item["name"], "outcome": "failed", "detail": str(exc)}
            except Exception:
                # 不是我們自己定義的 DictionaryWriteError——例如底層 SQLAlchemy/
                # DBAPI 例外。dictionary_write_session() 已經對這一筆的交易做了
                # rollback，不影響其他列；這裡只是不讓單一列的非預期例外中斷
                # 整個迴圈，也不把可能含內部細節的原始例外文字暴露出去。
                logger.exception("匯入套用第 %s 列時發生非預期例外", row)
                failed_count += 1
                outcome = {
                    "row": row, "name": item["name"], "outcome": "failed",
                    "detail": "套用時發生非預期錯誤，請查看伺服器日誌",
                }

        outcomes.append(outcome)
        # 逐列 checkpoint：每處理完一筆就立刻寫回 Django，而不是等整個
        # 迴圈跑完才一次寫入——見本函式 docstring 的說明。
        job.report = {**fresh_report, "outcomes": outcomes}
        job.applied_count = applied_count
        job.failed_count = failed_count
        job.save(update_fields=["report", "applied_count", "failed_count"])

    job.status = (
        DictionaryImportJob.STATUS_APPLIED
        if failed_count == 0 and fresh_report["error_count"] == 0
        else DictionaryImportJob.STATUS_APPLIED_WITH_ERRORS
    )
    job.applied_by = decoded.get("uid", "anon")
    job.applied_at = timezone.now()
    job.save(update_fields=["status", "applied_by", "applied_at"])

    _safe_write_audit_log(
        request, decoded, "approve_import_job", str(job.pk),
        after=json.loads(json.dumps({"applied_count": applied_count, "failed_count": failed_count}, default=str)),
        target_type="dictionary_import_job",
    )

    if applied_count > 0:
        invalidate_dictionary_cache(["words"], tribes=[job.tribe])

    return JsonResponse(_job_detail(job))


@csrf_exempt
def import_job_reject(request, pk):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, CONTENT_APPROVERS)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_import_reject")
    if limited_resp:
        return limited_resp

    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = RejectSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)

    job = get_object_or_404(DictionaryImportJob, pk=pk)
    if job.status != DictionaryImportJob.STATUS_PENDING_REVIEW:
        return JsonResponse({"detail": f"目前狀態「{job.status}」無法退件"}, status=409)

    job.status = DictionaryImportJob.STATUS_REJECTED
    job.reviewed_by = decoded.get("uid", "anon")
    job.reviewed_at = timezone.now()
    job.review_comment = serializer.validated_data["review_comment"]
    with transaction.atomic():
        job.save(update_fields=["status", "reviewed_by", "reviewed_at", "review_comment"])
        _write_audit_log(request, decoded, "reject_import_job", str(job.pk), target_type="dictionary_import_job")
    return JsonResponse(_job_summary(job))


# ---------------------------------------------------------------------------
# 匯出
# ---------------------------------------------------------------------------

@csrf_exempt
def dictionary_export(request):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    decoded, err_resp = require_role(request, STAFF_ROLES)
    if err_resp:
        return err_resp
    limited_resp = _rate_limited_response(request, decoded, group="dictionary_export", rate="10/m", method="GET")
    if limited_resp:
        return limited_resp

    tribe_slug = request.GET.get("tribe", "")
    if tribe_slug not in _TRIBE_SLUG_TO_ID:
        return JsonResponse({"detail": f"不支援的族語：{tribe_slug}"}, status=400)
    tribe_id = _TRIBE_SLUG_TO_ID[tribe_slug]

    db = SessionLocal()
    try:
        bundle = export_tribe_bundle(db, tribe_id, tribe_slug)
    finally:
        db.close()

    _safe_write_audit_log(
        request, decoded, "export_dictionary", tribe_slug,
        after={"word_count": len(bundle["words"])}, target_type="dictionary_import_job",
    )

    body = json.dumps(bundle, ensure_ascii=False, indent=2, cls=DjangoJSONEncoder)
    response = HttpResponse(body, content_type="application/json; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="dictionary_{tribe_slug}.json"'
    return response
