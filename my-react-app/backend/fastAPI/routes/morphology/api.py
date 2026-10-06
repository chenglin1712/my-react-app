"""詞形分析的 HTTP 端點。認證／限流／HTTP 狀態碼在這裡決定，分析邏輯在 service.py。"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from dictionary_db.connect import SessionLocal
from fastAPI import rate_limit_config
from fastAPI.rate_limit import limiter

from . import service
from .schemas import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _run(tribe: str, word: str) -> AnalyzeResponse:
    """在實際執行查詢的 thread 裡自己開、自己關 Session（理由見 dictionary/search.py 的
    _call_with_own_session）。"""
    db = SessionLocal()
    try:
        return service.analyze(db, tribe, word)
    finally:
        db.close()


@router.post("/analyze", response_model=AnalyzeResponse)
@limiter.limit(lambda: rate_limit_config.get_configured_rate("morphology_analyze", "60/minute"))
async def analyze_endpoint(request: Request, body: AnalyzeRequest):
    try:
        # 冷快取時要建立該族語的分析器（規則歸納＋詞庫索引），是同步的阻塞運算，丟到執行緒池，
        # 避免卡住 event loop。
        return await asyncio.to_thread(_run, body.tribe, body.word)
    except (service.UnsupportedTribeError, service.InvalidWordError) as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except Exception:
        # 原始例外訊息（可能含 SQL、內部路徑）只記 log，不回給 client。
        logger.error("[morphology] 分析失敗\n%s", request.url, exc_info=True)
        return JSONResponse({"detail": "詞形分析暫時無法使用，請稍後再試"}, status_code=503)
