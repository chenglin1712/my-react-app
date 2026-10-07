"""千詞表對照表：解析、比對分類，以及 build_wordlist_mapping（預覽不寫、套用不碰辭典、決定的保留與過期、約束）。

限制（已知）：測試用 SQLite，驗證不了 PostgreSQL 專屬行為——advisory lock 只在 PostgreSQL 取得、varchar 長度限制
SQLite 不強制（長度改由 check_lengths 在計畫階段預檢，並有獨立測試）。
"""
import io
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from adminapi import wordlist_mapping as WM
from adminapi.models.wordlist import WordlistEntry, WordlistForm
from config.tribes import TRIBES
from dictionary_db.model import Base, Tribe, Word, WordExplanation

PAI = next(t for t in TRIBES if t.slug == "paiwan")


def _csv(rows, dialect="中排灣語", version="2026.07.22修正版"):
    lines = [f"財團法人,,{dialect},,{version},", f"{dialect},,,,,", "序號,編號,中文,族語,備註,級別", "類別,01數字計量,,,,"]
    lines += [",".join(str(x) for x in r) for r in rows]
    return "﻿" + "\n".join(lines) + "\n"


ROWS = [
    (1, "01-01", "一", "ita", "", "初級"),
    (2, "01-02", "二", "dusa/dua", "", "初級"),
    (3, "01-03", "三", "無此詞彙", "", "初級"),
    (4, "01-04", "四", "sepatj", "", "初級"),
]


def _session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(Tribe(id=PAI.id, name=PAI.full_name, slug=PAI.slug))
    db.add_all([
        Word(id="w-ita", tribe_id=PAI.id, name="ita", dialect=None),               # 唯一、未標語別 → unknown
        Word(id="w-lima", tribe_id=PAI.id, name="lima", dialect="中排灣語"),        # 唯一、明確同語別 → same
        Word(id="w-dusa-n", tribe_id=PAI.id, name="dusa", dialect="北排灣語"),      # 唯一、別的語別 → cross
        Word(id="w-dua-1", tribe_id=PAI.id, name="dua", dialect=""),               # 多筆 → manual_multiple
        Word(id="w-dua-2", tribe_id=PAI.id, name="dua", dialect=""),
        Word(id="w-sepatj", tribe_id=PAI.id, name="Sepatj ", dialect=""),          # 尾端空白、大小寫 → near_form
    ])
    db.add(WordExplanation(word_id="w-ita", chinese_explanation="一", sort_order=0))
    db.commit()
    return db


