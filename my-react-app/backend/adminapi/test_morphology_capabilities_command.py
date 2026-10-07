"""report_morphology_capabilities 指令：格式、決定性、原子寫入、唯讀。數字定義本身的測試在 fastAPI/tests/test_morphology_reporting.py。"""
import io
import json
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from adminapi.test_morphology_inputs import _seed, _session
from config.tribes import TRIBES

CAP = "adminapi.management.commands.report_morphology_capabilities.SessionLocal"
INP = "adminapi.management.commands.report_morphology_inputs.SessionLocal"
BUILD = "adminapi.management.commands.build_morphology_rules.SessionLocal"


class CapabilityReportCommandTests(SimpleTestCase):
    def _run(self, db, *args):
        buf = io.StringIO()
        with mock.patch(CAP, return_value=db), mock.patch(INP, return_value=db):
            call_command("report_morphology_capabilities", *args, stdout=buf)
        return buf.getvalue()

    def _artifact(self, tmp, db):
        target = Path(tmp) / "rules.json"
        with mock.patch(BUILD, return_value=db):
            call_command("build_morphology_rules", "--write", "--output", str(target), stdout=io.StringIO())
        return target

    def test_all_formats_render_and_json_is_deterministic(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(self._artifact(tmp, db))
            first = self._run(db, "--format", "json", "--artifact", path)
            self.assertEqual(first, self._run(db, "--format", "json", "--artifact", path))
            data = json.loads(first)
            self.assertEqual([t["tribe"] for t in data["tribes"]], [t.slug for t in TRIBES])
            csv_text = self._run(db, "--format", "csv", "--artifact", path)
            header = csv_text.splitlines()[0].split(",")
            self.assertIn("tribe,input_freshness", csv_text)
            for name in ("release_rate", "precision", "wrong_root_rate", "false_accept_stem", "false_accept_rand"):
                for part in ("k", "n", "value", "lo", "hi"):
                    self.assertIn(f"{name}_{part}", header)
            self.assertEqual({len(line.split(",")) for line in csv_text.splitlines()}, {len(header)})
            self.assertIn("kavalan", self._run(db, "--format", "table", "--artifact", path))

    def test_output_file_is_written_atomically_and_leaves_no_temp_files(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(self._artifact(tmp, db))
            out = Path(tmp) / "report.json"
            self._run(db, "--format", "json", "--artifact", path, "--output", str(out))
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["report_version"], 1)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["report.json", "rules.json"])

    def test_missing_output_directory_is_a_command_error(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(self._artifact(tmp, db))
            with self.assertRaises(CommandError):
                self._run(db, "--artifact", path, "--output", str(Path(tmp) / "nope" / "r.json"))

    def test_failed_write_leaves_no_temp_file_and_keeps_the_old_output(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(self._artifact(tmp, db))
            out = Path(tmp) / "report.json"
            out.write_text("old", encoding="utf-8")
            with mock.patch("os.replace", side_effect=OSError("boom")):
                with self.assertRaises(CommandError):
                    self._run(db, "--format", "json", "--artifact", path, "--output", str(out))
            self.assertEqual(out.read_text(encoding="utf-8"), "old")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["report.json", "rules.json"])

    def test_output_pointing_at_a_directory_is_a_command_error_and_leaves_no_temp_file(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(self._artifact(tmp, db))
            target = Path(tmp) / "adir"
            target.mkdir()
            with self.assertRaises(CommandError):
                self._run(db, "--artifact", path, "--output", str(target))
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["adir", "rules.json"])

    def test_metrics_and_error_come_from_one_read_of_the_artifact(self):
        # 第一次讀成功之後檔案被換成壞的：報表仍用第一次的內容，error 不能出現「錯誤＋指標」的混合
        import adminapi.management.commands.report_morphology_inputs as inputs_cmd
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, db)
            real_read = inputs_cmd.artifact.read_artifact
            calls = []

            def read_then_break(p):
                calls.append(1)
                data = real_read(p)
                p.write_text("{broken", encoding="utf-8")
                return data
            with mock.patch.object(inputs_cmd.artifact, "read_artifact", side_effect=read_then_break):
                data = json.loads(self._run(db, "--format", "json", "--artifact", str(path)))
        self.assertIsNone(data["artifact_error"])
        self.assertEqual(data["tribes"][3]["layers"]["artifact_integrity"], "valid")   # kavalan，用第一次讀到的內容

    def test_the_artifact_is_read_exactly_once_for_all_tribes_and_loadable_uses_that_copy(self):
        # 讀完之後把檔案換成壞的：五族的「可載入」判斷仍要用第一次讀到的那一份，且整份報表只讀一次檔
        import adminapi.management.commands.report_morphology_inputs as inputs_cmd
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, db)
            real_read = inputs_cmd.artifact.read_artifact
            calls = []

            def read_then_break(p):
                calls.append(1)
                data = real_read(p)
                p.write_text("{broken", encoding="utf-8")
                return data
            with mock.patch.object(inputs_cmd.artifact, "read_artifact", side_effect=read_then_break):
                data = json.loads(self._run(db, "--format", "json", "--artifact", str(path)))
        self.assertEqual(len(calls), 1)
        kav = next(t for t in data["tribes"] if t["tribe"] == "kavalan")
        self.assertEqual(kav["layers"]["input_freshness"], "fresh")
        self.assertEqual(kav["layers"]["artifact_integrity"], "valid")

    def test_unreadable_artifact_marks_every_tribe_not_loadable_without_leaking_the_path(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "secret-name.json"
            data = json.loads(self._run(db, "--format", "json", "--artifact", str(missing)))
        self.assertNotIn("secret-name", json.dumps(data))
        self.assertTrue(all(t["layers"]["runtime_rebuild_loadable"] is False for t in data["tribes"]))
        self.assertEqual(data["artifact_error"], "FileNotFoundError")

    def test_command_never_touches_the_artifact(self):
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact(tmp, db)
            before = path.read_bytes()
            self._run(db, "--artifact", str(path))
            self.assertEqual(path.read_bytes(), before)

    def test_stale_artifact_is_marked_as_an_old_snapshot_in_the_table(self):
        from dictionary_db.model import Word
        db = _session()
        _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = str(self._artifact(tmp, db))
            db.add(Word(id="new1", tribe_id=TRIBES[3].id, name="brandnewword", derivative_root=None))
            db.commit()
            text = self._run(db, "--artifact", path)
        self.assertIn("舊資料快照", text)
