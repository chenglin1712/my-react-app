from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool
import os

# 替換為實際路徑，這裡假設在同一資料夾中
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dictionary.db")

# 與 Django 共用同一份 .env：DJANGO_DEBUG=True 時才印出每一條 SQL（本機開發用），
# 正式環境（DJANGO_DEBUG=False）不印，避免拖垮效能。
_DEBUG = os.getenv("DJANGO_DEBUG", "False") == "True"

# 連線引擎（connect_args 是 SQLite 特有的）
# 明確指定 QueuePool 大小並開啟 pool_pre_ping，取代預設值，
# 讓連線數上限、逾時秒數可依實際流量透過環境變數調整。
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    echo=_DEBUG,
    connect_args={"check_same_thread": False},
    poolclass=QueuePool,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_POOL_MAX_OVERFLOW", "20")),
    pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
    pool_pre_ping=True,
    pool_recycle=1800,
)

# 啟用 SQLite Foreign Key 約束 + WAL 模式（每次連線都需要設定）
# WAL 讓讀取不會被寫入鎖住，高流量下的排隊情況會比預設的 rollback journal 模式好很多。
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
