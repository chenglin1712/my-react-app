import asyncio
import logging
import os
import re

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from dictionary_db.connect import get_db
from dictionary_db.model import Word
from dictionary_db.word_data import load_audio_items_for_words
from config.tribes import TRIBE_MAP
from fastAPI.rate_limit import limiter
from fastAPI.url_safety import is_safe_redirect_target

from .schemas import SentenceAudioRequest
from .search import _tribe_id_subquery

router = APIRouter()

logger = logging.getLogger(__name__)

ILRDF_AUDIO_API = "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"

@router.get("/audio/{file_id:path}")
@limiter.limit("60/minute")  # 原本沒有限流，見同檔案其他端點的說明
async def proxy_audio(request: Request, file_id: str):
    try:
        first_url = ILRDF_AUDIO_API + file_id

        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            res = await client.get(first_url)

            if res.status_code in [301, 302, 303, 307, 308]:
                final_url = res.headers.get("Location", "")
            else:
                final_url = res.text.strip()

            if not final_url or "http" not in final_url:
                return Response(content="Unable to resolve audio URL", media_type="text/plain", status_code=404)

            # 第二次請求的目標網址完全由第一次請求的回應內容決定，發出前先擋掉
            # 明顯指向內網／loopback／link-local（含雲端 metadata endpoint）的
            # 位址，避免被當成 SSRF 跳板（見 url_safety.py 說明）。
            if not is_safe_redirect_target(final_url):
                return Response(content="Audio URL not allowed", media_type="text/plain", status_code=502)

            async with httpx.AsyncClient(timeout=15) as c2:
                audio_res = await c2.get(final_url)
                if audio_res.status_code != 200:
                    return Response(content="Audio file not found", media_type="text/plain", status_code=404)
                content_type = audio_res.headers.get("content-type", "audio/mpeg")
                return Response(content=audio_res.content, media_type=content_type)

    except httpx.ConnectError:
        return Response(content="Audio API unreachable", media_type="text/plain", status_code=503)
    except Exception as e:
        logger.exception(e)
        return Response(content="伺服器發生錯誤，請稍後再試", media_type="text/plain", status_code=500)


# /debug_audio 只回傳內部除錯資訊（音檔真實 URL、狀態碼、bytes 內容），只在本機開發時註冊，
# 正式環境（DJANGO_DEBUG=False）不掛載這個路由，避免暴露內部資訊。
if os.getenv("DJANGO_DEBUG", "False") == "True":
    @router.get("/debug_audio/{audio_id}")
    async def debug_audio(audio_id: str):

        try:
            # 使用你原本的邏輯抓音檔
            load_dotenv()
            VITE_AUDIO_FILE_URL = os.getenv("VITE_AUDIO_FILE_URL")
            first_url = VITE_AUDIO_FILE_URL + audio_id

            async with httpx.AsyncClient(follow_redirects=False) as client:
                res = await client.get(first_url)

                # 判斷是否 redirect
                if res.status_code in [301, 302, 303, 307, 308]:
                    final_url = res.headers.get("Location")
                else:
                    final_url = res.text.strip()

                if not final_url or "http" not in final_url:
                    return {
                        "success": False,
                        "step": "resolve_redirect",
                        "raw_text": res.text
                    }

                # 第二次請求的目標網址完全由第一次請求的回應內容決定，發出前先
                # 擋掉明顯指向內網／loopback／link-local 的位址（見 url_safety.py）。
                if not is_safe_redirect_target(final_url):
                    return {
                        "success": False,
                        "step": "unsafe_redirect_target",
                        "final_url": final_url,
                    }

            # 第二次請求真正的音檔
            async with httpx.AsyncClient() as c2:
                audio_res = await c2.get(final_url)

                target_bytes = audio_res.content

                # 回傳訊息（避免太大，只回前 50 bytes）
                return {
                    "success": True,
                    "download_url": final_url,
                    "status_code": audio_res.status_code,
                    "content_type": audio_res.headers.get("Content-Type"),
                    "bytes_length": len(target_bytes),
                    "bytes_preview": list(target_bytes[:50])
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


@router.post("/sentence-audio/")
@limiter.limit("60/minute")  # 原本沒有限流，見同檔案其他端點的說明
async def get_sentence_audio(request: Request, body: SentenceAudioRequest, db: Session = Depends(get_db)):
    """
    將句子拆成詞，依序查詢各詞在字典中的音檔 fileId，
    回傳有音檔的詞清單（依句子順序），供前端逐詞串接播放。

    原本直接吃 request.json() 後用 dict.get() 存取，沒有 Pydantic 驗證，整支函式
    也完全沒有 try/except：格式不對的輸入（例如 tribe 傳陣列）會讓
    TRIBE_MAP.get(tribe, tribe) 對不可雜湊的 key 丟 TypeError，變成未處理的 500。
    改用 Pydantic model 驗證（型別、長度上限），格式不對會在這裡就被 FastAPI
    擋成 422，不會走到後面的邏輯；其餘非預期例外也補上 try/except，統一回應格式。
    """
    try:
        from sqlalchemy import func as sa_func
        tribe_name = TRIBE_MAP.get(body.tribe, body.tribe)

        # 以空白與標點切詞，保留字母、撇號、連字號
        tokens = re.findall(r"[a-zA-ZʼʻΩ'\-]+", body.sentence)

        def _lookup_audio_tokens():
            audio_tokens = []
            seen_file_ids: set = set()
            tribe_id_subq = _tribe_id_subquery(tribe_name)

            for token in tokens:
                token_lower = token.lower()
                word = db.query(Word).filter(
                    Word.tribe_id == tribe_id_subq,
                    sa_func.lower(Word.name) == token_lower
                ).first()

                if not word:
                    continue

                audios = load_audio_items_for_words(db, word_ids=[word.id]).get(word.id, [])
                if not audios:
                    continue

                file_id = audios[0].get("fileId")
                if not file_id or file_id in seen_file_ids:
                    continue

                seen_file_ids.add(file_id)
                audio_tokens.append({"word": token, "fileId": file_id})

            return audio_tokens

        # 逐詞同步查詢，句子長時一樣會累積成有感的阻塞時間，丟到執行緒池執行
        # 避免卡住 event loop（見 /keys/ 同樣的說明）。
        audio_tokens = await asyncio.to_thread(_lookup_audio_tokens)

        return JSONResponse({"audioTokens": audio_tokens})
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)