class ClassifyTests(SimpleTestCase):
    def test_every_class(self):
        snap = WM.load_snapshot(_session(), PAI.id)

        def c(f):
            return WM.classify(f, "paiwan", snap)

        self.assertEqual(c("lima").match_class, "same_dialect_unique")
        self.assertEqual(c("ita").match_class, "unknown_dialect_unique")      # 未標語別不能當同語別
        self.assertTrue(c("ita").candidates[0]["has_explanation"])
        self.assertEqual(c("dusa").match_class, "cross_dialect_unique")
        self.assertEqual((c("dua").match_class, c("dua").candidate_count), ("manual_multiple", 2))
        self.assertEqual(c("sepatj").match_class, "manual_near_form")
        self.assertEqual((c("zzz").match_class, c("zzz").candidates), ("new", []))
        self.assertEqual(c("無此詞彙").match_class, "skip_placeholder")

    def test_near_form_candidates_keep_identity_but_are_flagged(self):
        snap = WM.load_snapshot(_session(), PAI.id)
        cand = WM.classify("sepatj", "paiwan", snap).candidates[0]
        self.assertEqual((cand["word_id"], cand["near"]), ("w-sepatj", True))

    def test_fingerprint_sees_changes_beyond_the_truncated_candidates(self):
        db = _session()
        db.add_all(Word(id=f"w-many-{i:03d}", tribe_id=PAI.id, name="many", dialect="") for i in range(25))
        db.commit()
        before = WM.classify("many", "paiwan", WM.load_snapshot(db, PAI.id))
        db.query(Word).filter(Word.id == "w-many-024").update({"dialect": "北排灣語"})   # 第 25 筆（不在前 20 筆展示內）
        db.commit()
        after = WM.classify("many", "paiwan", WM.load_snapshot(db, PAI.id))
        self.assertEqual(before.candidates, after.candidates)
        self.assertNotEqual(before.fingerprint, after.fingerprint)

    def test_source_label_length_precheck(self):
        e = WM.ParsedEntry(1, "01-01", "一", "x", "", "初級", "c")
        with self.assertRaises(WM.WordlistError):
            WM.check_lengths("中排灣", e, ["x"], "v" * 100)

    def test_whitespace_is_asymmetric_by_design(self):
        snap = WM.load_snapshot(_session(), PAI.id)
        self.assertEqual(WM.classify("  ita  ", "paiwan", snap).match_class, "unknown_dialect_unique")  # 詞表端 trim
        db = _session()
        db.add(Word(id="w-sp", tribe_id=PAI.id, name="ka ", dialect="中排灣語"))                        # 辭典端不 trim
        db.commit()
        self.assertEqual(WM.classify("ka", "paiwan", WM.load_snapshot(db, PAI.id)).match_class, "manual_near_form")

    def test_nfc_equivalent_forms_match_exactly(self):
        db = _session()
        db.add(Word(id="w-nfc", tribe_id=PAI.id, name="é", dialect="中排灣語"))                  # 分解形
        db.commit()
        self.assertEqual(WM.classify("é", "paiwan", WM.load_snapshot(db, PAI.id)).match_class, "same_dialect_unique")

    def test_truncated_candidates_still_multiple_and_counted(self):
        db = _session()
        db.add_all(Word(id=f"w-many-{i:03d}", tribe_id=PAI.id, name="many", dialect="") for i in range(21))
        db.commit()
        r = WM.classify("many", "paiwan", WM.load_snapshot(db, PAI.id))
        self.assertEqual((r.match_class, r.candidate_count, len(r.candidates)), ("manual_multiple", 21, 20))
        self.assertEqual([x["word_id"] for x in r.candidates], sorted(x["word_id"] for x in r.candidates))

    def test_explanation_with_only_whitespace_is_not_an_explanation(self):
        db = _session()
        db.add(Word(id="w-blank", tribe_id=PAI.id, name="blank", dialect=""))
        db.add(WordExplanation(word_id="w-blank", chinese_explanation=" \t \n", sort_order=0))
        db.commit()
        self.assertFalse(WM.classify("blank", "paiwan", WM.load_snapshot(db, PAI.id)).candidates[0]["has_explanation"])

    def test_placeholder_is_exact_and_unknown_variant_is_an_error(self):
        self.assertTrue(WM.is_placeholder(" 無此詞 "))
        with self.assertRaises(WM.WordlistError):
            WM.is_placeholder("無此詞彙（見備註）")

    def test_split_only_on_slash(self):
        self.assertEqual(WM.split_forms("a / b"), ["a", "b"])
        self.assertEqual(WM.split_forms("a,b"), ["a,b"])

    def test_length_precheck_gives_readable_error(self):
        e = WM.ParsedEntry(1, "01-01", "一", "x" * 500, "", "初級", "c")
        with self.assertRaises(WM.WordlistError):
            WM.check_lengths("中排灣", e, ["x"])


