from fastapi import APIRouter, UploadFile, HTTPException, Request
import base64
import requests
from dotenv import load_dotenv
import os
import time
from deep_translator import GoogleTranslator


load_dotenv()
router = APIRouter()

VITE_CLOUD_API_KEY = os.getenv("VITE_CLOUD_API_KEY")
VITE_CLOUD_API_URL = os.getenv("VITE_CLOUD_API_URL")
if not VITE_CLOUD_API_KEY:
    print("WARNING: VITE_CLOUD_API_KEY 環境變數未設定，影像辨識功能將無法使用")
if not VITE_CLOUD_API_URL:
    print("WARNING: VITE_CLOUD_API_URL 環境變數未設定，影像辨識功能將無法使用")

def translate_with_retry(text: str, retries=3, delay=1) -> str | None:
    if not text.strip():
        return text
    for i in range(retries):
        try:
            translated = GoogleTranslator(source='en', target='zh-TW').translate(text)
            if translated.strip().lower() == text.strip().lower():
                print(f"翻譯結果與原文相同，可能未翻譯：{text}")
                return None
            return translated
        except Exception as e:
            print(f"翻譯失敗，重試中({i+1}/{retries})：{e}")
            time.sleep(delay)
    print(f"翻譯最終失敗，丟棄項目：{text}")
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
        print("📡 Google Vision 回傳狀態碼:", response.status_code)
        print("📡 Google Vision 回傳原始資料:", response.text)

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

        image_uri = f"data:image/jpeg;base64,{image_base64}"

        return {
            "labels": label_data,
            "annotated_image": image_uri,
        }

    except Exception as e:
        print("錯誤：", str(e))
        raise HTTPException(status_code=500, detail=str(e))
