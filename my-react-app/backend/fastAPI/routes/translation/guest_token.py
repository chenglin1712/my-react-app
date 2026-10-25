"""訪客憑證的核發端點（S-01）。

跟翻譯 router 分開掛載，因為翻譯 router 的依賴要求「已登入或持有訪客憑證」，而這支端點的用途正是
讓還沒有憑證的訪客領一張。它自己檢查訪客試用有沒有開放，並且有分鐘限流與每網路每日核發上限。
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from fastAPI import feature_flags, guest_trial, rate_limit_config
from fastAPI.rate_limit import limiter
from fastAPI.routes.auth import GUEST_FLAG_KEY

from .api import _client_ip   # 與翻譯端點共用同一個取得來源網路的方式，核發與扣額度才會算在同一個網路上
from .schemas import GuestTokenOut

router = APIRouter()


@router.post("/guest-token", response_model=GuestTokenOut)
@limiter.limit(lambda: rate_limit_config.get_configured_rate("translation_guest_token", "10/minute"))
async def guest_token_endpoint(request: Request, x_guest_token: str = Header(default=None)):
    """領取（或續期）訪客憑證。

    - 帶了仍有效的舊憑證：沿用同一個訪客代號重新簽發，不扣核發額度，當天已用的次數也不會被重置。
    - 沒有或已失效：新核發一個代號，扣這個網路今天的核發額度。
    - 訪客試用沒開放（旗標關閉、資料庫或密鑰未就緒）時回 503，前端據此不再重試。
    """
    if not feature_flags.is_enabled_fail_closed(GUEST_FLAG_KEY) or not guest_trial.is_ready():
        return JSONResponse({"detail": "訪客試用目前未開放，請登入後使用。", "code": "guest_unavailable"}, status_code=503)

    renew = guest_trial.verify_token(x_guest_token)
    result = await asyncio.to_thread(guest_trial.issue_token, _client_ip(request), None, renew)
    if not result.ok:
        if result.reason == "issue_cap":
            return JSONResponse(
                {"detail": "這個網路今天領取的試用名額已達上限，請登入後使用。", "code": "guest_issue_capped"},
                status_code=429,
            )
        return JSONResponse({"detail": "訪客試用暫時無法使用，請登入或稍後再試。", "code": "guest_unavailable"}, status_code=503)
    return GuestTokenOut(token=result.token, expiresAt=result.expires_at)
