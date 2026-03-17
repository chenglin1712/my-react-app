from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# 替換為實際路徑，這裡假設在同一資料夾中
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "dictionary.db")

# 連線引擎（connect_args 是 SQLite 特有的）
engine = create_engine(
    f"sqlite:///{DB_PATH}", echo=True, connect_args={"check_same_thread": False}
)

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
