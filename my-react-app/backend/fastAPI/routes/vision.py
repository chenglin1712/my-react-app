from fastapi import APIRouter, UploadFile, HTTPException, Request
import asyncio
import base64
import logging
import httpx
import threading
from dotenv import load_dotenv
import os
import time
from deep_translator import GoogleTranslator

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
@limiter.limit("10/minute")  # 呼叫付費 Google Cloud Vision API，每用戶每分鐘最多 10 次
async def analyze_image(request: Request):
    try:
        form = await request.form()
        file: UploadFile = form.get("file")

        if not file:
            raise HTTPException(status_code=400, detail="未收到圖片")

        contents = await file.read()

        if len(contents) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="圖片不得超過 5 MB")

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
        raise HTTPException(status_code=500, detail=str(e))
