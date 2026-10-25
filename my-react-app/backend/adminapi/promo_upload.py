"""首頁宣傳影片、封面、字幕的上傳處理（S3-4，HOMEPAGE_CONTRACT.md 3.2 與 7）。

流程固定為：串流寫入「不對外公開的暫存目錄」-> 實際驗證檔案內容（不只看副檔名與 MIME）->
原子重新命名到公開目錄 -> 呼叫端才寫資料庫。任何一步失敗都清掉暫存檔，資料庫不變。

檔名一律由系統產生（uuid4 的 32 位十六進位），不使用使用者提供的檔名；替換檔案就是新檔名，
所以公開檔案可以長期快取。被取代或刪除的舊檔不在請求內刪除，而是把修改時間設為「現在」
（touch_orphan），由 cleanup_promo_media 在 14 天後才清掉，大於快照保留期 7 天。
"""
import json
import logging
import os
import re
import shutil
import struct
import subprocess
import uuid

from django.conf import settings

from .models.content import MAX_PROMO_DURATION_SECONDS, MAX_PROMO_VIDEO_BYTES, PromoMediaOrphan

logger = logging.getLogger(__name__)

MAX_COVER_BYTES = 2 * 1024 * 1024
MAX_CAPTION_BYTES = 200 * 1024
MAX_COVER_SIDE = 4000
# 封面只收這兩種格式，Image.open(formats=) 會把解碼器鎖在這兩種
_COVER_FORMATS = ("JPEG", "WEBP")
MAX_VIDEO_WIDTH = 1920
MAX_VIDEO_HEIGHT = 4096
FFPROBE_TIMEOUT_SECONDS = 20
CHUNK_SIZE = 1024 * 1024
# ffprobe 處理的是不可信輸入：限制 CPU 時間與位址空間，不讓惡意檔案拖垮同容器的 gunicorn worker
FFPROBE_MAX_ADDRESS_SPACE = 1536 * 1024 * 1024
MIN_FREE_DISK_MARGIN = 1024 * 1024 * 1024
ORPHAN_RETENTION_DAYS = 14
STAGING_RETENTION_HOURS = 24

# 種類 -> (公開子目錄, 檔案大小上限)
KINDS = {
    "video": ("homepage/video", MAX_PROMO_VIDEO_BYTES),
    "cover": ("homepage/cover", MAX_COVER_BYTES),
    "caption": ("homepage/caption", MAX_CAPTION_BYTES),
}

# 請求本體的容許值：檔案上限加 1MB 的 multipart 開銷。超過就在解析之前直接拒絕。
BODY_OVERHEAD_BYTES = 1024 * 1024


class PromoUploadError(Exception):
    """可以直接回給管理者看的錯誤；message 是繁體中文且說明下一步該做什麼。"""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def max_body_bytes(kind):
    return KINDS[kind][1] + BODY_OVERHEAD_BYTES


def media_root():
    return os.path.realpath(str(settings.MEDIA_ROOT))


def staging_root():
    configured = getattr(settings, "MEDIA_STAGING_ROOT", None)
    return os.path.realpath(str(configured)) if configured else os.path.join(media_root(), "_staging")


def _human_mb(num_bytes):
    return f"{num_bytes / (1024 * 1024):.0f}MB" if num_bytes >= 1024 * 1024 else f"{num_bytes // 1024}KB"


# ---------------------------------------------------------------- 暫存


def ensure_free_disk(max_bytes):
    """磁碟剩餘空間不夠就先拒絕：上傳期間 nginx 暫存、Django 暫存目錄、最後的公開檔會同時占用空間。"""
    directory = staging_root()
    os.makedirs(directory, exist_ok=True)
    needed = 2 * max_bytes + MIN_FREE_DISK_MARGIN
    if shutil.disk_usage(directory).free < needed:
        logger.error("PROMO_MEDIA_DISK_LOW free=%s needed=%s", shutil.disk_usage(directory).free, needed)
        raise PromoUploadError("伺服器磁碟空間不足，暫時無法上傳，請聯絡系統管理者。", 507)


