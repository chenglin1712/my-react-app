import logging
import logging.config
import os
import random
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from .routes import crawler, vision, dictionary, quiz, listening, sentence, auth, internal, translation
from dictionary_db.connect import SessionLocal
from .rate_limit import limiter
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config.logging import get_logging_config
from config.sentry_init import init_sentry
from config.cors import get_allowed_origins

load_dotenv()

# 結構化 JSON log + rotation（見 config/logging.py），Django 端共用同一套設定
# （core/settings.py 的 LOGGING）。原本只有 run_fastapi.py 這個本機開發用的
# 啟動腳本會呼叫，正式環境直接用 `uvicorn fastAPI.main:app` 啟動時從未套用，
# 等於正式環境的 FastAPI log 全部落回 uvicorn 預設的純文字輸出（沒有 JSON
# 格式、沒有 rotation）。搬到這裡讓 main.py 本身在任何啟動方式下都會套用。
logging.config.dictConfig(get_logging_config("fastapi.log"))

logger = logging.getLogger(__name__)

# 錯誤追蹤／告警（選用，設定 SENTRY_DSN 後才會啟用）。共用邏輯見
# config/sentry_init.py（Django 端 core/settings.py 呼叫同一個函式）。
def _fastapi_sentry_integrations():
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    return [StarletteIntegration(), FastApiIntegration()]


init_sentry(_fastapi_sentry_integrations)


# 部署時同時起多個 instance／worker（rolling deploy、或單純多開幾個
# uvicorn worker），全部在同一瞬間對辭典 DB 做全表掃描，會疊加成一次尖峰
# 負載。listening/sentence/quiz/dictionary 這四個快取都是 process-local
# 的純 Python 記憶體結構（見各自 warm_cache() 的實作），不是跨 process
# 共用的快取，沒辦法真的做到「只熱一次」——每個 process 本來就需要自己那份
# 記憶體副本。能做、且不需要引入共享快取／協調服務這種更大架構改動的，是
# 加一點隨機延遲把「大家幾乎同時熱」錯開成「大家在一個小時間窗內分散著
# 熱」，降低尖峰負載（P4 review BE-24）。0 代表關閉 jitter（例如本機開發
# 單一 process 時不需要）。
_WARM_CACHE_JITTER_MAX_SECONDS = float(os.getenv("WARM_CACHE_JITTER_MAX_SECONDS", "5"))


def _warm_caches(app: FastAPI):
    """listening/sentence/quiz/dictionary 都用「第一次請求時全表掃描一次、之後吃快取」的策略，
    在背景執行緒預先跑一次，讓全表掃描的成本落在部署當下，
    而不是留給部署後第一批使用者的請求承擔。
    每個快取各自 try/except，避免其中一個失敗就連帶讓後面的快取都沒被預熱到。

    完成後（不管每個快取各自成功或失敗）把 app.state.caches_warm 設成
    True，給 /ready 讀取——/health 只代表「process 活著、能回應 HTTP」
    （liveness），不代表關鍵資料已經預熱完成；冷啟動當下如果 load balancer
    只看 /health 就開始導流量，最早幾個使用者請求仍然會撞上未預熱的全表
    掃描慢路徑。/ready 讓 load balancer 可以選擇在這段期間暫緩導流量進來
    （readiness，見規劃文件 P4 review BE-24）。"""
    if _WARM_CACHE_JITTER_MAX_SECONDS > 0:
        time.sleep(random.uniform(0, _WARM_CACHE_JITTER_MAX_SECONDS))

    db = SessionLocal()
    try:
        for name, warm in (
            ("listening", listening.warm_cache),
            ("sentence", sentence.warm_cache),
            ("quiz", quiz.warm_cache),
            ("dictionary", dictionary.warm_cache),
        ):
            try:
                warm(db)
            except Exception:
                logger.exception("%s 快取預熱失敗", name)
    finally:
        db.close()
    app.state.caches_warm = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.caches_warm = False
    warm_thread = threading.Thread(target=_warm_caches, args=(app,), daemon=True)
    warm_thread.start()
    try:
        yield
    finally:
        # daemon thread 在 process 結束時會被直接砍掉，不需要（也不應該）
        # 卡住整個關閉流程等它跑完——_warm_caches() 全程唯讀，被砍掉不會留下
        # 沒收尾的寫入或半完成的資料，實際等待也幫不上忙（process 都要結束
        # 了，等完也沒有意義再繼續用這份快取）。這裡刻意不 join()：早期版本
        # 用 join(timeout=2) 阻塞關閉流程，結果讓每一次
        # `with TestClient(app):` 進出（測試套件裡非常頻繁）都多付出最多
        # 2 秒的關閉延遲，249 個 FastAPI 測試從 13 秒變成近 2 分鐘。只用
        # is_alive() 做非阻塞檢查＋記錄，一樣能在事後從 log 判斷某次啟動是
        # 不是根本沒預熱完就被關掉，不需要真的等它。
        if warm_thread.is_alive():
            logger.warning("服務關閉時快取預熱執行緒仍未完成，可能被中斷")


