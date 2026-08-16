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
        except Exception:
            time.sleep(delay)
    return None

@router.post("/analyze_image/")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("vision_analyze_image", "10/minute"))  # 呼叫付費 Google Cloud Vision API，每用戶每分鐘最多 10 次（後台可調，見 rate_limit_config.py）
async def analyze_image(request: Request):
    try:
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

        label_data = []
        for label in labels:
            desc_en = label["description"]
            # translate_with_retry 是同步呼叫（GoogleTranslator + time.sleep 重試，
            # 最長可能卡住數秒），丟到執行緒池執行避免佔住 event loop、卡住同一個
            # worker 上的其他請求。
            desc_zh = await asyncio.to_thread(translate_with_retry, desc_en)
            if desc_zh is not None:
                label_data.append({
                    "description": desc_zh,
                    "score": round(label["score"], 2)
                })

        return {
            "labels": label_data,
        }

    except HTTPException:
        raise
    except Exception as e:
        # 原本直接把 str(e) 回給前端，可能洩漏 Google Vision 回應內容／內部細節，
        # 且這個 except 完全沒有記 log，呼叫失敗時伺服器端也查不出原因。跟同一輪
        # 稽核的 search.py／grammar.py／audio_proxy.py 同一套做法：只記 log，
        # 回給前端的是通用訊息。
        _logger.exception(e)
        raise HTTPException(status_code=500, detail="伺服器發生錯誤，請稍後再試")
