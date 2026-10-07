"""千詞表只增不減更新：自動決定、窄操作、操作紀錄、還原、各種拒絕情境。

測試用 SQLite（列鎖會被忽略，真正的鎖行為要在 PostgreSQL 驗證）；辭典端的 SessionLocal／dictionary_write_session
一律換成同一個記憶體資料庫。"""
import contextlib
import io
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from adminapi import wordlist_apply as A
from adminapi import wordlist_mapping as WM
from adminapi.dictionary_write import wordlist_append as wa
from adminapi.dictionary_write.exceptions import ConcurrentModificationError, DictionaryWriteError
from adminapi.models.wordlist import WordlistApplyJournal, WordlistForm
from config.tribes import TRIBES
from dictionary_db.model import Base, Source, Tribe, Word, WordExplanation, WordSource

AMIS = next(t for t in TRIBES if t.slug == "amis")
CSV_ROWS = [
    (1, "01-01", "一", "mi", "", "初級"),            # 同語別唯一、義項完全相符 → 自動接受
    (2, "01-02", "二", "tu", "", "初級"),            # 同上（辭典釋義帶括號註解）
    (3, "01-03", "三", "ko", "", "初級"),            # 辭典未標語別、阿美有多份詞表 → 不自動決定
    (4, "01-04", "四、再", "ra", "", "初級"),        # 同語別唯一、義項有交集（四）→ 自動接受
    (5, "01-05", "五", "newword", "", "初級"),       # 辭典沒有
    (6, "01-06", "六", "nw", "", "初級"),            # 同語別唯一但辭典沒有釋義 → 不自動決定（沒有證據）
    (7, "01-07", "閩南人", "xx", "", "初級"),        # 同語別唯一但義項衝突（辭典是客家人）→ 不自動決定
]


def _csv(rows):
    lines = ["財團法人,,秀姑巒阿美語,,2026.07.22修正版,", "秀姑巒阿美語,,,,,", "序號,編號,中文,族語,備註,級別", "類別,01數字計量,,,,"]
    lines += [",".join(str(x) for x in r) for r in rows]
    return "﻿" + "\n".join(lines) + "\n"


