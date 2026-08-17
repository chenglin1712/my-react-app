import asyncio
import logging
import re

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from dictionary_db.connect import get_db
from dictionary_db.model import MediaAsset, Word
from dictionary_db.word_data import load_audio_items_for_words
from config.tribes import resolve_tribe_name
from config.debug_flag import is_debug
from config.audio_source import get_ilrdf_audio_api
from config.media_source import get_media_source_mode
from fastAPI import rate_limit_config
from fastAPI.rate_limit import limiter
from config.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target

from .schemas import SentenceAudioRequest
from .search import _tribe_id_subquery

router = APIRouter()

logger = logging.getLogger(__name__)

# P5 辭典媒體自主化：word_audio／sentence_audio 的 file_id 在 media_asset 共用
# 同一個 kind（見 migrate_dictionary_media.py 檔頭說明——實測有 8 個 file_id
# 同時出現在兩張來源表，這個端點只收得到 file_id、並不知道原本是從哪張表來
# 的，統一成一個 kind 才能只憑 file_id 查到）。
_AUDIO_SOURCE_PROVIDER = "ilrdf"
_AUDIO_MEDIA_KIND = "ilrdf_audio"


def _lookup_verified_audio_asset(db: Session, file_id: str):
    """查這個 file_id 是否已經有遷移完成的自有 Storage 副本。"""
    return (
        db.query(MediaAsset)
        .filter_by(source_provider=_AUDIO_SOURCE_PROVIDER, source_kind=_AUDIO_MEDIA_KIND, source_locator=file_id, status="verified")
        .first()
    )


@router.get("/audio/{file_id:path}")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("dictionary_audio_proxy_proxy_audio", "60/minute"))  # 原本沒有限流，見同檔案其他端點的說明
async def proxy_audio(request: Request, file_id: str, db: Session = Depends(get_db)):
    # P5 辭典媒體自主化：有自己 Storage 的已驗證副本就直接 302 過去，讓
    # Google 的 CDN 送檔，這個端點自己不用再扛流量，也不再依賴 ILRDF 存活。
    # 這是單一、有索引的查詢（media_asset 的 unique index 就是
    # (source_provider, source_kind, source_locator)），跟 search.py 既有
    # 「直接同步呼叫 db.query()，不特地丟 to_thread」的作法一致，不像
    # /sentence-audio/ 那種迴圈查詢才需要丟執行緒池。
    asset = _lookup_verified_audio_asset(db, file_id)
    if asset is not None and asset.public_url:
        return RedirectResponse(url=asset.public_url, status_code=302)

    if get_media_source_mode() == "storage_only":
        # 全量遷移驗證完成、正式切斷 ILRDF 依賴後才會用這個模式：沒有自己的
        # 副本就直接回錯誤，不再嘗試連線 ILRDF（這正是「不再依賴外部 API」
        # 這個目標唯一算數的狀態，見 config/media_source.py 的說明）。
        return Response(content="音檔尚未遷移完成，請稍後再試", media_type="text/plain", status_code=404)

    # hybrid 模式（預設）：還沒遷移到的詞條，照舊即時代理 ILRDF，行為完全不變。
    try:
        first_url = get_ilrdf_audio_api() + file_id

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
                # is_safe_redirect_target 檢查的那次 DNS 解析，跟這裡 c2.get()
                # 實際連線時 httpx 自己重新做的 DNS 解析是兩次獨立的查詢——如果
                # 網域在中間變更了解析結果（低 TTL、DNS rebinding），前面的檢查
                # 就形同虛設。這裡改成檢查「實際建立連線的那個 IP」本身安不
                # 安全（見 url_safety.py 的 assert_response_from_safe_peer），
                # 不安全就整段內容都不回傳給呼叫端。
                assert_response_from_safe_peer(audio_res)
                if audio_res.status_code != 200:
                    return Response(content="Audio file not found", media_type="text/plain", status_code=404)
                content_type = audio_res.headers.get("content-type", "audio/mpeg")
                return Response(content=audio_res.content, media_type=content_type)

    except UnsafeConnectionError:
        return Response(content="Audio URL not allowed", media_type="text/plain", status_code=502)
    except httpx.ConnectError:
        return Response(content="Audio API unreachable", media_type="text/plain", status_code=503)
    except Exception as e:
        logger.exception(e)
        return Response(content="伺服器發生錯誤，請稍後再試", media_type="text/plain", status_code=500)


# /debug_audio 只回傳內部除錯資訊（音檔真實 URL、狀態碼、bytes 內容），只在本機開發時註冊，
# 正式環境（DJANGO_DEBUG=False）不掛載這個路由，避免暴露內部資訊。
if is_debug():
    @router.get("/debug_audio/{audio_id}")
    async def debug_audio(audio_id: str):

        try:
            first_url = get_ilrdf_audio_api() + audio_id

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

                # 跟 proxy_audio 同樣的 DNS rebinding TOCTOU 防護：確認實際
                # 建立連線的 IP 安全，才信任這次的回應內容（見 url_safety.py）。
                try:
                    assert_response_from_safe_peer(audio_res)
                except UnsafeConnectionError as e:
                    return {
                        "success": False,
                        "step": "unsafe_connection_peer",
                        "error": str(e),
                    }

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
@limiter.limit(lambda: rate_limit_config.get_configured_rate("dictionary_audio_proxy_get_sentence_audio", "60/minute"))  # 原本沒有限流，見同檔案其他端點的說明
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
        try:
            tribe_name = resolve_tribe_name(body.tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)

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
