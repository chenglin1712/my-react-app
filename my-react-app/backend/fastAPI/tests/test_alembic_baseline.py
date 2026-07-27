"""驗證第 5 項稽核修正：對全新空 SQLite 資料庫執行 `alembic upgrade head` 要能
成功建出完整 schema（含新增的 baseline migration ad283d8500e4），且升級/降級/
再升級可重複執行（驗證先前 90bc362710d9 遺留的 alembic_version 版本號沒有正確
落地的 bug 已修好——該 bug 會讓第二次 `upgrade head` 誤判 migration 還沒套用而
重跑，撞上資料表已存在而失敗）。

用 monkeypatch 把 dictionary_db.connect 的 engine 換成暫存檔案，完全不會碰到
真正的 backend/dictionary_db/dictionary.db。
"""
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.pool import QueuePool

from dictionary_db import connect as connect_module

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ALEMBIC_DIR = os.path.join(BACKEND_DIR, "fastAPI", "alembic")
ALEMBIC_INI = os.path.join(BACKEND_DIR, "fastAPI", "alembic.ini")

EXPECTED_TABLES = {
    "tribe", "words", "grammar_section", "grammar_rule", "grammar_example",
    "grammar_affix", "grammar_rule_affix", "grammar_example_word",
    "source", "word_source", "word_audio", "word_explanation",
    "category", "word_explanation_category", "part_of_speech", "word_explanation_pos",
    "focus", "word_explanation_focus", "word_explanation_image",
    "word_explanation_sentence", "word_explanation_sentence_audio",
    "word_explanation_anaphora", "word_explanation_anaphora_item",
}


@pytest.fixture
def alembic_config(tmp_path, monkeypatch):
    """把 connect.py 的 engine 換成指向 tmp_path 底下全新檔案的暫存 SQLite 引擎，
    讓 alembic 的 env.py（它直接 import connect.engine）打到這個暫存資料庫。"""
    db_path = tmp_path / "test_dictionary.db"
    test_engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        poolclass=QueuePool,
    )

    @event.listens_for(test_engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    monkeypatch.setattr(connect_module, "engine", test_engine)
    connect_module.SessionLocal.configure(bind=test_engine)

    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("script_location", ALEMBIC_DIR)
    return cfg, test_engine


def test_upgrade_head_from_empty_db_creates_full_schema(alembic_config):
    cfg, engine = alembic_config

    command.upgrade(cfg, "head")

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert EXPECTED_TABLES.issubset(tables)

    with engine.connect() as conn:
        version = conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
    assert version == "90bc362710d9"


def test_upgrade_head_is_idempotent(alembic_config):
    """先前 90bc362710d9 的 bind.commit() 會讓 alembic 自己寫回的版本號被靜默
    rollback，導致第二次 upgrade head 誤判該 migration 還沒套用而重跑、撞上資料表
    已存在而失敗。這裡驗證該 bug 已修好。"""
    cfg, _ = alembic_config

    command.upgrade(cfg, "head")
    command.upgrade(cfg, "head")  # 不應該拋例外


def test_downgrade_to_base_then_upgrade_again(alembic_config):
    cfg, engine = alembic_config

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")

    inspector = inspect(engine)
    tables = set(inspector.get_table_names()) - {"alembic_version", "sqlite_sequence"}
    assert tables == set()

    command.upgrade(cfg, "head")
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert EXPECTED_TABLES.issubset(tables)
