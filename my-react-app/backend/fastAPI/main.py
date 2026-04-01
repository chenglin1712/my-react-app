from fastapi import FastAPI
from .routes import crawler, vision, dictionary, quiz
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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

app.include_router(crawler.router, prefix="/crawler")
app.include_router(vision.router, prefix="/vision")
app.include_router(dictionary.router, prefix="/dictionary")
app.include_router(quiz.router, prefix="/quiz")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/dictionary/static", StaticFiles(directory=STATIC_DIR), name="static")