def stage_upload(uploaded_file, max_bytes):
    """串流寫入暫存目錄並限制大小，回傳暫存檔路徑。超過上限立刻中止並刪除。"""
    ensure_free_disk(max_bytes)
    directory = staging_root()
    path = os.path.join(directory, uuid.uuid4().hex + ".part")
    written = 0
    try:
        with open(path, "xb") as out:
            for chunk in uploaded_file.chunks(CHUNK_SIZE):
                written += len(chunk)
                if written > max_bytes:
                    raise PromoUploadError(f"檔案超過上限 {_human_mb(max_bytes)}，請壓縮後再上傳。", 413)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
    except BaseException:
        discard(path)
        raise
    if written == 0:
        discard(path)
        raise PromoUploadError("檔案是空的，請重新選擇檔案。")
    return path


def discard(path):
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        pass


# ---------------------------------------------------------------- 影片


def _read_top_level_boxes(path):
    """依序回傳 MP4 最外層 box 的 (型別, 起點)。結構不合法就丟 PromoUploadError。"""
    boxes = []
    file_size = os.path.getsize(path)
    with open(path, "rb") as f:
        offset = 0
        while offset < file_size:
            f.seek(offset)
            header = f.read(8)
            if len(header) < 8:
                raise PromoUploadError("影片檔結構不完整（檔案可能在傳輸中被截斷），請重新匯出後再上傳。")
            size, box_type = struct.unpack(">I4s", header)
            header_len = 8
            if size == 1:
                extended = f.read(8)
                if len(extended) < 8:
                    raise PromoUploadError("影片檔結構不完整，請重新匯出後再上傳。")
                size = struct.unpack(">Q", extended)[0]
                header_len = 16
            elif size == 0:
                size = file_size - offset  # 延伸到檔尾
            if size < header_len or offset + size > file_size:
                raise PromoUploadError("影片檔結構不完整（檔案可能在傳輸中被截斷），請重新匯出後再上傳。")
            boxes.append((box_type.decode("latin-1"), offset))
            offset += size
    return boxes


def check_faststart(path):
    """moov 必須在 mdat 之前，瀏覽器才能不下載整支就開始播放。"""
    boxes = _read_top_level_boxes(path)
    types = [t for t, _ in boxes]
    if "ftyp" not in types:
        raise PromoUploadError("這不是有效的 MP4 檔案（缺少檔頭），請確認匯出格式為 MP4。")
    if "moov" not in types or "mdat" not in types:
        raise PromoUploadError("影片檔結構不完整，請重新匯出後再上傳。")
    if types.index("moov") > types.index("mdat"):
        raise PromoUploadError(
            "影片需要先處理成「可快速開始播放」的格式，否則訪客得等整支下載完才會播放。"
            "請在電腦執行：ffmpeg -i 原檔.mp4 -c copy -movflags +faststart 新檔.mp4，再上傳新檔。"
        )


def _limit_resources():
    """在 ffprobe 子行程啟動前套用資源上限（只有 POSIX 有 resource 模組；Windows 開發機略過）。"""
    try:
        import resource
    except ImportError:
        return
    resource.setrlimit(resource.RLIMIT_CPU, (FFPROBE_TIMEOUT_SECONDS, FFPROBE_TIMEOUT_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (FFPROBE_MAX_ADDRESS_SPACE, FFPROBE_MAX_ADDRESS_SPACE))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))  # ffprobe 不該寫任何檔案


def _ffprobe_command(binary, path):
    # -protocol_whitelist file：只允許讀本機檔案，MP4 若夾帶指向 http、tcp 等的外部參照一律不跟隨
    return [binary, "-v", "error", "-protocol_whitelist", "file",
            "-print_format", "json", "-show_format", "-show_streams", "-i", path]


