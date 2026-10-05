from fastapi import APIRouter, UploadFile, HTTPException, Request
import asyncio
import base64
import io
import logging
import httpx
import threading
from dotenv import load_dotenv
import os
import time
from deep_translator import GoogleTranslator
from PIL import Image, UnidentifiedImageError

from fastAPI import rate_limit_config
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
if not CLOUD_API_KEY:
    _logger.warning("CLOUD_API_KEY 環境變數未設定，影像辨識功能將無法使用")
if not CLOUD_API_URL:
    _logger.warning("CLOUD_API_URL 環境變數未設定，影像辨識功能將無法使用")

# 圖片辨識同一批 label 常常出現重複的英文單字（例如同一物件被偵測到多次），
# 用一個簡單的 dict 快取翻譯結果，避免對同一個字重複呼叫 Google Translate。
# 只在翻譯成功時寫入快取，重試全部失敗時不快取，避免暫時性錯誤永久污染快取。
_translation_cache: dict[str, str | None] = {}
_translation_cache_lock = threading.Lock()


# deep_translator 底層是爬 Google 翻譯網頁，官方限制約每秒 5 次，伺服器（雲端共用 IP）
# 更容易直接被擋（TooManyRequests）。以前一張圖 10 個 label 連續快速打 10 次，翻譯一失敗就
# 回傳 None、label 被靜默丟掉，前端只看到空清單、console 完全沒有錯誤。
# 現在：1) 優先用官方 Cloud Translation API 一次批次翻完（需在 GCP 啟用 Translation API，
# 與 Vision 共用同一把 key）；2) 失敗才退回 deep_translator，且放慢呼叫節奏＋指數退避；
# 3) 仍失敗就保留英文原字並記 log，而不是把 label 丟掉。
CLOUD_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
_FALLBACK_MIN_INTERVAL = 0.3  # 秒，約每秒 3 次，低於 Google 5 次/秒的限制


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
        return {t: i["translatedText"] for t, i in zip(texts, items)}
    except Exception as exc:
        _logger.warning("[vision] 官方 Translation API 例外：%s", type(exc).__name__)
        return None


def translate_with_retry(text: str, retries=3, delay=1) -> str | None:
    if not text.strip():
        return text

    key = text.strip().lower()
    if key in _translation_cache:
        return _translation_cache[key]

    for i in range(retries):
        try:
            translated = GoogleTranslator(source='en', target='zh-TW').translate(text)
            result = None if translated.strip().lower() == key else translated
            with _translation_cache_lock:
                _translation_cache[key] = result
            return result
        except Exception as exc:
            _logger.warning("[vision] deep_translator 翻譯失敗（%d/%d）text=%r：%s", i + 1, retries, text, type(exc).__name__)
            time.sleep(delay * (2 ** i))
    return None


def translate_labels(descriptions: list[str]) -> dict[str, str | None]:
    """回傳 {英文: 中文}；翻譯失敗的字保留英文原字，不會是 None（None 僅代表翻譯結果與原文相同或空字串）。"""
    out: dict[str, str | None] = {}
    pending = []
    for d in descriptions:
        k = d.strip().lower()
        if k in _translation_cache:
            out[d] = _translation_cache[k]
        elif d not in pending:
            pending.append(d)

    official = _translate_batch_official(pending) if pending else None
    if official:
        for d, zh in official.items():
            with _translation_cache_lock:
                _translation_cache[d.strip().lower()] = zh
            out[d] = zh
        pending = []

    for n, d in enumerate(pending):
        if n:
            time.sleep(_FALLBACK_MIN_INTERVAL)
        zh = translate_with_retry(d)
        if zh is None and d.strip().lower() not in _translation_cache:
            _logger.error("[vision] 所有翻譯方式都失敗，保留英文原字 text=%r", d)
            zh = d
        out[d] = zh
    return out


@router.post("/analyze_image/")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("vision_analyze_image", "10/minute"))  # 呼叫付費 Google Cloud Vision API，每位使用者每分鐘最多 10 次（後台可調，見 rate_limit_config.py）
async def analyze_image(request: Request):
    # 這裡不再自己包一層 `except Exception: log + raise HTTPException(500,...)`
    # 收尾（P4 review BE-28：這段樣板在 vision.py／quiz/api.py／
    # dictionary/search.py／translation/api.py 各自重複逐字一樣的邏輯）。
    # 沒被下面明確攔截的例外，一律交給 main.py 註冊的全域 Exception handler
    # 記 log＋回傳通用訊息；HTTPException 本身有 FastAPI 內建的 handler，
    # 兩者都不需要這支函式自己再攔一次。
    form = await request.form()
    file: UploadFile = form.get("file")

    if not file:
        raise HTTPException(status_code=400, detail="未收到圖片")

    contents = await file.read()

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
        Image.open(io.BytesIO(contents)).verify()
    except UnidentifiedImageError:
        _logger.warning(
            "[vision] 檔案內容不是可辨識的圖片格式 filename=%r content_type=%r bytes=%d 開頭=%s",
            getattr(file, "filename", None), getattr(file, "content_type", None),
            len(contents), contents[:12].hex(),
        )
        raise HTTPException(
            status_code=400,
            detail="這個檔案看起來不是有效的圖片（可能副檔名跟實際內容不符），請重新選擇圖片再試一次",
        )

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

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(url, headers=headers, json=data)

    result = response.json()
    if "responses" not in result or len(result["responses"]) == 0:
        raise HTTPException(status_code=500, detail="Google API 回傳格式錯誤（缺少 responses）")

    if "error" in result["responses"][0]:
        _logger.warning(
            "[vision] Google 回傳 error，收到的圖片 bytes=%d filename=%r：%s",
            len(contents), getattr(file, "filename", None), result["responses"][0]["error"]["message"],
        )
        raise HTTPException(status_code=500, detail=result["responses"][0]["error"]["message"])

    labels = result["responses"][0].get("labelAnnotations", [])

    # 翻譯是同步呼叫（含 time.sleep 退避），整批丟到執行緒池，避免卡住 event loop。
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
