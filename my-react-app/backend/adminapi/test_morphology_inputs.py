"""adminapi/morphology_inputs.py：形態分析共用的資料載入，以及 build_morphology_rules 改用它之後的行為。

重構的驗證分兩層：
1. 這裡的單元測試鎖住載入的每個細節（正規化、去重、只取有標註詞根的列、全名當族語欄位、不可變）；
2. 重構當時另外用本機 PostgreSQL 的真實辭典驗證過：重構前後各跑一次校準指令，輸出的放行檔逐位元組
   相同，而且與已提交的 morphology_rules.json 也逐位元組相同。
"""
import io
import json
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from adminapi import morphology_inputs as MI
from config import morphology as M
from config.tribes import TRIBES
from dictionary_db.model import Base, GrammarAffix, Tribe, TranslationAttestedForm, Word

KAV = next(t for t in TRIBES if t.slug == "kavalan")
AMIS = next(t for t in TRIBES if t.slug == "amis")


def _session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed(db):
    for t in (KAV, AMIS):
        db.add(Tribe(id=t.id, name=t.full_name, slug=t.slug))
    words = [
        ("w1", KAV, "Mafilo", "filo"),          # 大小寫會被正規化成 mafilo
        ("w2", KAV, "mafilo", "filo"),          # 同形異義：重複詞形
        ("w3", KAV, "balay", None),             # 沒有詞根標註
        ("w4", KAV, "qaniq", "   "),            # 只有空白的詞根標註：不算
        ("w5", KAV, "", "xx"),                  # 空詞條名：不進詞庫，但有詞根標註列
        ("w6", KAV, None, None),                # 沒有名稱
        ("w7", AMIS, "maala", "ala"),           # 另一個族語：不能混進來
    ]
    for wid, tribe, name, root in words:
        db.add(Word(id=wid, tribe_id=tribe.id, name=name, derivative_root=root))
    db.add(TranslationAttestedForm(tribe_id=KAV.id, surface_form_norm="mafilo", source_sentence_id=None))
    db.add(TranslationAttestedForm(tribe_id=KAV.id, surface_form_norm="pafilo", source_sentence_id=None))
    db.add(TranslationAttestedForm(tribe_id=AMIS.id, surface_form_norm="zzz", source_sentence_id=None))
    db.add(GrammarAffix(tribe_id=KAV.id, affix="ma-", affix_type="prefix", function="主事"))
    db.add(GrammarAffix(tribe_id=AMIS.id, affix="pa-", affix_type="prefix", function="使役"))
    db.commit()


class LoadTribeInputsTests(SimpleTestCase):
    def setUp(self):
        self.db = _session()
        _seed(self.db)
        self.addCleanup(self.db.close)

    def test_lexicon_is_normalized_deduplicated_and_without_empty_entries(self):
        inputs = MI.load_tribe_inputs(self.db, KAV)
        self.assertEqual(inputs.lexicon_set, frozenset({"mafilo", "balay", "qaniq"}))

    def test_word_row_count_is_the_raw_row_count_of_this_tribe_only(self):
        self.assertEqual(MI.load_tribe_inputs(self.db, KAV).word_row_count, 6)
        self.assertEqual(MI.load_tribe_inputs(self.db, AMIS).word_row_count, 1)

    def test_pair_rows_only_include_annotated_rows_and_use_the_full_tribe_name(self):
        inputs = MI.load_tribe_inputs(self.db, KAV)
        self.assertEqual(sorted(inputs.pair_rows), sorted([
            (KAV.full_name, "Mafilo", "filo"), (KAV.full_name, "mafilo", "filo"), (KAV.full_name, "", "xx"),
        ]))
        self.assertTrue(all(row[0] == KAV.full_name for row in inputs.pair_rows))   # 不是 slug

    def test_attested_and_affix_rows_belong_to_the_tribe(self):
        inputs = MI.load_tribe_inputs(self.db, KAV)
        self.assertEqual(inputs.attested, frozenset({"mafilo", "pafilo"}))
        self.assertEqual(list(inputs.affix_rows), [{"affix": "ma-", "function": "主事"}])
        other = MI.load_tribe_inputs(self.db, AMIS)
        self.assertEqual(other.attested, frozenset({"zzz"}))
        self.assertEqual(list(other.affix_rows), [{"affix": "pa-", "function": "使役"}])

    def test_build_pairs_is_the_shared_implementation_and_merges_homographs(self):
        inputs = MI.load_tribe_inputs(self.db, KAV)
        pairs, dropped = inputs.build_pairs()
        expected_pairs, expected_dropped = M.build_pairs(inputs.pair_rows)
        self.assertEqual(pairs, expected_pairs)
        self.assertEqual(dropped, expected_dropped)
        self.assertEqual([(p.tribe, p.derived, p.roots) for p in pairs], [(KAV.full_name, "mafilo", ("filo",))])
        self.assertEqual(dropped["bad_derived"], 1)                                 # 空詞條名那一列

    def test_the_snapshot_is_immutable(self):
        inputs = MI.load_tribe_inputs(self.db, KAV)
        with self.assertRaises(AttributeError):
            inputs.lexicon_set.add("x")
        with self.assertRaises(AttributeError):
            inputs.attested.add("x")
        with self.assertRaises(TypeError):
            inputs.pair_rows[0] = ("a", "b", "c")
        with self.assertRaises(Exception):
            inputs.word_row_count = 0

    def test_a_tribe_without_any_data_loads_as_empty_not_as_an_error(self):
        other = next(t for t in TRIBES if t.slug == "paiwan")
        inputs = MI.load_tribe_inputs(self.db, other)
        self.assertEqual((inputs.word_row_count, len(inputs.lexicon_set), len(inputs.attested)), (0, 0, 0))
        self.assertEqual(inputs.pair_rows, ())

    def test_tribe_row_name_distinguishes_a_missing_tribe_from_an_empty_one(self):
        self.assertEqual(MI.tribe_row_name(self.db, KAV), KAV.full_name)
        self.assertIsNone(MI.tribe_row_name(self.db, next(t for t in TRIBES if t.slug == "paiwan")))


