"""辭典 SQLite 備份匯出：複製完整性、不覆蓋既有檔、失敗不留殘檔、替換前另存舊檔。"""
import sqlite3
import tempfile
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from adminapi import dictionary_sqlite_export as X
from dictionary_db.model import Base, Source, Tribe, Word, WordExplanation, WordSource


def _source_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tribe(id="t1", name="阿美語", slug="amis"))
    s.add(Source(id=4, name="學習詞表"))
    s.add_all([Word(id="w1", tribe_id="t1", name="mi", dialect="秀姑巒阿美語", frequency=3),
               Word(id="w2", tribe_id="t1", name="tu ", dialect=None)])
    s.add(WordSource(word_id="w1", source_id=4, sort_order=0))
    s.add(WordExplanation(word_id="w1", chinese_explanation="一", sort_order=0))
    s.commit()
    s.close()
    return engine


class BuildTests(SimpleTestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def test_copy_is_complete_and_verified(self):
        report = X.build_sqlite_copy(_source_engine(), self.dir / "d.db.new")
        self.assertEqual((report["tables"]["words"], report["tables"]["word_source"], report["tables"]["word_explanation"]), (2, 1, 1))
        self.assertEqual(set(report["fingerprints"]), set(report["tables"]))
        self.assertTrue(X.integrity_ok(self.dir / "d.db.new"))
        con = sqlite3.connect(self.dir / "d.db.new")
        self.assertEqual(con.execute("select name, dialect from words order by id").fetchall(), [("mi", "秀姑巒阿美語"), ("tu ", None)])  # 尾端空白、NULL 原樣
        con.close()

    def test_existing_target_is_never_overwritten(self):
        (self.dir / "d.db.new").write_bytes(b"x")
        with self.assertRaises(X.ExportError):
            X.build_sqlite_copy(_source_engine(), self.dir / "d.db.new")
        self.assertEqual((self.dir / "d.db.new").read_bytes(), b"x")

    def test_failure_leaves_no_partial_file(self):
        engine = _source_engine()
        orig = X.table_fingerprint
        X.table_fingerprint = lambda conn, t: __import__("random").random().hex()    # 兩邊算出不同值，模擬複製不一致
        try:
            with self.assertRaises(X.ExportError):
                X.build_sqlite_copy(engine, self.dir / "d.db.new")
        finally:
            X.table_fingerprint = orig
        self.assertFalse((self.dir / "d.db.new").exists())


class EncodingAndChecksTests(SimpleTestCase):
    def test_null_and_empty_string_are_distinguished(self):
        self.assertNotEqual(X._row_text(("a", None)), X._row_text(("a", "")))
        self.assertNotEqual(X._row_text(("a\x1fb", "c")), X._row_text(("a", "b\x1fc")))

    def test_all_tables_are_fingerprinted(self):
        report = X.build_sqlite_copy(_source_engine(), Path(tempfile.mkdtemp()) / "d.db.new")
        self.assertEqual(set(report["fingerprints"]), set(report["tables"]))

    def test_content_difference_in_any_table_is_detected(self):
        engine = _source_engine()
        real = X.table_fingerprint

        def tampered(conn, table):
            fp = real(conn, table)
            return fp[::-1] if table.name == "word_explanation" and conn.dialect.name == "sqlite" and getattr(conn, "_dest", False) else fp

        calls = {"n": 0}

        def flip_second_call_for_explanation(conn, table):
            fp = real(conn, table)
            if table.name == "word_explanation":
                calls["n"] += 1
                return fp if calls["n"] == 1 else "x" + fp
            return fp

        d = Path(tempfile.mkdtemp())
        with mock.patch.object(X, "table_fingerprint", flip_second_call_for_explanation):
            with self.assertRaises(X.ExportError):
                X.build_sqlite_copy(engine, d / "d.db.new")
        self.assertFalse((d / "d.db.new").exists())


class InstallTests(SimpleTestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.target = self.dir / "dictionary.db"
        self.target.write_bytes(b"OLD")
        self.new = self.dir / "dictionary.db.new"
        self.new.write_bytes(b"NEW")
        self.backup = self.dir / "backups"

    def test_old_file_saved_then_replaced(self):
        saved, warnings = X.install_backup(self.new, self.target, self.backup)
        self.assertEqual((self.target.read_bytes(), saved.read_bytes(), warnings), (b"NEW", b"OLD", []))
        self.assertFalse(self.new.exists())

    def test_stale_sidecar_files_removed_after_replace(self):
        Path(str(self.target) + "-shm").write_bytes(b"s")
        X.install_backup(self.new, self.target, self.backup)
        self.assertFalse(Path(str(self.target) + "-shm").exists())

    def test_sidecar_cleanup_failure_is_reported_as_warning_not_as_failed_install(self):
        Path(str(self.target) + "-shm").write_bytes(b"s")
        real_unlink = Path.unlink

        def boom(p, *a, **k):
            if p.name.endswith("-shm"):
                raise PermissionError("locked")
            return real_unlink(p, *a, **k)

        with mock.patch.object(Path, "unlink", boom):
            saved, warnings = X.install_backup(self.new, self.target, self.backup)
        self.assertEqual(self.target.read_bytes(), b"NEW")                    # 已經換成新檔
        self.assertEqual(len(warnings), 1)
        self.assertIn("-shm", warnings[0])

    def test_nonempty_wal_aborts_without_touching_anything(self):
        Path(str(self.target) + "-wal").write_bytes(b"pending")
        with self.assertRaises(X.ExportError):
            X.install_backup(self.new, self.target, self.backup)
        self.assertEqual((self.target.read_bytes(), self.new.read_bytes()), (b"OLD", b"NEW"))
        self.assertFalse(self.backup.exists())
