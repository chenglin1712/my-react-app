"""族語翻譯功能的 HTTP 端點。認證/限流/HTTP 狀態碼在這裡決定；實際翻譯邏輯
在 service.py，這支檔案只負責把 HTTP 請求轉成 service.translate() 呼叫、
把結果／例外轉成 HTTP 回應——分工比照 backend/AIModel/views.py 對
backend/AIModel/services.py 的角色劃分。
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from config.tribes import TRIBES
from dictionary_db.connect import get_db
from fastAPI import feature_flags, rate_limit_config, usage_events
from fastAPI.rate_limit import limiter

from . import retrieve as R
from . import service
from .schemas import (
    CapabilitiesResponse, CoverageOut, EvidenceOut, EvidenceSentenceOut, EvidenceWordOut,
    TokenOut, TranslateRequest, TranslateResponse, TribeCapabilityOut,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_FEATURE_FLAG_KEY = "translation_enabled"


def _result_to_response(result: service.TranslationResult) -> TranslateResponse:
    return TranslateResponse(
        direction=result.direction,
        tribe=result.tribe_full_name,
        tribeSlug=result.tribe_slug,
        sourceText=result.source_text,
        translation=result.translation,
        matchType=result.match_type,
        confidence=result.confidence,
        tokenSide=result.token_side,
        tokens=[
            TokenOut(surface=t.surface, status=t.status, wordId=t.word_id, lemma=t.lemma,
                     gloss=t.gloss, audioFileId=t.audio_file_id, note=t.note, sentenceRef=t.sentence_ref)
            for t in result.tokens
        ],
        coverage=CoverageOut(
            total=result.coverage.total, headword=result.coverage.headword,
            attested=result.coverage.attested, derived=result.coverage.derived,
            unsupported=result.coverage.unsupported, corroboratedRatio=result.coverage.corroborated_ratio,
        ),
        warning=result.warning,
        evidence=EvidenceOut(
            sentences=[EvidenceSentenceOut(**s) for s in result.evidence_sentences],
            words=[EvidenceWordOut(**w) for w in result.evidence_words],
        ),
        notes=result.notes,
        modelUsed=result.model_used,
        elapsedMs=result.elapsed_ms,
    )


@router.post("/translate", response_model=TranslateResponse)
@limiter.limit(lambda: rate_limit_config.get_configured_rate("translation_translate", "10/minute"))
async def translate_endpoint(request: Request, body: TranslateRequest, db: Session = Depends(get_db)):
    if not feature_flags.is_enabled(_FEATURE_FLAG_KEY, default=True):
        return JSONResponse({"detail": "翻譯功能目前已關閉，請稍後再試"}, status_code=403)

    user = getattr(request.state, "user", None)
    uid = (user or {}).get("uid", "")

    try:
        # 檢索＋LLM 呼叫都是阻塞式操作（DB 查詢＋同步的 openai client），
        # 丟到執行緒池執行，避免卡住 event loop——跟 dictionary/search.py
        # 對 _search_multi_words 的既有作法一致。
        result = await asyncio.to_thread(service.translate, db, body.tribe, body.direction, body.text)
    except (service.UnsupportedTribeError, service.UnsupportedDirectionError) as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    except R.UnsupportedDialectError as e:
        logger.error("[translation] %s", e)
        return JSONResponse({"detail": "翻譯功能暫時無法使用，請稍後再試"}, status_code=503)
    except EnvironmentError as e:
        # 缺 ANTHROPIC_API_KEY，比照 AIModel/views.py 的既有處理：只讓這個功能
        # 回 503，不影響其他不相關的端點。
        return JSONResponse({"detail": str(e)}, status_code=503)
    except Exception:
        # 原始例外訊息（可能含 LLM API 回應細節、內部路徑）只記 log，不回給
        # client，比照 AIModel/views.py 對 tayal_chat 的既有處理。
        logger.error("[translation] 處理失敗\n%s", request.url, exc_info=True)
        return JSONResponse({"detail": "翻譯服務暫時無法回應，請稍後再試"}, status_code=502)

    usage_events.record_event(
        "translation_request", uid=uid, tribe=body.tribe,
        payload={
            "direction": result.direction, "matchType": result.match_type,
            "corroboratedRatio": round(result.coverage.corroborated_ratio, 3),
            "modelUsed": result.model_used,
        },
    )

    return _result_to_response(result)


@router.get("/capabilities", response_model=CapabilitiesResponse)
@limiter.limit(lambda: rate_limit_config.get_configured_rate("translation_capabilities", "60/minute"))
async def capabilities_endpoint(request: Request, db: Session = Depends(get_db)):
    try:
        stats = await asyncio.to_thread(R.get_all_capability_stats, db)
    except R.UnsupportedDialectError as e:
        logger.error("[translation] %s", e)
        return JSONResponse({"detail": "翻譯功能暫時無法使用，請稍後再試"}, status_code=503)

    tribes = [
        TribeCapabilityOut(
            tribeSlug=t.slug, tribeName=t.full_name,
            pairCount=stats[t.slug]["pair_count"], headwordCount=stats[t.slug]["headword_count"],
            hasSentenceAudio=stats[t.slug]["has_sentence_audio"],
        )
        for t in TRIBES
    ]
    return CapabilitiesResponse(tribes=tribes)
