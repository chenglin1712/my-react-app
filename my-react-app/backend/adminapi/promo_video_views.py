"""首頁宣傳影片的後台管理端點（S3-4，HOMEPAGE_CONTRACT.md 3.2 與 7）。

只有 owner、admin 能寫（與「首頁設定」同層級，直接影響公開首頁）；STAFF_ROLES 可讀。
路徑欄位、長度、檔案大小一律唯讀，只能由上傳端點以實際檔案檢測結果寫入。

鎖順序固定：先鎖 HomepageConfig 單例列，再鎖該筆 PromoVideo 列（與啟用端一致）。
被取代或刪除的舊檔不在請求內刪除，在同一個資料庫交易內登記為孤立（PromoMediaOrphan），
由 cleanup_promo_media 在 14 天後清掉。
"""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from config.roles import PUBLISHERS, STAFF_ROLES

from . import promo_upload as upload
from ._shared import (
    guarded_action,
    parse_json_body as _parse_json_body,
    write_audit_log as _write_audit_log,
)
from .models import HomepageConfig, PromoVideo
from .serializers import PromoVideoSerializer

TARGET_TYPE = "promo_video"
# 每位使用者 10 分鐘最多 6 次上傳（影片、封面、字幕各一次，加上幾次驗證失敗後重傳）。
# 單次最多 150MB，不能放太寬，否則單一帳號可以在短時間內塞滿暫存與磁碟。
UPLOAD_RATE = "6/10m"


def _audit(request, decoded, action, video, **kwargs):
    _write_audit_log(request, decoded, action, video, target_type=TARGET_TYPE, **kwargs)


def _data(video, active_id=None):
    if active_id is None:
        active_id = HomepageConfig.load().active_promo_video_id
    return PromoVideoSerializer(video, context={"active_id": active_id}).data


def _lock_config_then(pk):
    """固定的鎖順序：HomepageConfig 單例列 -> PromoVideo 列。回傳 (config, video)。"""
    HomepageConfig.load()
    config = HomepageConfig.objects.select_for_update().get(pk=1)
    video = get_object_or_404(PromoVideo.objects.select_for_update(), pk=pk)
    return config, video


def _error(exc):
    return JsonResponse({"detail": exc.message}, status=exc.status)


@csrf_exempt
def promo_video_list(request):
    if request.method == "GET":
        return _list(request)
    if request.method == "POST":
        return _create(request)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="GET", role=STAFF_ROLES)
def _list(request, decoded):
    active_id = HomepageConfig.load().active_promo_video_id
    items = list(PromoVideo.objects.all()[:200])
    results = [_data(v, active_id) for v in items]
    return JsonResponse({"results": results, "count": len(results), "active_promo_video": active_id})


@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("promo_video_create", "30/m"))
def _create(request, decoded):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    serializer = PromoVideoSerializer(data=data)
    if not serializer.is_valid():
        return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
    with transaction.atomic():
        video = serializer.save(created_by=decoded.get("uid", "anon"))
        _audit(request, decoded, "create", video, after=_data(video))
    return JsonResponse(_data(video), status=201)


@csrf_exempt
def promo_video_detail(request, pk):
    if request.method == "GET":
        return _get(request, pk)
    if request.method == "PATCH":
        return _update(request, pk)
    if request.method == "DELETE":
        return _delete(request, pk)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@guarded_action(method="GET", role=STAFF_ROLES)
def _get(request, decoded, pk):
    return JsonResponse(_data(get_object_or_404(PromoVideo, pk=pk)))


@guarded_action(method="PATCH", role=PUBLISHERS, rate_limit=("promo_video_update", "60/m"))
def _update(request, decoded, pk):
    data, err_resp = _parse_json_body(request)
    if err_resp:
        return err_resp
    with transaction.atomic():
        config, video = _lock_config_then(pk)
        before = _data(video, config.active_promo_video_id)
        serializer = PromoVideoSerializer(video, data=data, partial=True)
        if not serializer.is_valid():
            return JsonResponse({"detail": "請求參數錯誤", "errors": serializer.errors}, status=400)
        video = serializer.save()
        _audit(request, decoded, "update", video, before=before, after=_data(video, config.active_promo_video_id))
        return JsonResponse(_data(video, config.active_promo_video_id))


@guarded_action(method="DELETE", role=PUBLISHERS, rate_limit=("promo_video_delete", "30/m", "DELETE"))
def _delete(request, decoded, pk):
    with transaction.atomic():
        config, video = _lock_config_then(pk)
        # 刪除正在啟用的影片一律拒絕：要先把 active_promo_video 設為空（兩個動作各有稽核）
        if config.active_promo_video_id == video.pk:
            return JsonResponse({"detail": "這支影片正在首頁使用中，請先在首頁設定停用後再刪除。"}, status=409)
        before = _data(video, config.active_promo_video_id)
        paths = [video.video_path, video.cover_path, video.caption_path]
        _audit(request, decoded, "delete", video, before=before)
        video.delete()
        # 檔案不在請求內刪除；孤立紀錄與刪除在同一個交易，不會出現「已刪除但沒登記」
        upload.mark_orphans(paths)
    return JsonResponse({"detail": "已刪除。檔案會在 14 天後清除。"})


