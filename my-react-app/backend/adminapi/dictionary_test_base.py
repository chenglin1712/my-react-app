"""P4 辭典管理測試共用的 dictionary_db 測試基底。

刻意不叫 test_*.py（Django 的測試探索預設抓 test*.py 樣式，這個檔案本身
沒有任何 TestCase，取這個名字只是避免混淆——它是給其他 test_dictionary_*.py
import 用的工具模組，不是測試本身）。

辭典資料庫是 SQLAlchemy 直連、不受 Django 測試框架的交易管轄的第二個
資料庫。沒有這層設定，測試會直接寫進開發機上真正的
backend/dictionary_db/dictionary.db（本機約 3 萬筆真實資料）。

比照既有 fastAPI/tests/test_alembic_baseline.py 建立暫存 SQLite engine、
重新綁定 SessionLocal 的做法，差別是這裡用 Base.metadata.create_all()
直接從 model 定義建表（快、且明確只測 model.py 定義的 schema），
alembic migration 本身是否跟 model.py 同步交給既有的 test_alembic_baseline.py
負責，不在這裡重複驗證。
"""
import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase
from sqlalchemy import create_engine, event

from dictionary_db import connect as connect_module
from dictionary_db import model as m


class DictionaryDbTestCase(TestCase):
    """繼承這個類別的測試，dictionary_db.connect.SessionLocal 在整個測試類別
    執行期間都會指向一個乾淨的暫存 SQLite 檔案，每個測試方法之間互相隔離
    （setUp 清空全部資料表，不是整個重建 engine——重建 engine 成本較高，
    清表就足夠隔離）。"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._tmpdir = tempfile.mkdtemp()
        cls._test_engine = create_engine(
            f"sqlite:///{cls._tmpdir}/test_dictionary.db",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(cls._test_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.close()

        m.Base.metadata.create_all(cls._test_engine)

        # SessionLocal 是模組層級的單例，adminapi.dictionary_write 等模組
        # 早就 `from dictionary_db.connect import SessionLocal` 拿到同一個
        # 物件參照——直接把 connect_module.SessionLocal 換成新物件不會影響
        # 那些已經匯入的參照，必須用 sessionmaker.configure(bind=...)
        # 就地重新綁定同一個物件的 engine，其他模組手上的參照才會跟著改變。
        cls._original_engine = connect_module.engine
        connect_module.engine = cls._test_engine
        connect_module.SessionLocal.configure(bind=cls._test_engine)

    @classmethod
    def tearDownClass(cls):
        connect_module.SessionLocal.configure(bind=cls._original_engine)
        connect_module.engine = cls._original_engine
        cls._test_engine.dispose()
        shutil.rmtree(cls._tmpdir, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        # 每個測試方法之間清空全部資料表（照 FK 相依順序反向刪除，避免
        # 違反約束），比重建整個 engine 便宜很多。
        db = connect_module.SessionLocal()
        try:
            for table in reversed(m.Base.metadata.sorted_tables):
                db.execute(table.delete())
            db.commit()
        finally:
            db.close()

        # 核准/合併/匯入這些動作核准後都會呼叫 invalidate_dictionary_cache()
        # 打真實的 requests.post 到 FastAPI（見 dictionary_cache.py）。測試
        # 環境沒有真的跑 FastAPI，這個呼叫本來就會失敗——safe_* 精神保證失敗
        # 不影響操作結果（已有 test_dictionary_cache.py 專門驗證這件事），
        # 但放著不管會讓每個核准類測試多等連線逾時的時間、log 也會被一大包
        # traceback 洗版。這裡統一 patch 掉，跟這個檔案本身要測的行為無關。
        patcher = patch("adminapi.dictionary_cache.requests.post")
        self.addCleanup(patcher.stop)
        patcher.start()

    def seed_tribe(self, tribe_id="tribe-tayal", name="泰雅語", slug="tayal"):
        db = connect_module.SessionLocal()
        try:
            db.add(m.Tribe(id=tribe_id, name=name, slug=slug))
            db.commit()
        finally:
            db.close()
        return tribe_id

    def seed_word(self, word_id="word-1", tribe_id="tribe-tayal", name="abas", **extra):
        db = connect_module.SessionLocal()
        try:
            db.add(m.Word(id=word_id, tribe_id=tribe_id, name=name, **extra))
            db.commit()
        finally:
            db.close()
        return word_id
