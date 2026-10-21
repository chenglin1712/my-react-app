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

from config.llm import classify_llm_error, current_uid as llm_current_uid
from config.tribes import TRIBES
from dictionary_db.connect import get_db
from fastAPI import feature_flags, guest_trial, rate_limit_config, usage_events
from fastAPI.rate_limit import limiter

from . import retrieve as R
from . import service
from .schemas import (
    CapabilitiesResponse, CoverageOut, EvidenceOut, EvidenceSentenceOut, EvidenceWordOut,
    GuestQuotaOut, GuestQuotaStatusResponse, TokenOut, TranslateRequest, TranslateResponse, TribeCapabilityOut,
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


def _client_ip(request: Request) -> str:
    # 正式環境 uvicorn 綁在 127.0.0.1、前面是 nginx，uvicorn 預設只信任來自本機的
    # X-Forwarded-For 並取最右邊（nginx 附加的）那一筆，client 自己偽造的左邊項目不會被採用。
    return request.client.host if request.client else ""


async def _refund_guest(quota) -> None:
    if quota is not None:
        await asyncio.to_thread(guest_trial.refund, quota)


def _guest_denied_response(quota: guest_trial.GuestQuota) -> JSONResponse:
    """訪客額度用完／服務無法使用時的回應。code 是給前端判斷用的機器可讀欄位，
    detail 是可以直接顯示給使用者看的說明（不洩漏是哪一個計數擋下的細節以外的資訊）。"""
    if quota.reason == guest_trial.SCOPE_BROWSER:
        body = {"detail": "今天的免費試用次數已用完，登入後可以繼續使用。", "code": "guest_quota_exhausted"}
        status_code = 429
    elif quota.reason == guest_trial.SCOPE_IP:
        body = {"detail": "這個網路今天的試用次數已達上限，請登入後使用。", "code": "guest_ip_capped"}
        status_code = 429
    else:
        body = {"detail": "訪客試用暫時無法使用，請登入或稍後再試。", "code": "guest_unavailable"}
        status_code = 503
    body.update({"limit": quota.limit, "resetsAt": quota.resets_at})
    return JSONResponse(body, status_code=status_code)


@router.get("/guest-quota", response_model=GuestQuotaStatusResponse)
@limiter.limit(lambda: rate_limit_config.get_configured_rate("translation_guest_quota", "60/minute"))
async def guest_quota_endpoint(request: Request):
    """訪客查詢自己今天還剩幾次（不扣次數）。已登入使用者回 isGuest=false，前端據此不顯示額度。"""
    user = getattr(request.state, "user", None) or {}
    if not user.get("guest"):
        return GuestQuotaStatusResponse(isGuest=False)
    quota = await asyncio.to_thread(guest_trial.status, user["guest_id"])
    if quota.reason == "unavailable":
        return _guest_denied_response(quota)
    return GuestQuotaStatusResponse(isGuest=True, limit=quota.limit, remaining=quota.remaining, resetsAt=quota.resets_at)


@router.post("/translate", response_model=TranslateResponse)
@limiter.limit(lambda: rate_limit_config.get_configured_rate("translation_translate", "10/minute"))
async def translate_endpoint(request: Request, body: TranslateRequest, db: Session = Depends(get_db)):
    if not feature_flags.is_enabled(_FEATURE_FLAG_KEY, default=True):
        return JSONResponse({"detail": "翻譯功能目前已關閉，請稍後再試"}, status_code=403)

    user = getattr(request.state, "user", None)
    uid = (user or {}).get("uid", "")

    # 訪客試用：先預留額度再呼叫 LLM（先扣再做，同時送出多個請求也不會超過上限）。
    # 只有「確定還沒呼叫付費 LLM」的失敗才退還（不支援的族語／方向、資料庫方言不支援、缺金鑰）；
    # LLM 可能已經計費的失敗（逾時、後處理例外等）不退，否則反覆觸發就能免費呼叫。
    quota = None
    if (user or {}).get("guest"):
        quota = await asyncio.to_thread(guest_trial.consume, user["guest_id"], _client_ip(request))
        if not quota.allowed:
            return _guest_denied_response(quota)

    # 用量紀錄要知道是誰呼叫的；asyncio.to_thread 會把 contextvars 複製到執行緒裡。
    uid_token = llm_current_uid.set(uid)

    try:
        # 檢索＋LLM 呼叫都是阻塞式操作（DB 查詢＋同步的 Anthropic client），
        # 丟到執行緒池執行，避免卡住 event loop——跟 dictionary/search.py
        # 對 _search_multi_words 的既有作法一致。
        result = await asyncio.to_thread(service.translate, db, body.tribe, body.direction, body.text)
    except (service.UnsupportedTribeError, service.UnsupportedDirectionError) as e:
        await _refund_guest(quota)
        return JSONResponse({"detail": str(e)}, status_code=400)
    except R.UnsupportedDialectError as e:
        await _refund_guest(quota)
        logger.error("[translation] %s", e)
        return JSONResponse({"detail": "翻譯功能暫時無法使用，請稍後再試"}, status_code=503)
    except EnvironmentError as e:
        # 缺 ANTHROPIC_API_KEY，比照 AIModel/views.py 的既有處理：只讓這個功能
        # 回 503，不影響其他不相關的端點。
        await _refund_guest(quota)
        return JSONResponse({"detail": str(e)}, status_code=503)
    except Exception as e:
        # 原始例外訊息（可能含 LLM API 回應細節、內部路徑）只記 log，不回給
        # client，比照 AIModel/views.py 對 tayal_chat 的既有處理。
        # 逾時／限流／斷路器開啟時回對應的狀態碼（504／429／503），其餘維持 502。
        logger.error("[translation] 處理失敗\n%s", request.url, exc_info=True)
        status_code, _ = classify_llm_error(e)
        return JSONResponse({"detail": "翻譯服務暫時無法回應，請稍後再試"}, status_code=status_code)
    finally:
        llm_current_uid.reset(uid_token)

    usage_events.record_event(
        "translation_request", uid=uid, tribe=body.tribe,
        payload={
            "direction": result.direction, "matchType": result.match_type,
            "corroboratedRatio": round(result.coverage.corroborated_ratio, 3),
            "modelUsed": result.model_used,
            **({"guest": True} if quota is not None else {}),
        },
    )

    response = _result_to_response(result)
    if quota is not None:
        response.guestQuota = GuestQuotaOut(limit=quota.limit, remaining=quota.remaining, resetsAt=quota.resets_at)
    return response


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
            tribeSlug=t.slug, tribeName=t.display_name,
            pairCount=stats[t.slug]["pair_count"], headwordCount=stats[t.slug]["headword_count"],
            hasSentenceAudio=stats[t.slug]["has_sentence_audio"],
        )
        for t in TRIBES
    ]
    return CapabilitiesResponse(tribes=tribes)
