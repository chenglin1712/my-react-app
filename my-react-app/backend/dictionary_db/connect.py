from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool
import os

from config.debug_flag import is_debug

# 替換為實際路徑，這裡假設在同一資料夾中
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dictionary.db")

# 與 Django 共用同一份 .env：DJANGO_DEBUG=True 時才印出每一條 SQL（本機開發用），
# 正式環境（DJANGO_DEBUG=False）不印，避免拖垮效能。
_DEBUG = is_debug()

# 辭典 DB 正式環境要換成 PostgreSQL（容器檔案系統是暫時性的，SQLite 檔案撐不住
# 後台寫入需求，理由與 core/settings.py 的 DATABASES 一致）。優先讀獨立的
# DICTIONARY_DATABASE_URL（辭典可以跟 Django 預設 DB 分開一個 Postgres 執行個體
# 或分開 schema）；沒設定時退回沿用 Django 的 DATABASE_URL（兩者共用同一個
# Postgres 執行個體是最簡單的起始拓樸）；兩者都沒設定才維持原本的 SQLite 檔案，
# 本機開發、既有測試完全不受影響。
_database_url = os.getenv("DICTIONARY_DATABASE_URL") or os.getenv("DATABASE_URL")

# Render/Heroku 這類平台慣例給的是 postgres://（不是 postgresql://）。
# core/settings.py 那邊用 dj_database_url.parse() 讀，那個套件會自動把
# postgres:// 正規化成 postgresql://；這裡是直接把字串交給 SQLAlchemy 的
# create_engine()，SQLAlchemy 2.x 的 dialect 只認得 postgresql://，沒有這層
# 自動轉換，字串裡如果是 postgres:// 會在 import 這個模組時就找不到 dialect
# 而整個炸掉——必須自己在這裡正規化，不能假設兩邊的 URL parser 行為一致。
if _database_url and _database_url.startswith("postgres://"):
    _database_url = "postgresql://" + _database_url[len("postgres://"):]

_is_sqlite = _database_url is None
_engine_url = _database_url or f"sqlite:///{DB_PATH}"

# SQLite 專屬設定（check_same_thread connect_args、WAL/foreign_keys PRAGMA）只在
# 走 SQLite 分支時套用——PRAGMA 是 SQLite 獨有語法，直接對 Postgres 連線下會報錯，
# 不能只是「反正沒差就照樣執行」。
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

# 連線引擎
# 明確指定 QueuePool 大小並開啟 pool_pre_ping，取代預設值，
# 讓連線數上限、逾時秒數可依實際流量透過環境變數調整。
engine = create_engine(
    _engine_url,
    echo=_DEBUG,
    connect_args=_connect_args,
    poolclass=QueuePool,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_POOL_MAX_OVERFLOW", "20")),
    pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
    pool_pre_ping=True,
    pool_recycle=1800,
)

if _is_sqlite:
    # 啟用 SQLite Foreign Key 約束 + WAL 模式（每次連線都需要設定）
    # WAL 讓讀取不會被寫入鎖住，高流量下的排隊情況會比預設的 rollback journal 模式好很多。
    # 只在 SQLite 分支註冊這個 listener：Postgres 連線觸發 connect 事件時
    # 執行 PRAGMA 語法會直接丟例外，不能讓這個 listener 對兩種 dialect 都生效。
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.close()

# 建立 SessionLocal 工廠
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 建立 Base 類別供 model 繼承
Base = declarative_base()

# 提供 FastAPI 用來依賴注入的函式
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
