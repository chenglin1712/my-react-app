from contextlib import contextmanager

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


@contextmanager
def dictionary_write_session():
    """後台管理系統（P4 辭典管理）寫入辭典 DB 用的 session。

    在這之前，這個模組唯一的消費模式是唯讀（FastAPI 的 get_db() 依賴注入、
    AIModel/views.py 與 CrosswordPuzzle/views.py 手動 open/close），沒有任何
    一處呼叫過 db.commit()。P4 是第一個寫入者，這裡確立寫入慣例：成功才
    commit，任何例外一律先 rollback 再往外拋，最後一定 close——刻意維持
    跟既有唯讀消費者「db = SessionLocal() / try / finally: db.close()」相同的
    外觀（只是多了 commit/rollback），讓看過既有讀取寫法的人能立刻認出來。

    不用 `with SessionLocal() as db, db.begin():`：Session.begin() 在同一個
    session 已經隱含開始交易時會丟 InvalidRequestError，這個陷阱不該出現在
    唯一會修改一張 21 萬列資料表的程式路徑裡。

    呼叫端要做列鎖（例如更新/刪除一筆詞條前）可在拿到 db 後自行
    `.with_for_update()`——SQLite（本機開發/測試）會靜默忽略、不是真的鎖列，
    正式環境的 Postgres 才會是真正的列鎖，這個差異在呼叫端加註解說明，
    不在這裡假裝兩者行為一致。
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
