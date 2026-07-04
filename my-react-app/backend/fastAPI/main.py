from fastapi import Depends, FastAPI
from .routes import crawler, vision, dictionary, quiz, listening, sentence, auth
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()

# 允許的來源：從 .env 的 ALLOWED_ORIGINS 讀取（逗號分隔），開發預設允許 localhost
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# /vision、/dictionary、/quiz 會被呼叫付費 API（Google Vision）或消耗運算資源
# （wav2vec2 語音比對、辭典全表查詢），一律要求登入才能呼叫。
_require_login = [Depends(auth.verify_firebase_token)]

app.include_router(crawler.router, prefix="/crawler")
app.include_router(vision.router, prefix="/vision", dependencies=_require_login)
app.include_router(dictionary.router, prefix="/dictionary", dependencies=_require_login)
app.include_router(quiz.router, prefix="/quiz", dependencies=_require_login)
app.include_router(listening.router, prefix="/listening")
app.include_router(sentence.router, prefix="/sentence")


