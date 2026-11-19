from fastapi import APIRouter, HTTPException, Request
import asyncio
import base64
import io
import logging
import httpx
import threading
from dotenv import load_dotenv
import os
from PIL import Image, UnidentifiedImageError

from fastAPI import rate_limit_config
from fastAPI.form_limits import is_upload, multipart_openapi_extra, parse_bounded_form
from fastAPI.rate_limit import limiter

load_dotenv()
router = APIRouter()
_logger = logging.getLogger(__name__)

# 這兩個是 Google Cloud Vision API 的伺服器端金鑰／URL，只在 FastAPI 這裡讀取，
# 前端沒有也不該引用。原本沿用了 VITE_ 前綴命名，容易讓人誤以為要打包進前端
# bundle（Vite 只會把 VITE_ 開頭的環境變數暴露給前端 import.meta.env），改掉
# 前綴避免未來有人誤解成可以公開曝露。
CLOUD_API_KEY = os.getenv("CLOUD_API_KEY")
CLOUD_API_URL = os.getenv("CLOUD_API_URL")

# 上傳圖片大小上限，避免超大圖片吃掉伺服器記憶體，也避免白白打一次付費的 Google Cloud Vision API
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
# 只收這三種格式：Pillow 能開的格式很多（TIFF、FPX、EPS、PDF…），每一種都是一個解碼器，
# 其中有不少已知的記憶體損毀漏洞（S-03）。Image.open 的 formats= 讓其他格式連檔頭都不會解析。
# Google Vision 雖然也支援 GIF、BMP 等，但沒有必要為它們開放攻擊面。
ALLOWED_IMAGE_FORMATS = ("JPEG", "PNG", "WEBP")
# 邊長上限：與 AIModel/image_input.py 一致。這裡只讀檔頭宣告的尺寸，先擋掉「檔案很小、宣告的像素卻極大」
MAX_IMAGE_SIDE = 8000
# 呼叫 Google Vision 失敗時回給前端的固定訊息（Google 的原文只寫 log，不回給前端）
VISION_TIMEOUT_MESSAGE = "辨識服務回應逾時，請稍後再試"
VISION_UNREACHABLE_MESSAGE = "暫時連不上辨識服務，請稍後再試"
VISION_BUSY_MESSAGE = "辨識服務目前較忙碌，請稍後再試"
VISION_UNAVAILABLE_MESSAGE = "辨識服務暫時無法使用，請稍後再試"
if not CLOUD_API_KEY:
    _logger.warning("CLOUD_API_KEY 環境變數未設定，影像辨識功能將無法使用")
if not CLOUD_API_URL:
    _logger.warning("CLOUD_API_URL 環境變數未設定，影像辨識功能將無法使用")

# 圖片辨識同一批 label 常常出現重複的英文單字（例如同一物件被偵測到多次），
# 用一個簡單的 dict 快取翻譯結果，避免對同一個字重複呼叫 Google Translate。
# 只在翻譯成功時寫入快取，重試全部失敗時不快取，避免暫時性錯誤永久污染快取。
_translation_cache: dict[str, str | None] = {}
_MISSING = object()  # translate_labels 用來區分「快取沒有這個鍵」與「快取值是 None」
_translation_cache_lock = threading.Lock()


# 翻譯只用官方 Cloud Translation API，一次批次翻完（需在 GCP 啟用 Translation API，與 Vision 共用同一把 key）。
# 以前失敗時會退回 deep_translator（爬 Google 翻譯網頁的非官方套件）：它沒有修正版本、雲端共用 IP 容易被擋、
# 而且是把使用者圖片的辨識結果送到一個沒有合約的網頁端點，所以移除。
# 翻譯失敗（沒設定 key、API 沒啟用、逾時）就保留英文原字並記 log，而不是把 label 丟掉。
CLOUD_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"