class BuildCommandStillBehavesTests(SimpleTestCase):
    """校準指令改用共用載入器之後的行為：決定性、--tribe 只更新指定族語、不寫檔時不寫檔。"""

    def _run(self, *args):
        db = _session()
        _seed(db)
        out = io.StringIO()
        with mock.patch("adminapi.management.commands.build_morphology_rules.SessionLocal", return_value=db):
            call_command("build_morphology_rules", *args, stdout=out)
        return out.getvalue()

    def test_without_write_nothing_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "rules.json"
            text = self._run("--output", str(target))
            self.assertFalse(target.exists())
            self.assertIn("沒有寫入任何檔案", text)

    def test_two_runs_produce_identical_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / "a.json", Path(tmp) / "b.json"
            self._run("--write", "--output", str(a))
            self._run("--write", "--output", str(b))
            self.assertEqual(a.read_bytes(), b.read_bytes())
            data = json.loads(a.read_text(encoding="utf-8"))
            self.assertEqual(sorted(data["tribes"]), sorted(t.slug for t in TRIBES))

    def test_fingerprints_in_the_artifact_come_from_the_shared_loader(self):
        from config import morphology_calibration as C
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "a.json"
            self._run("--write", "--output", str(target), "--tribe", "kavalan")
            entry = json.loads(target.read_text(encoding="utf-8"))["tribes"]["kavalan"]
        db = _session()
        _seed(db)
        inputs = MI.load_tribe_inputs(db, KAV)
        self.assertEqual(entry["fingerprint"]["headwords_sha256"], C.headword_fingerprint(inputs.lexicon_set))
        self.assertEqual(entry["fingerprint"]["pairs_sha256"], C.pairs_fingerprint(inputs.build_pairs()[0]))
        self.assertEqual(entry["fingerprint"]["n_headwords"], len(inputs.lexicon_set))

    def test_single_tribe_run_keeps_the_other_tribes_from_the_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "rules.json"
            self._run("--write", "--output", str(target))
            before = json.loads(target.read_text(encoding="utf-8"))
            marker = dict(before["tribes"]["amis"], reason="sentinel")
            before["tribes"]["amis"] = marker
            target.write_text(json.dumps(before), encoding="utf-8")
            self._run("--write", "--output", str(target), "--tribe", "kavalan")
            after = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(after["tribes"]["amis"]["reason"], "sentinel")           # 沒被覆蓋
            self.assertEqual(after["tribes"]["kavalan"], before["tribes"]["kavalan"])  # 重算結果相同

    def test_unknown_tribe_is_a_command_error(self):
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            self._run("--tribe", "klingon")