def _check_body_size(request, kind):
    """在解析 multipart 之前就依 Content-Length 拒絕過大的請求。"""
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length > upload.max_body_bytes(kind):
        raise upload.PromoUploadError(
            f"檔案太大了，上限是 {upload.KINDS[kind][1] // (1024 * 1024)}MB。", 413)


def _receive(request, kind):
    """檢查大小、取得檔案並串流寫入暫存目錄，回傳暫存路徑。"""
    _check_body_size(request, kind)
    uploaded = request.FILES.get("file")
    if uploaded is None:
        raise upload.PromoUploadError("沒有收到檔案，請重新選擇（欄位名稱是 file）。")
    return upload.stage_upload(uploaded, upload.KINDS[kind][1])


def _store(request, decoded, pk, kind, field, process):
    """上傳流程共用骨架：暫存 -> 驗證 -> 原子提交 -> 才寫資料庫。任何一步失敗，資料庫不變、暫存檔清掉。

    process(staged_path) 回傳 (要提交的檔案路徑, 副檔名, 額外要寫入的欄位 dict)。
    """
    get_object_or_404(PromoVideo, pk=pk)  # 沒有這筆紀錄就不用處理檔案
    staged = produced = None
    committed = None
    try:
        staged = _receive(request, kind)
        produced, ext, extra = process(staged)
        committed = upload.commit_staged(produced, kind, ext)
        produced = None  # 已被移走
        with transaction.atomic():
            config, video = _lock_config_then(pk)
            before = _data(video, config.active_promo_video_id)
            old_path = getattr(video, field)
            setattr(video, field, committed)
            for key, value in extra.items():
                setattr(video, key, value)
            try:
                video.full_clean(exclude=["created_by"])
            except ValidationError as exc:
                raise upload.PromoUploadError("檔案資訊未通過驗證：" + "；".join(
                    m for msgs in exc.message_dict.values() for m in msgs), 422)
            video.save()
            _audit(
                request, decoded, ("replace_" if old_path else "upload_") + kind, video,
                before=before, after=_data(video, config.active_promo_video_id),
            )
            upload.mark_orphans([old_path])
            result = _data(video, config.active_promo_video_id)
    except upload.PromoUploadError as exc:
        upload.remove_public_file(committed)
        return _error(exc)
    except BaseException:
        upload.remove_public_file(committed)
        raise
    finally:
        upload.discard(staged)
        upload.discard(produced)
    return JsonResponse(result)


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("promo_video_upload", UPLOAD_RATE))
def promo_video_upload_video(request, decoded, pk):
    def process(staged):
        duration, size = upload.validate_video(staged)
        return staged, "mp4", {"duration_seconds": duration, "size_bytes": size}

    return _store(request, decoded, pk, "video", "video_path", process)


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("promo_video_upload", UPLOAD_RATE))
def promo_video_upload_cover(request, decoded, pk):
    def process(staged):
        out, ext = upload.validate_and_reencode_cover(staged)
        return out, ext, {}

    return _store(request, decoded, pk, "cover", "cover_path", process)


@csrf_exempt
@guarded_action(method="POST", role=PUBLISHERS, rate_limit=("promo_video_upload", UPLOAD_RATE))
def promo_video_upload_caption(request, decoded, pk):
    def process(staged):
        out, ext = upload.validate_and_normalize_caption(staged)
        return out, ext, {}

    return _store(request, decoded, pk, "caption", "caption_path", process)


def _clear(request, decoded, pk, field, action):
    with transaction.atomic():
        config, video = _lock_config_then(pk)
        old_path = getattr(video, field)
        if not old_path:
            return JsonResponse({"detail": "目前沒有這個檔案。"}, status=409)
        before = _data(video, config.active_promo_video_id)
        setattr(video, field, "")
        video.save(update_fields=[field, "updated_at"])
        _audit(request, decoded, action, video, before=before, after=_data(video, config.active_promo_video_id))
        upload.mark_orphans([old_path])
        return JsonResponse(_data(video, config.active_promo_video_id))


@csrf_exempt
@guarded_action(method="DELETE", role=PUBLISHERS, rate_limit=("promo_video_clear", "30/m", "DELETE"))
def promo_video_clear_cover(request, decoded, pk):
    return _clear(request, decoded, pk, "cover_path", "delete_cover")


@csrf_exempt
@guarded_action(method="DELETE", role=PUBLISHERS, rate_limit=("promo_video_clear", "30/m", "DELETE"))
def promo_video_clear_caption(request, decoded, pk):
    return _clear(request, decoded, pk, "caption_path", "delete_caption")