def _translate_batch_official(texts: list[str]) -> dict[str, str] | None:
    if not CLOUD_API_KEY or not texts:
        return None
    try:
        resp = httpx.post(
            CLOUD_TRANSLATE_URL,
            params={"key": CLOUD_API_KEY},
            json={"q": texts, "source": "en", "target": "zh-TW", "format": "text"},
            timeout=10,
        )
        if resp.status_code != 200:
            _logger.warning("[vision] 官方 Translation API 失敗 status=%s：%s", resp.status_code, resp.text[:200].replace(CLOUD_API_KEY, "***"))
            return None
        items = resp.json()["data"]["translations"]
        # 只收「確實翻出非空字串」的項目；數量對不上、缺項、空字串都當成那一項失敗（呼叫端會保留英文原字）
        out = {}
        for text, item in zip(texts, items):
            zh = item.get("translatedText") if isinstance(item, dict) else None
            if isinstance(zh, str) and zh.strip():
                out[text] = zh
        return out
    except Exception as exc:
        _logger.warning("[vision] 官方 Translation API 例外：%s", type(exc).__name__)
        return None


def translate_labels(descriptions: list[str]) -> dict[str, str | None]:
    """回傳 {英文: 中文}；翻譯失敗的字保留英文原字，不會是 None（None 僅代表翻譯結果與原文相同或空字串）。"""
    out: dict[str, str | None] = {}
    pending = []
    for d in descriptions:
        k = d.strip().lower()
        # 單次 get()：快取值可能是 None（翻譯與原文相同），所以用哨兵區分「沒有」。
        cached = _translation_cache.get(k, _MISSING)
        if cached is not _MISSING:
            out[d] = cached
        elif d not in pending:
            pending.append(d)

    official = _translate_batch_official(pending) if pending else None
    if official:
        for d, zh in official.items():
            with _translation_cache_lock:
                _translation_cache[d.strip().lower()] = zh
            out[d] = zh
        pending = [d for d in pending if d not in official]

    # 官方 API 沒翻成（含沒設定 key）：保留英文原字，不快取，下一次請求還有機會翻成
    for d in pending:
        _logger.error("[vision] 翻譯失敗，保留英文原字 text=%r", d)
        out[d] = d
    return out


def _is_valid_label(label) -> bool:
    return (
        isinstance(label, dict)
        and isinstance(label.get("description"), str)
        and isinstance(label.get("score"), (int, float))
        and not isinstance(label.get("score"), bool)
        # Google 的 score 是 0～1。順便擋掉 NaN／Infinity（json 模組會收下，但它們無法序列化回 JSON）
        # 與超大整數；比大小不會像 math.isfinite 那樣在超大整數時丟出 OverflowError
        and 0 <= label["score"] <= 1
    )


def _google_error_summary(payload, response) -> str:
    """從 Google 的回應挑出可以寫進 log 的一小段文字：優先用 error.message，沒有就用回應本文的開頭。
    不論哪一種都先把金鑰換成 ***，並截短，避免把內部細節或金鑰寫進 log。"""
    text = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            text = error.get("message")
    if not isinstance(text, str) or not text:
        try:
            text = response.text
        except Exception:
            text = ""
        if not isinstance(text, str):
            text = ""
    if CLOUD_API_KEY:
        text = text.replace(CLOUD_API_KEY, "***")
    return text[:200]


@router.post("/analyze_image/", openapi_extra=multipart_openapi_extra(file_field="file"))
@limiter.limit(lambda: rate_limit_config.get_configured_rate("vision_analyze_image", "10/minute"))  # 呼叫付費 Google Cloud Vision API，每位使用者每分鐘最多 10 次（後台可調，見 rate_limit_config.py）
async def analyze_image(request: Request):
    # 這裡不再自己包一層 `except Exception: log + raise HTTPException(500,...)`
    # 收尾（P4 review BE-28：這段樣板在 vision.py／quiz/api.py／
    # dictionary/search.py／translation/api.py 各自重複逐字一樣的邏輯）。
    # 沒被下面明確攔截的例外，一律交給 main.py 註冊的全域 Exception handler
    # 記 log＋回傳通用訊息；HTTPException 本身有 FastAPI 內建的 handler，
    # 兩者都不需要這支函式自己再攔一次。
    # 前端只送一個 file 欄位，沒有其他文字欄位；表單解析先設好上限（S-04），再來才檢查檔案大小。
    form = await parse_bounded_form(request, max_files=1, max_fields=0)
    try:
        return await _analyze_uploaded_image(form.get("file"))
    finally:
        # 手動解析表單就沒有 FastAPI 自動關閉暫存檔的機制，要自己關
        await form.close()