def _run_ffprobe(path):
    binary = getattr(settings, "FFPROBE_BIN", None) or "ffprobe"
    if shutil.which(binary) is None:
        raise PromoUploadError("伺服器尚未安裝 ffprobe，無法驗證影片，請聯絡系統管理者。", 503)
    kwargs = {"preexec_fn": _limit_resources} if os.name == "posix" else {}
    try:
        result = subprocess.run(
            _ffprobe_command(binary, path),
            capture_output=True, stdin=subprocess.DEVNULL, timeout=FFPROBE_TIMEOUT_SECONDS, check=False, **kwargs,
        )
    except subprocess.TimeoutExpired:
        raise PromoUploadError("影片檢查逾時，檔案可能已損毀，請重新匯出後再上傳。", 422)
    if result.returncode != 0:
        # ffprobe 的錯誤輸出可能含伺服器路徑與版本資訊：只寫進伺服器日誌，不回給使用者
        logger.warning("ffprobe failed rc=%s stderr=%s", result.returncode, result.stderr[:500].decode("utf-8", "replace"))
        raise PromoUploadError("無法讀取這個影片檔，檔案可能已損毀或不是 MP4，請重新匯出後再上傳。", 422)
    try:
        return json.loads(result.stdout.decode("utf-8", "replace"))
    except ValueError:
        raise PromoUploadError("無法讀取這個影片檔，請重新匯出後再上傳。", 422)


