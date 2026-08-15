import logging
import logging.config
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
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
    """給 load balancer / Kubernetes 用的健康檢查端點，不需要登入。"""
    return {"status": "ok"}