class ParseTests(SimpleTestCase):
    def _write(self, text, name="2026學習詞表-25中排灣語.csv"):
        d = Path(tempfile.mkdtemp())
        (d / name).write_bytes(text.encode("utf-8"))
        return d

    def _parse(self, d):
        return WM.parse_wordlist_csv(WM.find_list_file(d, "paiwan"), "paiwan")

    def test_parse_ok(self):
        parsed = self._parse(self._write(_csv(ROWS)))
        self.assertEqual((parsed.label, len(parsed.entries), parsed.source_label), ("中排灣", 4, "2026.07.22修正版"))
        self.assertEqual(parsed.entries[0].category, "01數字計量")

    def test_header_dialect_mismatch_rejected(self):
        with self.assertRaises(WM.WordlistError):
            self._parse(self._write(_csv(ROWS, dialect="北排灣語")))

    def test_duplicate_code_rejected(self):
        with self.assertRaises(WM.WordlistError):
            self._parse(self._write(_csv(ROWS + [(5, "01-01", "五", "lima", "", "初級")])))

    def test_unrecognised_row_rejected_not_skipped(self):
        with self.assertRaises(WM.WordlistError):
            self._parse(self._write(_csv(ROWS) + "x,y\n"))

    def test_non_contiguous_sequence_rejected(self):
        with self.assertRaises(WM.WordlistError):
            self._parse(self._write(_csv([ROWS[0], ROWS[2]])))

    def test_missing_version_rejected(self):
        with self.assertRaises(WM.WordlistError):
            self._parse(self._write(_csv(ROWS, version="")))

    def test_missing_file_rejected(self):
        with self.assertRaises(WM.WordlistError):
            WM.find_list_file(Path(tempfile.mkdtemp()), "paiwan")


