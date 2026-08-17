"""發音比對端點——薄薄一層路由組裝，實際邏輯都在 audio_fetch.py（音檔
下載）跟 model.py（音檔轉向量、相似度計算）。"""
import asyncio
import re

from fastapi import APIRouter, File, Form, Request, UploadFile

from fastAPI import game_config, rate_limit_config
from fastAPI.rate_limit import limiter

from . import model
from .audio_fetch import _is_allowed_reference_url, fetch_audio_from_id
from .model import bytes_to_tensor, convert_to_wav, get_wav2vec2, _get_embedding, _score_from_bytes

import httpx

router = APIRouter()


def make_error(step: str, msg: str):
    """統一錯誤輸出格式"""
    return {
        "success": False,
        "error_step": step,
        "error": msg
    }


@router.post("/compare_audio/")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute"))  # CPU 密集的 wav2vec2 推論 + 對外下載，每用戶每分鐘最多 20 次（後台可調）
async def compare_audio(
    request: Request,
    user_audio: UploadFile = File(...),
    audio_id: str = Form(...),
    reference_urls: str = Form(default=""),   # 逗號分隔的 Firebase Storage 公開 URL
):
    if not model._ffmpeg_path:
        return make_error("ffmpeg_missing", "伺服器未安裝 ffmpeg，語音比對功能暫時無法使用")

    # audio_id 會直接拼接進下載 URL（fetch_audio_from_id），先驗證格式避免路徑遍歷／SSRF
    if not re.match(r'^[a-zA-Z0-9._-]+$', audio_id):
        return make_error("invalid_audio_id", "audio_id 格式不合法")

    game_config.refresh_game_config_if_stale()
    max_audio_bytes = game_config.PRONUNCIATION_MAX_AUDIO_MB * 1024 * 1024

    try:
        # Step A — 讀取使用者錄音
        try:
            user_bytes = await user_audio.read()
        except Exception as e:
            return make_error("read_user_audio", str(e))

        if len(user_bytes) > max_audio_bytes:
            return make_error("file_too_large", f"音檔不得超過 {game_config.PRONUNCIATION_MAX_AUDIO_MB} MB")

        # Step B — 使用者錄音轉 WAV + 取得嵌入
        # 以下都是同步、CPU 密集或（下載官方音檔時）阻塞式 I/O，用 asyncio.to_thread
        # 丟到執行緒池執行，避免卡住 event loop、拖慢同一 worker 上的其他請求。
        try:
            user_wav = await asyncio.to_thread(convert_to_wav, user_bytes)
            user_wave, _ = await asyncio.to_thread(bytes_to_tensor, user_wav)
        except Exception as e:
            return make_error("convert_user_to_wav", str(e))

        try:
            wav2vec2_model = await asyncio.to_thread(get_wav2vec2)
            user_emb = await asyncio.to_thread(_get_embedding, wav2vec2_model, user_wave)
        except Exception as e:
            return make_error("user_embedding", str(e))

        # Step C — 官方音檔比對
        try:
            target_bytes = await asyncio.to_thread(fetch_audio_from_id, audio_id)
        except Exception as e:
            return make_error("download_target", str(e))

        try:
            official_score = await asyncio.to_thread(_score_from_bytes, wav2vec2_model, user_emb, target_bytes)
        except Exception as e:
            return make_error("official_similarity", str(e))

        # Step D — 真人參考音檔比對（Firebase Storage 公開 URL，用 httpx 非同步抓取）
        best_ref_score = None
        if reference_urls.strip():
            urls = [u.strip() for u in reference_urls.split(",") if u.strip()][:5]
            # follow_redirects=False：即使初始網址通過白名單，也不能放行伺服器端重導向，
            # 否則白名單可被「先指到合法網域、再 302 到內網位址」繞過（redirect-based SSRF）。
            # Firebase Storage 下載網址本來就是直接回傳檔案內容，不需要重導向。
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                for url in urls:
                    if not _is_allowed_reference_url(url):
                        continue
                    try:
                        resp = await client.get(url)
                        if resp.is_redirect:
                            continue
                        ref_score = await asyncio.to_thread(_score_from_bytes, wav2vec2_model, user_emb, resp.content)
                        if best_ref_score is None or ref_score > best_ref_score:
                            best_ref_score = ref_score
                    except Exception:
                        continue

        # Step E — 取最終分數（有真人音檔則取兩者最高）
        final_score = official_score
        if best_ref_score is not None:
            final_score = max(official_score, best_ref_score)

        return {
            "success": True,
            "score": final_score,
            "official_score": official_score,
            "ref_score": best_ref_score,
            "passed": final_score >= game_config.PRONUNCIATION_PASS_THRESHOLD,
            # 優/良/待加強三級門檻——原本完全在前端寫死（pronunciation_game.jsx
            # 的 RATING()），這裡隨分數一起回傳，前端改用這份值當顯示依據。
            "rating_thresholds": {
                "excellent": game_config.PRONUNCIATION_EXCELLENT_THRESHOLD,
                "good": game_config.PRONUNCIATION_GOOD_THRESHOLD,
                "fair": game_config.PRONUNCIATION_FAIR_THRESHOLD,
            },
        }

    except Exception as e:
        return make_error("unknown_error", str(e))
