import os
import sys
from logging.config import fileConfig

from dotenv import load_dotenv

from alembic import context

# backend/fastAPI/alembic/env.py -> backend/ 才是 `dictionary_db` package 的上層目錄，
# 沿用 dictionary_db.* 這種絕對 import 寫法時必須把 backend/ 加進 sys.path
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# dictionary_db.connect 在 import 當下就會讀 DICTIONARY_DATABASE_URL/DATABASE_URL
# 決定要連 SQLite 還是 Postgres（見該檔案），跟 fastAPI/main.py 一樣是獨立的
# process 進入點，不會自動繼承 Django manage.py 那邊已經載入的環境變數，必須
# 自己呼叫 load_dotenv()，否則直接執行 `alembic upgrade head` 時永遠只會連到
# 本機 SQLite 檔案，即使 .env 裡已經設定了 Postgres 連線字串。
load_dotenv()

from dictionary_db.connect import Base, engine  # noqa: E402
from dictionary_db import model  # noqa: E402,F401  # 讓所有 model 都註冊進 Base.metadata

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 直接沿用 dictionary_db.model 裡的 Base.metadata，支援 autogenerate
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    直接沿用 dictionary_db.connect.engine，確保 migration 打的
    是跟 app 執行時完全同一顆 SQLite 檔案、同一組 PRAGMA 設定。
    """
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