class CommandTests(TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._put(ROWS)
        self.db = _session()
        patcher = mock.patch("adminapi.management.commands.build_wordlist_mapping.SessionLocal", lambda: self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _put(self, rows):
        (self.dir / "2026學習詞表-25中排灣語.csv").write_bytes(_csv(rows).encode("utf-8"))

    def _run(self, *extra):
        out = io.StringIO()
        call_command("build_wordlist_mapping", "--csv-dir", str(self.dir), "--tribe", "paiwan", *extra, stdout=out)
        return out.getvalue()

    def _decide(self, form, word_id):
        from adminapi import wordlist_mapping as WM
        f = WordlistForm.objects.get(form=form)
        f.decision, f.decided_word_id, f.decided_by_uid, f.decision_basis = "accept", word_id, "u1", WM.decision_basis(form=f.form, zh=f.entry.zh, note=f.entry.note, raw_cell=f.entry.raw_cell, match_class=f.match_class,
                                                candidate_count=f.candidate_count, fingerprint=f.candidate_fingerprint, sense_check=f.sense_check)
        f.decided_at = timezone.now()
        f.save()
        return f

    def test_dry_run_writes_nothing(self):
        self._run()
        self.assertEqual(WordlistEntry.objects.count(), 0)

    def test_apply_writes_mapping_and_never_touches_dictionary(self):
        before = self.db.query(Word).count(), self.db.query(WordExplanation).count()
        self._run("--apply")
        self.assertEqual((self.db.query(Word).count(), self.db.query(WordExplanation).count()), before)
        self.assertEqual(WordlistEntry.objects.count(), 4)
        self.assertEqual(WordlistForm.objects.count(), 5)   # dusa/dua 拆成兩個
        classes = {f.form: f.match_class for f in WordlistForm.objects.all()}
        self.assertEqual(classes["ita"], "unknown_dialect_unique")
        self.assertEqual(classes["dusa"], "cross_dialect_unique")
        self.assertEqual(classes["dua"], "manual_multiple")
        self.assertEqual(classes["無此詞彙"], "skip_placeholder")

    def test_rerun_is_idempotent_and_keeps_valid_decision(self):
        self._run("--apply")
        self._decide("ita", "w-ita")
        self._run("--apply")
        self.assertEqual(WordlistForm.objects.count(), 5)
        f = WordlistForm.objects.get(form="ita")
        self.assertEqual((f.decision, f.decision_stale), ("accept", False))

    def test_decision_becomes_stale_when_dictionary_candidate_changes(self):
        self._run("--apply")
        self._decide("ita", "w-ita")
        self.db.add(Word(id="w-ita-2", tribe_id=PAI.id, name="ita", dialect=""))   # 唯一變成多筆
        self.db.commit()
        self._run("--apply")
        f = WordlistForm.objects.get(form="ita")
        self.assertEqual((f.decision, f.match_class, f.decision_stale), ("accept", "manual_multiple", True))

    def test_decision_becomes_stale_when_wordlist_gloss_changes(self):
        self._run("--apply")
        self._decide("ita", "w-ita")
        self._put([(1, "01-01", "壹", "ita", "", "初級")] + list(ROWS[1:]))
        self._run("--apply")
        self.assertTrue(WordlistForm.objects.get(form="ita").decision_stale)

    def test_form_text_change_with_decision_aborts_whole_batch(self):
        self._run("--apply")
        self._decide("ita", "w-ita")
        self._put([(1, "01-01", "一", "itaX", "", "初級")] + list(ROWS[1:]) + [(5, "09-09", "新", "newword", "", "初級")])
        with self.assertRaises(CommandError):
            self._run("--apply")
        self.assertFalse(WordlistEntry.objects.filter(entry_code="09-09").exists())   # 整批 rollback
        self.assertTrue(WordlistForm.objects.filter(form="ita").exists())

    def test_entry_removed_from_source_is_deleted_when_undecided(self):
        self._run("--apply")
        self._put(ROWS[:3])
        self._run("--apply")
        self.assertFalse(WordlistEntry.objects.filter(entry_code="01-04").exists())

    def test_entry_removed_from_source_with_decision_aborts(self):
        self._run("--apply")
        self._decide("sepatj", "w-sepatj")
        self._put(ROWS[:3])
        with self.assertRaises(CommandError):
            self._run("--apply")
        self.assertTrue(WordlistEntry.objects.filter(entry_code="01-04").exists())

    def test_removed_split_form_without_decision_is_deleted(self):
        self._run("--apply")
        self._put([ROWS[0], (2, "01-02", "二", "dusa", "", "初級"), ROWS[2], ROWS[3]])
        self._run("--apply")
        self.assertEqual(WordlistForm.objects.count(), 4)

    def test_unknown_placeholder_variant_rejects_whole_batch(self):
        self._put(ROWS[:2] + [(3, "01-03", "三", "無此詞彙（見備註）", "", "初級")])
        with self.assertRaises(CommandError):
            self._run("--apply")
        self.assertEqual(WordlistEntry.objects.count(), 0)


class ConstraintTests(TestCase):
    def setUp(self):
        self.entry = WordlistEntry.objects.create(
            tribe="paiwan", dialect_label="中排灣", entry_code="01-01", seq=1, level="初級",
            category="c", zh="一", raw_cell="ita", source_label="v", source_sha256="0" * 64)

    def _form(self, **kw):
        base = dict(entry=self.entry, split_index=0, form="ita", match_class="new", snapshot_at=timezone.now())
        base.update(kw)
        with transaction.atomic():
            return WordlistForm.objects.create(**base)

    def test_accept_without_word_id_rejected(self):
        with self.assertRaises(IntegrityError):
            self._form(decision="accept", decided_by_uid="u", decided_at=timezone.now(), decision_basis="b")

    def test_reject_with_word_id_rejected(self):
        with self.assertRaises(IntegrityError):
            self._form(decision="reject", decided_word_id="w", decided_by_uid="u", decided_at=timezone.now(), decision_basis="b")

    def test_decision_without_metadata_rejected(self):
        with self.assertRaises(IntegrityError):
            self._form(decision="defer")

    def test_metadata_without_decision_rejected(self):
        with self.assertRaises(IntegrityError):
            self._form(decided_by_uid="u")

    def test_bad_match_class_rejected(self):
        with self.assertRaises(IntegrityError):
            self._form(match_class="bogus")

    def test_valid_empty_and_valid_accept_pass(self):
        self._form(split_index=0)
        self._form(split_index=1, decision="accept", decided_word_id="w", decided_by_uid="u",
                   decided_at=timezone.now(), decision_basis="b")