class ReportInputsCommandTests(SimpleTestCase):
    """report_morphology_inputs：唯讀、決定性、能分辨新舊。"""

    def _collect(self, db, path):
        from adminapi.management.commands.report_morphology_inputs import collect
        return collect(db, path)

    def _artifact_for(self, tmp, db, mutate=None):
        from config import morphology_calibration as C
        target = Path(tmp) / "rules.json"
        with mock.patch("adminapi.management.commands.build_morphology_rules.SessionLocal", return_value=db):
            call_command("build_morphology_rules", "--write", "--output", str(target), stdout=io.StringIO())
        if mutate:
            data = json.loads(target.read_text(encoding="utf-8"))
            mutate(data)
            target.write_text(json.dumps(data), encoding="utf-8")
        return target

    def test_fresh_artifact_matches_and_reports_counts(self):
        db = _session(); _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            report = self._collect(db, self._artifact_for(tmp, db))
        kav = next(r for r in report["tribes"] if r["tribe"] == "kavalan")
        self.assertEqual((kav["headwords_match"], kav["pairs_match"]), (True, True))
        self.assertEqual((kav["now"]["n_word_rows"], kav["now"]["n_headwords"], kav["now"]["n_attested"]), (6, 3, 2))
        self.assertTrue(kav["tribe_in_database"])

    def test_changed_dictionary_is_reported_as_stale(self):
        db = _session(); _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact_for(tmp, db)
            db.add(Word(id="w99", tribe_id=KAV.id, name="newword", derivative_root=None)); db.commit()
            kav = next(r for r in self._collect(db, path)["tribes"] if r["tribe"] == "kavalan")
        self.assertEqual((kav["headwords_match"], kav["pairs_match"]), (False, True))   # 新詞沒有詞根標註，配對不變

    def test_missing_tribe_entry_is_none_not_false(self):
        db = _session(); _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact_for(tmp, db, lambda d: d["tribes"].pop("kavalan"))
            kav = next(r for r in self._collect(db, path)["tribes"] if r["tribe"] == "kavalan")
        self.assertEqual((kav["artifact"], kav["headwords_match"], kav["pairs_match"]), (None, None, None))

    def test_unreadable_artifact_is_reported_not_raised(self):
        db = _session(); _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.json"; bad.write_text("{not json", encoding="utf-8")
            report = self._collect(db, bad)
        self.assertIsNotNone(report["artifact_error"])
        self.assertTrue(all(r["headwords_match"] is None for r in report["tribes"]))

    def test_matching_fingerprints_do_not_imply_loadable(self):
        # 指紋一致、但放行檔標示最終測試未通過：報表必須說「不可載入」，而不是只看指紋
        db = _session(); _seed(db)

        def break_gate(d):
            for entry in d["tribes"].values():
                entry["enabled"] = True
                entry["final_test"] = {"passed": False, "failed_checks": ["x"]}
        with tempfile.TemporaryDirectory() as tmp:
            kav = next(r for r in self._collect(db, self._artifact_for(tmp, db, break_gate))["tribes"] if r["tribe"] == "kavalan")
        self.assertEqual((kav["headwords_match"], kav["pairs_match"]), (True, True))
        self.assertFalse(kav["loadable"])
        self.assertIn("最終測試", kav["loadable_reason"])

    def test_artifact_error_does_not_leak_the_path(self):
        db = _session(); _seed(db)
        report = self._collect(db, Path("/no/such/dir/secret-name.json"))
        self.assertNotIn("secret-name", json.dumps(report))
        self.assertEqual(report["artifact_error"], "FileNotFoundError")

    def test_command_is_read_only_and_deterministic(self):
        db = _session(); _seed(db)
        with tempfile.TemporaryDirectory() as tmp:
            path = self._artifact_for(tmp, db)
            before = path.read_bytes()
            outs = []
            for _ in range(2):
                buf = io.StringIO()
                with mock.patch("adminapi.management.commands.report_morphology_inputs.SessionLocal", return_value=db):
                    call_command("report_morphology_inputs", "--json", "--artifact", str(path), stdout=buf)
                outs.append(buf.getvalue())
            self.assertEqual(outs[0], outs[1])
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["rules.json"])   # 沒有產生任何其他檔案
        self.assertEqual(json.loads(outs[0])["tribes"][0]["tribe"], TRIBES[0].slug)         # 固定順序＝TRIBES 順序
