from fastapi import APIRouter, UploadFile, HTTPException, Request
import base64
import logging
import requests
import threading
from dotenv import load_dotenv
import os
import time
from deep_translator import GoogleTranslator

load_dotenv()
router = APIRouter()
_logger = logging.getLogger(__name__)

VITE_CLOUD_API_KEY = os.getenv("VITE_CLOUD_API_KEY")
VITE_CLOUD_API_URL = os.getenv("VITE_CLOUD_API_URL")
if not VITE_CLOUD_API_KEY:
    _logger.warning("VITE_CLOUD_API_KEY 環境變數未設定，影像辨識功能將無法使用")
if not VITE_CLOUD_API_URL:
    _logger.warning("VITE_CLOUD_API_URL 環境變數未設定，影像辨識功能將無法使用")

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
async def analyze_image(request: Request):
    try:
        form = await request.form()
        file: UploadFile = form.get("file")

        if not file:
            raise HTTPException(status_code=400, detail="未收到圖片")

        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode("utf-8")

        if not VITE_CLOUD_API_URL or not VITE_CLOUD_API_KEY:
            raise HTTPException(status_code=503, detail="影像辨識 API 環境變數未設定")
        url = VITE_CLOUD_API_URL + VITE_CLOUD_API_KEY
        headers = {"Content-Type": "application/json"}
        data = {
            "requests": [
                {
                    "image": {"content": image_base64},
                    "features": [{"type": "LABEL_DETECTION", "maxResults": 10}],
                }
            ]
        }

        response = requests.post(url, headers=headers, json=data)

        result = response.json()
        if "responses" not in result or len(result["responses"]) == 0:
            raise HTTPException(status_code=500, detail="Google API 回傳格式錯誤（缺少 responses）")

        if "error" in result["responses"][0]:
            raise HTTPException(status_code=500, detail=result["responses"][0]["error"]["message"])

        labels = result["responses"][0].get("labelAnnotations", [])

        label_data = []
        for label in labels:
            desc_en = label["description"]
            desc_zh = translate_with_retry(desc_en)
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
