import logging
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from .routes import crawler, vision, dictionary, quiz, listening, sentence, auth
from dictionary_db.connect import SessionLocal
from .rate_limit import limiter
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

load_dotenv()

logger = logging.getLogger(__name__)

# 錯誤追蹤／告警（選用，設定 SENTRY_DSN 後才會啟用），與 Django 端
# core/settings.py 同一套邏輯與說明。未設定時完全不影響現有行為。
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration

    # SENTRY_ENVIRONMENT 沒設定時的預設值跟著 DJANGO_DEBUG 走（兩服務共用同一個
    # 旗標），跟 core/settings.py 同一套邏輯：原本這裡固定寫死 "production"，
    # 本機開發（DJANGO_DEBUG=True）測試時觸發的錯誤會被誤標成 production 事件。
    _fastapi_debug = os.getenv("DJANGO_DEBUG", "False") == "True"
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production" if not _fastapi_debug else "development"),
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            LoggingIntegration(level=None, event_level="ERROR"),
        ],
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0")),
        send_default_pii=False,
    )


def _warm_caches():
    """listening/sentence/quiz/dictionary 都用「第一次請求時全表掃描一次、之後吃快取」的策略，
    在背景執行緒預先跑一次，讓全表掃描的成本落在部署當下，
    而不是留給部署後第一批使用者的請求承擔。
    每個快取各自 try/except，避免其中一個失敗就連帶讓後面的快取都沒被預熱到。"""
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warm_caches, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# 允許的來源：從 .env 的 ALLOWED_ORIGINS 讀取（逗號分隔），開發預設允許 localhost。
# 用 `os.getenv(key) or default` 而非 `os.getenv(key, default)`：後者的 default 只有在
# key 完全沒出現在環境變數裡才生效，.env 留空字串（.env.example 的範本狀態）一樣算「有出現」，
# 會變成空白名單擋掉所有跨來源請求。跟 Django 端 core/settings.py 的 ALLOWED_ORIGINS 同一套邏輯。
_raw_origins = os.getenv("ALLOWED_ORIGINS") or "http://localhost:5173,http://127.0.0.1:5173"
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
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


@app.get("/health")
def health_check():
    """給 load balancer / Kubernetes 用的健康檢查端點，不需要登入。"""
    return {"status": "ok"}