async def _analyze_uploaded_image(file):
    # 不是檔案（例如把 file 當文字欄位送）也視同沒收到圖片，不然下面 read() 會直接炸成 500
    if not is_upload(file):
        raise HTTPException(status_code=400, detail="未收到圖片")

    # 最多多讀 1 byte 就知道超限，不把超大檔案整個讀進記憶體
    contents = await file.read(MAX_IMAGE_BYTES + 1)

    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="圖片不得超過 5 MB")

    if len(contents) == 0:
        _logger.warning(
            "[vision] 收到空的圖片內容 filename=%r content_type=%r",
            getattr(file, "filename", None), getattr(file, "content_type", None),
        )
        raise HTTPException(status_code=400, detail="圖片內容是空的，請重新選擇圖片再試一次")

    # 已查明「Bad image data.」的實際根因：本機素材庫（Z:\Desktop\win\
    # <族語>\<分類>\images\）裡有大量檔案雖然副檔名是 .jpg/.png，內容其實
    # 是 RIFF/WAVE 音檔（推測是製作素材時的匯出腳本把音檔跟圖檔的副檔名
    # 對錯）——抽查布農/排灣/阿美三個族語的 images 資料夾，約 40~48% 的
    # 檔案都是這種「假圖片」。前端 accept="image/*" 跟 Windows 選檔對話框
    # 都只看副檔名，不會擋下這些檔案，使用者選到就一定會在這裡被 Google
    # Vision 拒絕（Google 的解碼器是對的，錯的是素材本身）。
    #
    # 与其把「Bad image data.」這種語意不明的 Google 錯誤原樣丟給前端、
    # 還多花一次付費 API 呼叫，這裡改成呼叫 Google 之前先用 Pillow 本地
    # 驗證能不能解成圖片，解不開就直接擋下來、給使用者看得懂的訊息。
    try:
        with Image.open(io.BytesIO(contents), formats=ALLOWED_IMAGE_FORMATS) as img:
            width, height = img.size
            if max(width, height) > MAX_IMAGE_SIDE or min(width, height) < 1:
                raise HTTPException(status_code=400, detail="圖片的寬或高太大，請縮小後再上傳")
            img.verify()
    except UnidentifiedImageError:
        _logger.warning(
            "[vision] 檔案內容不是可辨識、或不支援的圖片格式 filename=%r content_type=%r bytes=%d 開頭=%s",
            getattr(file, "filename", None), getattr(file, "content_type", None),
            len(contents), contents[:12].hex(),
        )
        raise HTTPException(
            status_code=400,
            detail="只支援 JPEG、PNG、WebP 圖片。這個檔案可能不是圖片（副檔名跟實際內容不符），或是其他格式，請重新選擇圖片再試一次",
        )
    except (Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        # 檔頭看起來是圖片，但內容損毀或是解壓縮炸彈（極小的檔案宣告極大的畫面）
        _logger.warning(
            "[vision] 圖片損毀或過大無法處理 filename=%r bytes=%d", getattr(file, "filename", None), len(contents),
            exc_info=True,
        )
        raise HTTPException(status_code=400, detail="這張圖片已損毀或無法處理，請重新選擇圖片再試一次")

    image_base64 = base64.b64encode(contents).decode("utf-8")

    if not CLOUD_API_URL or not CLOUD_API_KEY:
        raise HTTPException(status_code=503, detail="影像辨識 API 環境變數未設定")
    url = CLOUD_API_URL + CLOUD_API_KEY
    headers = {"Content-Type": "application/json"}
    data = {
        "requests": [
            {
                "image": {"content": image_base64},
                "features": [{"type": "LABEL_DETECTION", "maxResults": 10}],
            }
        ]
    }

    # 呼叫 Google 的各種失敗都要分得清楚，前端才知道該不該叫使用者重試：
    #   逾時 → 504、連線失敗 → 503、Google 說配額用完（429）→ 429、其餘 Google 端的問題 → 502。
    # Google 的原文（可能是英文、也可能含內部細節）只寫 log，回給前端的一律是固定的中文。
    # 注意：url 裡面帶著金鑰，所以 log 只記例外的「類型」，不記例外訊息，也不記完整的回應內容。
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url, headers=headers, json=data)
    except httpx.TimeoutException:
        _logger.warning("[vision] 呼叫 Google Vision 逾時 bytes=%d", len(contents))
        raise HTTPException(status_code=504, detail=VISION_TIMEOUT_MESSAGE) from None
    except httpx.RequestError as exc:
        _logger.warning("[vision] 連不上 Google Vision：%s", type(exc).__name__)
        raise HTTPException(status_code=503, detail=VISION_UNREACHABLE_MESSAGE) from None

    try:
        result = response.json()
    except ValueError:
        result = None

    if response.status_code != 200:
        # Google 的 HTTP 錯誤（金鑰被限制 403、配額 429、伺服器 5xx…）
        _logger.warning(
            "[vision] Google Vision 回傳 HTTP %s：%s", response.status_code, _google_error_summary(result, response),
        )
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail=VISION_BUSY_MESSAGE)
        raise HTTPException(status_code=502, detail=VISION_UNAVAILABLE_MESSAGE)

    responses = result.get("responses") if isinstance(result, dict) else None
    if not isinstance(responses, list) or not responses or not isinstance(responses[0], dict):
        _logger.warning("[vision] Google Vision 回傳格式不符預期（缺少 responses）：%s", _google_error_summary(result, response))
        raise HTTPException(status_code=502, detail=VISION_UNAVAILABLE_MESSAGE)

    first = responses[0]
    if "error" in first:
        _logger.warning(
            "[vision] Google 回傳 error，收到的圖片 bytes=%d filename=%r：%s",
            len(contents), getattr(file, "filename", None), _google_error_summary(first, response),
        )
        # google.rpc.Code 8 ＝ RESOURCE_EXHAUSTED（配額用完）
        error = first["error"] if isinstance(first["error"], dict) else {}
        if error.get("code") == 8:
            raise HTTPException(status_code=429, detail=VISION_BUSY_MESSAGE)
        raise HTTPException(status_code=502, detail=VISION_UNAVAILABLE_MESSAGE)

    # Google 沒有辨識到任何東西時會省略 labelAnnotations（當作空清單）；有的話每一項都要是
    # 「文字描述＋數字分數」。格式不符就當成 Google 回壞掉的資料（502），不要讓 KeyError／TypeError 變成 500。
    labels = first.get("labelAnnotations", [])
    if not isinstance(labels, list) or not all(_is_valid_label(label) for label in labels):
        _logger.warning("[vision] Google Vision 的 labelAnnotations 格式不符預期 bytes=%d", len(contents))
        raise HTTPException(status_code=502, detail=VISION_UNAVAILABLE_MESSAGE)

    # 翻譯是同步的 HTTP 呼叫，整批丟到執行緒池，避免卡住 event loop。
    translations = await asyncio.to_thread(translate_labels, [l["description"] for l in labels])

    label_data = []
    for label in labels:
        desc_zh = translations.get(label["description"])
        if desc_zh is not None:
            label_data.append({
                "description": desc_zh,
                "score": round(label["score"], 2)
            })

    return {
        "labels": label_data,
    }