class ApplyBase(TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        self.db = self.Session()
        self.db.add(Tribe(id=AMIS.id, name=AMIS.full_name, slug=AMIS.slug))
        self.db.add_all([Source(id=1, name="線上辭典"), Source(id=4, name="學習詞表")])
        d = "秀姑巒阿美語"
        self.db.add_all([
            Word(id="w-mi", tribe_id=AMIS.id, name="mi", dialect=d),
            Word(id="w-tu", tribe_id=AMIS.id, name="tu", dialect=d),
            Word(id="w-ko", tribe_id=AMIS.id, name="ko", dialect=None),
            Word(id="w-ra", tribe_id=AMIS.id, name="ra", dialect=d),
            Word(id="w-nw", tribe_id=AMIS.id, name="nw", dialect=d),
            Word(id="w-xx", tribe_id=AMIS.id, name="xx", dialect=d),
        ])
        self.db.add_all([
            WordExplanation(word_id="w-mi", chinese_explanation="一", sort_order=0),
            WordExplanation(word_id="w-ra", chinese_explanation="四", sort_order=0),
            WordExplanation(word_id="w-ko", chinese_explanation="三", sort_order=0),
            WordExplanation(word_id="w-xx", chinese_explanation="客家人", sort_order=0),
        ])
        self.db.add(WordExplanation(word_id="w-tu", chinese_explanation="二（已有）", sort_order=0))
        self.db.add(WordSource(word_id="w-tu", source_id=1, sort_order=0))
        self.db.commit()

        @contextlib.contextmanager
        def write_session():
            s = self.Session()
            try:
                yield s
                s.commit()
            except Exception:
                s.rollback()
                raise
            finally:
                s.close()

        self.invalidated = []
        p0 = mock.patch("adminapi.dictionary_cache.invalidate_dictionary_cache",
                        lambda scopes, tribes=None: self.invalidated.append((tuple(scopes), tuple(tribes or ()))))
        p0.start()
        self.addCleanup(p0.stop)
        for target, val in (
            ("adminapi.management.commands.build_wordlist_mapping.SessionLocal", self.Session),
            ("adminapi.wordlist_apply.SessionLocal", self.Session),
            ("adminapi.wordlist_apply.dictionary_write_session", write_session),
        ):
            p = mock.patch(target, val)
            p.start()
            self.addCleanup(p.stop)
        self.dir = Path(tempfile.mkdtemp())
        self._put(CSV_ROWS)
        self._build()

    def _put(self, rows):
        (self.dir / "2026學習詞表-02秀姑巒阿美語.csv").write_bytes(_csv(rows).encode("utf-8"))

    def _build(self):
        call_command("build_wordlist_mapping", "--csv-dir", str(self.dir), "--tribe", "amis", "--apply", stdout=io.StringIO())

    def _decide_manually(self, form, word_id):
        from django.utils import timezone
        f = WordlistForm.objects.get(form=form)
        f.decision, f.decided_word_id, f.decided_by_uid, f.decision_basis = "accept", word_id, "human", A.form_basis(f)
        f.decided_at = timezone.now()
        f.save()

    def _sources(self, word_id):
        with self.Session() as s:
            return sorted(r.source_id for r in s.query(WordSource).filter(WordSource.word_id == word_id))

    def _expl(self, word_id):
        with self.Session() as s:
            return sorted(r.chinese_explanation for r in s.query(WordExplanation).filter(WordExplanation.word_id == word_id))

    def _tree_hash(self, word_id):
        with self.Session() as s:
            return wa.tree_hash(s, word_id)


class AutoDecideTests(ApplyBase):
    def test_dry_run_decides_nothing(self):
        r = A.auto_decide_same_dialect("amis", dry_run=True)
        self.assertEqual(r["decided"], 3)
        self.assertEqual(WordlistForm.objects.exclude(decision="").count(), 0)

    def test_only_same_dialect_unique_is_decided(self):
        A.auto_decide_same_dialect("amis", dry_run=False)
        decided = {f.form: f.decided_word_id for f in WordlistForm.objects.exclude(decision="")}
        self.assertEqual(decided, {"mi": "w-mi", "tu": "w-tu", "ra": "w-ra"})      # ko／newword／nw／xx 都不自動決定
        f = WordlistForm.objects.get(form="mi")
        self.assertEqual((f.decided_by_uid, f.decision_stale, f.decision_basis == A.form_basis(f)), (A.AUTO_ACTOR, False, True))


    def test_sense_conflict_and_missing_explanation_are_not_auto_accepted(self):
        r = A.auto_decide_same_dialect("amis", dry_run=True)
        self.assertEqual(WordlistForm.objects.get(form="xx").sense_check, "none")
        self.assertEqual(WordlistForm.objects.get(form="nw").sense_check, "no_explanation")
        self.assertEqual(WordlistForm.objects.get(form="mi").sense_check, "exact_sense")
        self.assertIn("義項不是完全相符（none）", r["skipped"])
        self.assertIn("義項不是完全相符（no_explanation）", r["skipped"])
        self.assertIn("辭典未標語別且該族有多份詞表", r["skipped"])

    def test_dictionary_explanation_edit_makes_decision_stale_after_rebuild(self):
        A.auto_decide_same_dialect("amis", dry_run=False)
        with self.Session() as s:
            s.query(WordExplanation).filter(WordExplanation.word_id == "w-mi").update({"chinese_explanation": "改過的釋義"})
            s.commit()
        self._build()
        self.assertTrue(WordlistForm.objects.get(form="mi").decision_stale)


class SenseAgreementTests(TestCase):
    def test_levels(self):
        sa = WM.sense_agreement
        self.assertEqual(sa("二", ["二（已有）"]), "exact_sense")
        self.assertEqual(sa("四、再", ["四"]), "exact_sense")
        self.assertEqual(sa("哥哥；姊姊", ["哥哥、姊姊"]), "exact_sense")
        self.assertEqual(sa("獵刀", ["直形獵刀"]), "contains")
        self.assertEqual(sa("一", ["一個人"]), "none")                 # 單字不當 contains 證據
        self.assertEqual(sa("閩南人", ["客家人"]), "none")
        self.assertEqual(sa("一", []), "no_explanation")
        self.assertEqual(sa("一", ["  ", "\u00a0"]), "no_explanation")


class ApplyTests(ApplyBase):
    def setUp(self):
        super().setUp()
        A.auto_decide_same_dialect("amis", dry_run=False)

    def test_preview_writes_nothing(self):
        todo, skipped = A.plan("amis", with_glosses=False)
        self.assertEqual(len(todo), 3)
        self.assertEqual(self._sources("w-mi"), [])

    def test_apply_appends_only_source_and_changes_nothing_else(self):
        before_tu = (self._sources("w-tu"), self._expl("w-tu"))
        r = A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(r["results"], {"來源連結新增": 3})
        self.assertEqual(self._sources("w-mi"), [4])
        self.assertEqual(self._sources("w-tu"), [1, 4])             # 既有來源保留
        self.assertEqual((self._expl("w-tu")), before_tu[1])         # 既有釋義不動
        self.assertEqual(self._expl("w-mi"), ["一"])                  # 既有釋義原封不動
        j = WordlistApplyJournal.objects.get(word_id="w-mi")
        self.assertEqual((j.status, j.before_hash != j.after_hash, j.after_hash == self._tree_hash("w-mi")), ("applied", True, True))

    def test_second_run_is_noop(self):
        A.apply_batch("amis", 50, with_glosses=False)
        r = A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(r["results"], {"已套用過（略過）": 3})
        self.assertEqual(WordlistApplyJournal.objects.count(), 3)
        self.assertEqual(self._sources("w-mi"), [4])

    def test_limit_is_respected(self):
        r = A.apply_batch("amis", 1, with_glosses=False)
        self.assertEqual(r["processed_forms"], 1)
        self.assertEqual(WordlistApplyJournal.objects.count(), 1)

    def test_gloss_only_for_strict_candidates(self):
        self._decide_manually("nw", "w-nw")                          # 人工決定的無釋義詞
        r = A.apply_batch("amis", 50, with_glosses=True)
        self.assertEqual(r["results"], {"來源連結新增": 4, "釋義新增": 1})
        self.assertEqual(self._expl("w-nw"), ["六"])                 # 無釋義、單義 → 補
        self.assertEqual(self._expl("w-tu"), ["二（已有）"])          # 已有釋義 → 不追加
        self.assertEqual(self._expl("w-ra"), ["四"])                 # 已有釋義（且詞表多義）→ 不動

    def test_gloss_flag_off_never_writes_explanations(self):
        self._decide_manually("nw", "w-nw")
        A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(self._expl("w-nw"), [])

    def test_changed_dictionary_after_mapping_is_skipped_not_applied(self):
        with self.Session() as s:
            s.add(Word(id="w-mi-2", tribe_id=AMIS.id, name="mi", dialect="秀姑巒阿美語"))   # 唯一變成多筆
            s.commit()
        r = A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(self._sources("w-mi"), [])
        self.assertIn("辭典自對照表建立後已變動（請重跑 build_wordlist_mapping）", r["skipped"])

    def test_stale_decision_is_never_applied(self):
        WordlistForm.objects.filter(form="mi").update(decision_stale=True)
        A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(self._sources("w-mi"), [])

    def test_tampered_decision_basis_is_rejected(self):
        WordlistForm.objects.filter(form="mi").update(decision_basis="x" * 64)
        r = A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(self._sources("w-mi"), [])
        self.assertEqual(r["skipped"], {"決定依據與對照表不符": 1})

    def test_decision_pointing_outside_candidates_is_rejected(self):
        WordlistForm.objects.filter(form="mi").update(decided_word_id="w-ko")
        r = A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(r["skipped"], {"決定指定的詞條不在候選中": 1})
        self.assertEqual(self._sources("w-ko"), [])

    def test_pending_journal_blocks_everything(self):
        f = WordlistForm.objects.get(form="mi")
        WordlistApplyJournal.objects.create(batch_id="b", form=f, action="append_source", tribe="amis", word_id="w-mi",
                                            before_hash="h", status="pending", actor="x")
        with self.assertRaises(A.ApplyError):
            A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(self._sources("w-ra"), [])

    def test_hash_mismatch_is_rejected_by_narrow_operation(self):
        with self.assertRaises(ConcurrentModificationError):
            with self.Session() as s:
                wa.append_source(s, "w-mi", AMIS.id, 4, "sha256:" + "0" * 64)
        self.assertEqual(self._sources("w-mi"), [])

    def test_wrong_tribe_is_rejected(self):
        with self.assertRaises(DictionaryWriteError):
            with self.Session() as s:
                wa.append_source(s, "w-mi", "other-tribe", 4, self._tree_hash("w-mi"))

    def test_unknown_source_is_rejected(self):
        with self.assertRaises(DictionaryWriteError):
            with self.Session() as s:
                wa.append_source(s, "w-mi", AMIS.id, 999, self._tree_hash("w-mi"))

    def test_existing_source_link_is_a_noop_not_a_duplicate(self):
        with self.Session() as s:
            res = wa.append_source(s, "w-tu", AMIS.id, 1, self._tree_hash("w-tu"))
        self.assertEqual((res["added"], res["before_hash"] == res["after_hash"]), (False, True))
        self.assertEqual(self._sources("w-tu"), [1])

    def test_gloss_refused_when_a_real_explanation_exists(self):
        with self.assertRaises(DictionaryWriteError):
            with self.Session() as s:
                wa.append_explanation(s, "w-tu", AMIS.id, "新", self._tree_hash("w-tu"))

    def test_blank_explanation_text_is_refused(self):
        with self.assertRaises(DictionaryWriteError):
            with self.Session() as s:
                wa.append_explanation(s, "w-mi", AMIS.id, "  ", self._tree_hash("w-mi"))


class RevertTests(ApplyBase):
    def setUp(self):
        super().setUp()
        A.auto_decide_same_dialect("amis", dry_run=False)
        self._decide_manually("nw", "w-nw")
        self.batch = A.apply_batch("amis", 50, with_glosses=True)["batch_id"]

    def test_revert_removes_only_what_the_batch_added(self):
        r = A.revert_batch(self.batch, dry_run=False)
        self.assertEqual(r, {"已還原": 5})
        self.assertEqual(self._sources("w-mi"), [])
        self.assertEqual(self._sources("w-tu"), [1])                 # 原有的來源連結還在
        self.assertEqual(self._expl("w-nw"), [])
        self.assertEqual(self._expl("w-tu"), ["二（已有）"])
        self.assertFalse(WordlistApplyJournal.objects.exclude(status="reverted").exists())

    def test_revert_preview_changes_nothing(self):
        A.revert_batch(self.batch, dry_run=True)
        self.assertEqual(self._sources("w-mi"), [4])

    def test_revert_skips_a_word_edited_after_apply(self):
        with self.Session() as s:
            s.add(WordExplanation(word_id="w-ra", chinese_explanation="後來有人加的", sort_order=1))
            s.commit()
        r = A.revert_batch(self.batch, dry_run=False)
        self.assertEqual(r.get("略過：詞條在寫入後又被改過，或連結已不是當初那一列"), 1)
        self.assertEqual(self._sources("w-ra"), [4])                 # 沒動

    def test_revert_does_not_delete_a_relinked_row(self):
        """連結被刪掉後又以新主鍵重建（內容雜湊可能恢復相同）：不是當初那一列，不能刪。"""
        with self.Session() as s:
            row = s.query(WordSource).filter(WordSource.word_id == "w-mi", WordSource.source_id == 4).one()
            old_id, order = row.id, row.sort_order
            s.delete(row)
            s.flush()
            s.add(WordSource(word_id="w-mi", source_id=4, sort_order=order))
            s.commit()
            self.assertNotEqual(s.query(WordSource.id).filter(WordSource.word_id == "w-mi").one()[0], old_id)
        r = A.revert_batch(self.batch, dry_run=False)
        self.assertEqual(self._sources("w-mi"), [4])                 # 重建的那一列還在
        self.assertEqual(r.get("略過：詞條在寫入後又被改過，或連結已不是當初那一列"), 1)

    def test_reapply_after_revert_is_allowed(self):
        A.revert_batch(self.batch, dry_run=False)
        r = A.apply_batch("amis", 50, with_glosses=False)
        self.assertEqual(r["results"], {"來源連結新增": 4})


class CommandTests(ApplyBase):
    def _run(self, name, *args):
        out = io.StringIO()
        call_command(name, *args, stdout=out)
        return out.getvalue()

    def test_commands_default_to_preview(self):
        self._run("decide_wordlist_mapping", "--auto-same-dialect", "--tribe", "amis")
        self.assertEqual(WordlistForm.objects.exclude(decision="").count(), 0)
        self._run("decide_wordlist_mapping", "--auto-same-dialect", "--tribe", "amis", "--apply")
        out = self._run("apply_wordlist_mapping", "--tribe", "amis")
        self.assertIn("預覽", out)
        self.assertEqual(self._sources("w-mi"), [])
        self._run("apply_wordlist_mapping", "--tribe", "amis", "--apply")
        self.assertEqual(self._sources("w-mi"), [4])

    def test_apply_command_reports_pending_as_error(self):
        A.auto_decide_same_dialect("amis", dry_run=False)
        f = WordlistForm.objects.get(form="mi")
        WordlistApplyJournal.objects.create(batch_id="b", form=f, action="append_source", tribe="amis", word_id="w-mi",
                                            before_hash="h", status="pending", actor="x")
        with self.assertRaises(CommandError):
            self._run("apply_wordlist_mapping", "--tribe", "amis", "--apply")


class ReconcileTests(ApplyBase):
    def setUp(self):
        super().setUp()
        A.auto_decide_same_dialect("amis", dry_run=False)

    def _pending(self, form, before_hash=None):
        f = WordlistForm.objects.get(form=form)
        return WordlistApplyJournal.objects.create(
            batch_id="b", form=f, action="append_source", tribe="amis", word_id=f.decided_word_id,
            before_hash=before_hash or self._tree_hash(f.decided_word_id), details={"source_id": 4},
            status="pending", actor="x")

    def test_cancel_allowed_only_when_dictionary_unchanged(self):
        j = self._pending("mi")
        self.assertIn("已取消", A.resolve_pending(j.pk, "cancelled", dry_run=False))
        self.assertFalse(WordlistApplyJournal.objects.filter(pk=j.pk).exists())

    def test_cancel_refused_when_dictionary_changed(self):
        j = self._pending("mi")
        with self.Session() as s:
            wa.append_source(s, "w-mi", AMIS.id, 4, j.before_hash)
            s.commit()
        with self.assertRaises(A.ApplyError):
            A.resolve_pending(j.pk, "cancelled", dry_run=False)
        self.assertTrue(WordlistApplyJournal.objects.filter(pk=j.pk).exists())

    def test_mark_applied_after_real_write_then_revert_works(self):
        j = self._pending("mi")
        with self.Session() as s:
            wa.append_source(s, "w-mi", AMIS.id, 4, j.before_hash)
            s.commit()
        A.resolve_pending(j.pk, "applied", dry_run=False)
        j.refresh_from_db()
        self.assertEqual((j.status, j.details["added"]), ("applied", True))
        self.assertEqual(A.revert_batch("b", dry_run=False), {"已還原": 1})
        self.assertEqual(self._sources("w-mi"), [])

    def test_mark_applied_refused_when_nothing_was_written(self):
        j = self._pending("mi")
        with self.assertRaises(A.ApplyError):
            A.resolve_pending(j.pk, "applied", dry_run=False)

    def test_report_shows_state(self):
        self._pending("mi")
        r = A.pending_report()
        self.assertEqual((len(r), r[0]["dictionary_changed"], r[0]["artifact"]), (1, False, "來源連結不存在"))