def analyze_probe(probe):
    """依 ffprobe 的輸出檢查規格，回傳 (duration_seconds, 摘要)。獨立成函式以便不靠真實檔案測試。"""
    fmt = probe.get("format") or {}
    streams = probe.get("streams") or []
    if "mp4" not in str(fmt.get("format_name", "")).split(","):
        raise PromoUploadError("影片容器必須是 MP4，請轉成 MP4（H.264 影像加 AAC 聲音）後再上傳。", 422)

    video = [s for s in streams if s.get("codec_type") == "video"
             and not (s.get("disposition") or {}).get("attached_pic")]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    # 只接受「一條影像加至多一條聲音」：字幕另外用 WebVTT 上傳，嵌入的字幕、資料、附件、內嵌封面一律拒絕
    extras = [s for s in streams if s not in video and s not in audio]
    if extras:
        raise PromoUploadError(
            "影片裡夾帶了額外的軌道（例如字幕、時間碼、內嵌封面圖），請只保留影像與聲音後再上傳："
            "ffmpeg -i 原檔.mp4 -map 0:v:0 -map 0:a:0? -c copy -movflags +faststart 新檔.mp4", 422)
    if len(video) != 1:
        raise PromoUploadError("影片必須剛好有一條影像軌，請重新匯出。", 422)
    if len(audio) > 1:
        raise PromoUploadError("影片最多只能有一條聲音軌，請重新匯出。", 422)

    v = video[0]
    if v.get("codec_name") != "h264":
        raise PromoUploadError(
            f"影像編碼必須是 H.264（目前是 {v.get('codec_name') or '未知'}），"
            "請用 ffmpeg -i 原檔 -c:v libx264 -c:a aac 新檔.mp4 轉檔後再上傳。", 422)
    if v.get("pix_fmt") not in ("yuv420p", "yuvj420p"):
        raise PromoUploadError(
            f"影像色彩格式必須是 yuv420p（目前是 {v.get('pix_fmt') or '未知'}），否則部分瀏覽器無法播放。"
            "請加上 -pix_fmt yuv420p 重新轉檔。", 422)
    width, height = int(v.get("width") or 0), int(v.get("height") or 0)
    if width < 1 or height < 1 or width > MAX_VIDEO_WIDTH or height > MAX_VIDEO_HEIGHT:
        raise PromoUploadError(f"影片寬度不可超過 {MAX_VIDEO_WIDTH} 像素，請縮小解析度（720p 即可）。", 422)
    if audio and audio[0].get("codec_name") != "aac":
        raise PromoUploadError(
            f"聲音編碼必須是 AAC（目前是 {audio[0].get('codec_name') or '未知'}），請重新轉檔。", 422)

    try:
        duration = float(fmt.get("duration"))
    except (TypeError, ValueError):
        raise PromoUploadError("無法判斷影片長度，請重新匯出後再上傳。", 422)
    if not duration > 0:
        raise PromoUploadError("無法判斷影片長度，請重新匯出後再上傳。", 422)
    if duration > MAX_PROMO_DURATION_SECONDS:
        raise PromoUploadError(
            f"影片長度 {duration / 60:.1f} 分鐘，超過上限 {MAX_PROMO_DURATION_SECONDS // 60} 分鐘，請剪短後再上傳。", 422)
    return max(1, int(-(-duration // 1))), {"width": width, "height": height, "has_audio": bool(audio)}


def validate_video(path):
    """回傳 (duration_seconds, size_bytes)。"""
    check_faststart(path)
    duration, _ = analyze_probe(_run_ffprobe(path))
    size = os.path.getsize(path)
    if size > MAX_PROMO_VIDEO_BYTES:
        raise PromoUploadError(f"檔案超過上限 {_human_mb(MAX_PROMO_VIDEO_BYTES)}，請壓縮後再上傳。", 413)
    return duration, size


# ---------------------------------------------------------------- 封面


def validate_and_reencode_cover(path):
    """實際解碼封面，只收 JPEG、WebP，限制像素尺寸；重新編碼後回傳 (新暫存檔路徑, 副檔名)。

    重新編碼可以丟掉檔案尾端夾帶的資料（polyglot）與 EXIF（含拍攝位置等個資），
    方向資訊會先套用再丟，不會轉歪。不收 SVG、GIF 與動態 WebP。
    """
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        # formats= 讓其他格式（TIFF、PNG、GIF…）連檔頭都不會解析：Pillow 的解碼器有不少已知的記憶體損毀漏洞，
        # 封面只需要這兩種。不在清單內的檔案會丟 UnidentifiedImageError，下面回覆「請改用 JPEG 或 WebP」。
        with Image.open(path, formats=_COVER_FORMATS) as probe:
            fmt = probe.format
            width, height = probe.size
            # 動圖幀數要等尺寸檢查通過再讀（讀 n_frames 會解析容器的額外資訊）
            frames = 1 if max(width, height) > MAX_COVER_SIDE else getattr(probe, "n_frames", 1)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise PromoUploadError("無法讀取這張封面圖，請改用 JPEG 或 WebP 格式。", 422)
    if fmt not in ("JPEG", "WEBP"):
        raise PromoUploadError("封面圖只接受 JPEG 或 WebP 格式。", 422)
    if frames and frames > 1:
        raise PromoUploadError("封面圖不可以是動態圖片。", 422)
    if width < 1 or height < 1 or width > MAX_COVER_SIDE or height > MAX_COVER_SIDE:
        raise PromoUploadError(f"封面圖的寬與高都不可超過 {MAX_COVER_SIDE} 像素，請縮小後再上傳。", 422)

    ext = "jpg" if fmt == "JPEG" else "webp"
    out_path = os.path.join(staging_root(), uuid.uuid4().hex + ".part")
    try:
        with Image.open(path, formats=_COVER_FORMATS) as img:
            img.load()
            img = ImageOps.exif_transpose(img)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            if fmt == "JPEG":
                img.save(out_path, "JPEG", quality=90, optimize=True)
            else:
                img.save(out_path, "WEBP", quality=90, method=4)
    except (OSError, ValueError, Image.DecompressionBombError):
        discard(out_path)
        raise PromoUploadError("封面圖已損毀或無法處理，請重新匯出後再上傳。", 422)
    if os.path.getsize(out_path) > MAX_COVER_BYTES:
        discard(out_path)
        raise PromoUploadError(f"封面圖處理後超過 {_human_mb(MAX_COVER_BYTES)}，請縮小尺寸或降低品質。", 413)
    return out_path, ext


# ---------------------------------------------------------------- 字幕

_CUE_TIMING = re.compile(r"(?:\d{1,}:)?\d{2}:\d{2}\.\d{3}[ \t]+-->[ \t]+(?:\d{1,}:)?\d{2}:\d{2}\.\d{3}")


def validate_and_normalize_caption(path):
    """UTF-8、以 WEBVTT 開頭、至少一個 cue。回傳 (新暫存檔路徑, 副檔名)；內容不當 HTML 渲染。"""
    with open(path, "rb") as f:
        raw = f.read(MAX_CAPTION_BYTES + 1)
    if len(raw) > MAX_CAPTION_BYTES:
        raise PromoUploadError(f"字幕檔超過上限 {_human_mb(MAX_CAPTION_BYTES)}。", 413)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise PromoUploadError("字幕檔必須是 UTF-8 編碼，請用文字編輯器另存成 UTF-8 後再上傳。", 422)
    if "\x00" in text:
        raise PromoUploadError("字幕檔含有不合法的字元，請重新匯出。", 422)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not re.match(r"WEBVTT(?:[ \t].*)?(?:\n|\Z)", text):
        raise PromoUploadError("字幕檔必須是 WebVTT 格式，第一行要是 WEBVTT。", 422)
    if not _CUE_TIMING.search(text):
        raise PromoUploadError("字幕檔裡找不到任何字幕段落（時間軸 --> 時間軸），請檢查內容。", 422)
    out_path = os.path.join(staging_root(), uuid.uuid4().hex + ".part")
    with open(out_path, "xb") as out:
        out.write(text.encode("utf-8"))
        out.flush()
        os.fsync(out.fileno())
    return out_path, "vtt"


# ---------------------------------------------------------------- 提交與清理


def _ensure_real_directory(path_parts):
    """逐層建立並確認每一層都是真的目錄、不是符號連結。回傳絕對目錄。"""
    current = media_root()
    for part in path_parts:
        current = os.path.join(current, part)
        if os.path.islink(current):
            raise PromoUploadError("媒體目錄設定不安全（含有符號連結），請聯絡系統管理者。", 503)
        os.makedirs(current, exist_ok=True)
        if os.path.islink(current) or not os.path.isdir(current):
            raise PromoUploadError("媒體目錄設定不安全，請聯絡系統管理者。", 503)
    return current


def commit_staged(staged_path, kind, ext):
    """把驗證過的暫存檔原子地移到公開目錄，回傳要存進資料庫的相對路徑。"""
    subdir = KINDS[kind][0]
    directory = _ensure_real_directory(subdir.split("/"))
    name = f"{uuid.uuid4().hex}.{ext}"
    final = os.path.join(directory, name)
    try:
        os.replace(staged_path, final)
    except OSError:
        raise PromoUploadError("儲存檔案失敗，請稍後再試；若持續發生請聯絡系統管理者。", 503)
    try:
        os.chmod(final, 0o644)
    except OSError:
        pass
    return f"{subdir}/{name}"


def remove_public_file(relative_path):
    """只在「剛提交、資料庫寫入失敗」時用來撤銷那個新檔；不用於刪除舊檔。"""
    if not relative_path:
        return
    target = os.path.join(media_root(), *relative_path.split("/"))
    try:
        os.remove(target)
    except OSError:
        pass


def mark_orphans(relative_paths):
    """把被取代或刪除的舊檔登記為「從現在起孤立」。必須在呼叫端的資料庫交易內呼叫，
    讓孤立紀錄與取代或刪除一起成功、一起回滾；請求內不刪檔，由 cleanup_promo_media 14 天後清。"""
    for path in relative_paths:
        if path:
            PromoMediaOrphan.objects.get_or_create(path=path)