app = FastAPI(lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """P4 review BE-28：vision.py／quiz/api.py／dictionary/search.py 原本
    各自在每個端點重複同一段「except Exception: log + 回傳通用 500」樣板。
    集中改成這一個全域 handler：端點不再需要自己包這段收尾，沒被端點內部
    明確攔截的例外一律落到這裡記 log、回傳通用訊息。

    HTTPException／RateLimitExceeded 不受影響——Starlette 比對 exception
    handler 時會依 exception 的 MRO 找最明確對應的那一個，這兩個各自有
    專屬 handler（FastAPI 內建的 HTTPException handler、上面剛註冊的
    RateLimitExceeded handler），永遠會比這裡的 Exception handler 先命中。"""
    logger.exception("未預期的例外：%s %s", request.method, request.url.path)
    return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)

# 允許的來源：讀取/預設值邏輯見 config/cors.py（跟 Django 端 core/settings.py
# 的 CORS_ALLOWED_ORIGINS 共用同一份，避免兩邊各自維護一份一模一樣的寫法）。
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# /vision、/dictionary、/quiz、/listening、/sentence 會被呼叫付費 API（Google Vision）
# 或消耗運算資源（wav2vec2 語音比對、辭典全表查詢、題目生成全表掃描），一律要求登入才能呼叫。
_require_login = [Depends(auth.verify_firebase_token)]

app.include_router(crawler.router, prefix="/api/v1/crawler", dependencies=_require_login)
app.include_router(vision.router, prefix="/api/v1/vision", dependencies=_require_login)
app.include_router(dictionary.router, prefix="/api/v1/dictionary", dependencies=_require_login)
app.include_router(quiz.router, prefix="/api/v1/quiz", dependencies=_require_login)
app.include_router(listening.router, prefix="/api/v1/listening", dependencies=_require_login)
app.include_router(sentence.router, prefix="/api/v1/sentence", dependencies=_require_login)
# 族語翻譯：跟上面幾個路由同理，會呼叫付費 LLM，要求登入才能呼叫。沒有
# warm_cache 要掛進 _warm_caches()——這個功能直接查 PostgreSQL 的 pg_trgm
# 索引，不維護任何應用層側索引（見 routes/translation/__init__.py 的說明）。
app.include_router(translation.router, prefix="/api/v1/translation", dependencies=_require_login)

# 服務對服務的內部端點（目前只有辭典快取失效通知）：刻意不掛 _require_login
# ——Django 呼叫端沒有使用者 Firebase token 可以附，改用共用密鑰驗證（見
# routes/internal.py 的 _check_internal_secret），也刻意掛在 /internal 而不是
# /api/v1，避免看起來像公開 API。
app.include_router(internal.router, prefix="/internal")


@app.get("/health")
def health_check():
    """存活探測（liveness probe）：process 活著、能回應 HTTP 就算通過，
    不代表關鍵資料（辭典/測驗/聽力/句型快取）已經預熱完成——要知道是不是
    真的「準備好承接流量」，見下面的 /ready（P4 review BE-24）。"""
    return {"status": "ok"}


@app.get("/ready")
def readiness_check():
    """就緒探測（readiness probe）：關鍵資料是否已經預熱完成，讓 load
    balancer 可以選擇在「process 活著但還沒真正準備好」的這段期間暫緩導
    流量進來，不需要讓冷啟動當下最早幾個使用者請求承擔全表掃描的延遲
    （P4 review BE-24）。不需要登入，跟 /health 同一種公開探測端點性質。"""
    ready = getattr(app.state, "caches_warm", False)
    return JSONResponse({"ready": ready}, status_code=200 if ready else 503)


