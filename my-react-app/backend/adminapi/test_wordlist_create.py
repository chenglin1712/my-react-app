"""千詞表『新增詞條』：自動決定的嚴格條件、建立、同群只建一次、還原、各種拒絕情境。（SQLite；鎖行為要在 PostgreSQL 驗證）"""
import contextlib
import io
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from adminapi import wordlist_apply as A
from adminapi import wordlist_mapping as WM
from adminapi.dictionary_write import wordlist_append as wa
from adminapi.dictionary_write.exceptions import DictionaryWriteError
from adminapi.models.wordlist import WordlistApplyJournal, WordlistEntry, WordlistForm
from config.tribes import TRIBES
from dictionary_db.model import Base, Source, Tribe, Word, WordExplanation, WordSource

BUN = next(t for t in TRIBES if t.slug == "bunun")
ROWS = [
    (1, "01-01", "一", "tasa", "", "初級"),            # 辭典已有（未標語別）→ 不是 new
    (2, "01-02", "新甲", "newa", "", "初級"),          # 可自動新增
    (3, "01-03", "新乙、再", "newb", "", "初級"),      # 中文多義 → 人工
    (4, "01-04", "新丙", "newc", "備註", "初級"),      # 有備註 → 人工
    (5, "01-05", "同", "Dup", "", "初級"),             # 同形出現兩次、中文相同 → 同群只建一個
    (6, "01-06", "同", "Dup", "", "中級"),
    (7, "01-07", "新丁", "newd/newe", "", "初級"),     # 原格兩個詞形 → 人工
    (8, "01-08", "近一", "Nearx", "", "初級"),         # 只差大小寫的近形群 → 兩個都人工
    (9, "01-09", "近二", "nearx", "", "初級"),
    (10, "01-10", "複合", "two-part", "", "初級"),     # 詞中連字號 → 人工
]


def _csv(rows):
    lines = ["財團法人,,郡群布農語,,2026.07.22修正版,", "郡群布農語,,,,,", "序號,編號,中文,族語,備註,級別", "類別,01數字計量,,,,"]
    lines += [",".join(str(x) for x in r) for r in rows]
    return "\ufeff" + "\n".join(lines) + "\n"


class CreateBase(TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        db = self.Session()
        db.add(Tribe(id=BUN.id, name=BUN.full_name, slug="bunun"))
        db.add_all([Source(id=1, name="線上辭典"), Source(id=4, name="學習詞表")])
        db.add(Word(id="w-tasa", tribe_id=BUN.id, name="tasa", dialect=None))
        db.add(WordExplanation(word_id="w-tasa", chinese_explanation="一", sort_order=0))
        db.commit()
        db.close()

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
        for target, val in (
            ("adminapi.dictionary_cache.invalidate_dictionary_cache", lambda scopes, tribes=None: self.invalidated.append(tuple(tribes or ()))),
            ("adminapi.management.commands.build_wordlist_mapping.SessionLocal", self.Session),
            ("adminapi.wordlist_apply.SessionLocal", self.Session),
            ("adminapi.wordlist_apply.dictionary_write_session", write_session),
        ):
            p = mock.patch(target, val)
            p.start()
            self.addCleanup(p.stop)
        self.dir = Path(tempfile.mkdtemp())
        self._put(ROWS)
        call_command("build_wordlist_mapping", "--csv-dir", str(self.dir), "--tribe", "bunun", "--apply", stdout=io.StringIO())

    def _put(self, rows):
        (self.dir / "2026學習詞表-22郡群布農語.csv").write_bytes(_csv(rows).encode("utf-8"))

    def _words(self, name):
        with self.Session() as s:
            return s.query(Word).filter(Word.tribe_id == BUN.id, Word.name == name).all()

    def _sources(self, word_id):
        with self.Session() as s:
            return [r.source_id for r in s.query(WordSource).filter(WordSource.word_id == word_id)]

    def _expl(self, word_id):
        with self.Session() as s:
            return [r.chinese_explanation for r in s.query(WordExplanation).filter(WordExplanation.word_id == word_id)]


class AutoCreateTests(CreateBase):
    def test_only_strict_candidates_are_decided(self):
        r = A.auto_decide_create("bunun", dry_run=True)
        self.assertEqual((r["decided"], r["groups"]), (3, 2))                 # newa、Dup×2
        self.assertEqual(r["skipped"], {"中文多義或含括號": 1, "詞表備註非空": 1, "原格有多個詞形": 2, "有只差符號或大小寫的近形": 2, "疑似多詞或複合詞": 1})
        self.assertEqual(WordlistForm.objects.exclude(decision="").count(), 0)   # 預覽不寫

    def test_excluded_tribes_are_refused(self):
        for slug in ("paiwan", "amis", "kavalan"):
            self.assertEqual(A.auto_decide_create(slug, dry_run=False)["decided"], 0)

    def test_same_form_group_shares_one_target_id_decided_upfront(self):
        A.auto_decide_create("bunun", dry_run=False)
        ids = {f.entry.entry_code: f.decided_word_id for f in WordlistForm.objects.filter(decision="create").select_related("entry")}
        self.assertEqual(ids["01-05"], ids["01-06"])
        self.assertEqual(ids["01-05"], WM.create_target_id("bunun", "Dup"))
        self.assertNotEqual(ids["01-02"], ids["01-05"])


class CreateApplyTests(CreateBase):
    def setUp(self):
        super().setUp()
        A.auto_decide_create("bunun", dry_run=False)

    def test_creates_words_with_explicit_defaults_and_creates_each_name_once(self):
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(r["results"], {"詞條新增": 2, "詞條已存在（同群，未重複建立）": 1})
        self.assertEqual(len(self._words("Dup")), 1)
        (w,) = self._words("newa")
        self.assertEqual((w.dialect, w.frequency, w.hit, w.is_other_dialect, w.name), ("郡群布農語", 0, 0, False, "newa"))
        self.assertEqual((self._sources(w.id), self._expl(w.id)), ([4], ["新甲"]))
        self.assertEqual(w.id, WM.create_target_id("bunun", "newa"))
        self.assertEqual(self.invalidated, [("bunun",)])
        # 沒被決定的不會建立
        for name in ("newb", "newc", "newd", "Nearx", "nearx", "two-part"):
            self.assertEqual(self._words(name), [])

    def test_rerun_is_noop(self):
        A.apply_batch("bunun", 50, with_glosses=False)
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(r["results"], {"已套用過（略過）": 3})
        self.assertEqual(len(self._words("newa")), 1)

    def test_existing_word_added_after_mapping_blocks_creation(self):
        with self.Session() as s:
            s.add(Word(id="w-late", tribe_id=BUN.id, name="newa", dialect=""))
            s.commit()
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(len(self._words("newa")), 1)                     # 沒有第二個 newa
        self.assertIn("辭典自對照表建立後已有同名或近形詞條（請重跑 build_wordlist_mapping）", r["skipped"])

    def test_revert_deletes_only_created_words(self):
        batch = A.apply_batch("bunun", 50, with_glosses=False)["batch_id"]
        self.assertEqual(A.revert_batch(batch, dry_run=False), {"已還原": 2, "沒有實際寫入（只標記為已還原）": 1})
        self.assertEqual((self._words("newa"), self._words("Dup")), ([], []))
        self.assertEqual(len(self._words("tasa")), 1)                      # 原有詞條不動
        self.assertEqual(self._expl("w-tasa"), ["一"])
        self.assertFalse(WordlistApplyJournal.objects.exclude(status="reverted").exists())

    def test_reverted_create_is_not_recreated_automatically(self):
        batch = A.apply_batch("bunun", 50, with_glosses=False)["batch_id"]
        A.revert_batch(batch, dry_run=False)
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(self._words("newa"), [])
        self.assertIn("這個新增曾被還原，需人工重新決定", r["skipped"])

    def test_revert_skips_a_created_word_edited_afterwards(self):
        batch = A.apply_batch("bunun", 50, with_glosses=False)["batch_id"]
        wid = WM.create_target_id("bunun", "newa")
        with self.Session() as s:
            s.add(WordExplanation(word_id=wid, chinese_explanation="後來加的", sort_order=1))
            s.commit()
        r = A.revert_batch(batch, dry_run=False)
        self.assertEqual(r.get("略過：詞條在寫入後又被改過，或連結已不是當初那一列"), 1)
        self.assertEqual(len(self._words("newa")), 1)

    def test_revert_refuses_when_word_is_referenced(self):
        batch = A.apply_batch("bunun", 50, with_glosses=False)["batch_id"]
        with mock.patch("adminapi.dictionary_write.wordlist_append.count_word_references",
                        return_value={"anaphora_items": 1, "grammar_example_words": 0}):
            r = A.revert_batch(batch, dry_run=False)
        self.assertEqual(len(self._words("newa")), 1)
        self.assertEqual(r.get("略過：詞條在寫入後又被改過，或連結已不是當初那一列"), 2)

    def test_stale_create_decision_is_never_applied(self):
        WordlistForm.objects.filter(decision="create").update(decision_stale=True)
        A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(self._words("newa"), [])

    def test_tampered_target_id_is_rejected(self):
        WordlistForm.objects.filter(entry__entry_code="01-02").update(decided_word_id="not-the-derived-id")
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(self._words("newa"), [])
        self.assertIn("新增決定的詞條 id 或族語不符規則", r["skipped"])


class CreateServiceTests(CreateBase):
    def _create(self, **kw):
        base = dict(tribe_id=BUN.id, word_id="w-x", name="xx", dialect="郡群布農語", source_id=4, zh="某")
        base.update(kw)
        with self.Session() as s:
            return wa.create_word(s, **base)

    def test_refuses_existing_id(self):
        with self.assertRaises(DictionaryWriteError):
            self._create(word_id="w-tasa", name="other")

    def test_refuses_same_name_in_tribe(self):
        with self.assertRaises(DictionaryWriteError):
            self._create(name="tasa")

    def test_refuses_orphan_references(self):
        with mock.patch("adminapi.dictionary_write.wordlist_append.count_word_references",
                        return_value={"anaphora_items": 0, "grammar_example_words": 2}):
            with self.assertRaises(DictionaryWriteError):
                self._create()
        self.assertEqual(self._words("xx"), [])

    def test_refuses_blank_or_padded_input_and_unknown_source(self):
        for kw in ({"name": " xx"}, {"name": ""}, {"zh": "  "}, {"source_id": 999}, {"tribe_id": "nope"}):
            with self.assertRaises(DictionaryWriteError):
                self._create(**kw)

    def test_failed_create_leaves_nothing_behind(self):
        with self.assertRaises(DictionaryWriteError):
            self._create(source_id=999)
        self.assertEqual(self._words("xx"), [])


class CreateConstraintTests(TestCase):
    def setUp(self):
        self.entry = WordlistEntry.objects.create(
            tribe="bunun", dialect_label="郡群布農", entry_code="01-01", seq=1, level="初級",
            category="c", zh="一", raw_cell="x", source_label="v", source_sha256="0" * 64)

    def _form(self, **kw):
        base = dict(entry=self.entry, split_index=0, form="x", match_class="new", snapshot_at=timezone.now())
        base.update(kw)
        with transaction.atomic():
            return WordlistForm.objects.create(**base)

    def test_create_without_target_id_rejected(self):
        with self.assertRaises(IntegrityError):
            self._form(decision="create", decided_by_uid="u", decided_at=timezone.now(), decision_basis="b")

    def test_create_with_target_id_accepted(self):
        self._form(decision="create", decided_word_id="id", decided_by_uid="u", decided_at=timezone.now(), decision_basis="b")


class CrossBatchAndIntentTests(CreateBase):
    def setUp(self):
        super().setUp()
        A.auto_decide_create("bunun", dry_run=False)

    def test_revert_of_first_batch_is_refused_while_a_later_batch_depends_on_the_word(self):
        # limit=2 → 第一批處理 newa 與 Dup（建立）；第二批處理 Dup 的第二個詞形（同群，no-op）
        b1 = A.apply_batch("bunun", 2, with_glosses=False)["batch_id"]
        b2 = A.apply_batch("bunun", 2, with_glosses=False)["batch_id"]
        self.assertEqual(len(self._words("Dup")), 1)
        r = A.revert_batch(b1, dry_run=False)
        self.assertEqual(r.get("略過：另一批操作也依賴這個詞條"), 1)
        self.assertEqual(len(self._words("Dup")), 1)                      # 沒被刪掉
        self.assertEqual(len(self._words("newa")), 0)                     # 只有不被依賴的 newa 被還原
        A.revert_batch(b2, dry_run=False)                                  # 依賴方先還原後，原建立批次才能還原
        r = A.revert_batch(b1, dry_run=False)
        self.assertEqual(self._words("Dup"), [])

    def _pending(self, form_code, intent, action="create_word"):
        f = WordlistForm.objects.get(entry__entry_code=form_code)
        return WordlistApplyJournal.objects.create(
            batch_id="p", form=f, action=action, tribe="bunun", word_id=f.decided_word_id, before_hash="none",
            details={"source_id": 4, "intent": intent}, status="pending", actor="x")

    def test_verify_existing_pending_is_never_resolved_as_created(self):
        A.apply_batch("bunun", 50, with_glosses=False)
        WordlistApplyJournal.objects.filter(form__entry__entry_code="01-06").delete()     # 模擬第二個詞形的紀錄尚未更新
        j = self._pending("01-06", "verify_existing")
        j.before_hash = "sha256:" + "0" * 64          # 辭典已被別人改過（雜湊不同）
        j.save()
        A.resolve_pending(j.pk, "applied", dry_run=False)
        j.refresh_from_db()
        self.assertEqual((j.status, j.details["created"]), ("applied", False))

    def test_create_intent_pending_resolves_as_created(self):
        A.apply_batch("bunun", 50, with_glosses=False)
        WordlistApplyJournal.objects.filter(form__entry__entry_code="01-02").delete()
        j = self._pending("01-02", "create")
        A.resolve_pending(j.pk, "applied", dry_run=False)
        j.refresh_from_db()
        self.assertTrue(j.details["created"])

    def test_pending_report_shows_intent(self):
        self._pending("01-02", "create")
        self.assertEqual(A.pending_report()[0]["intent"], "create")

    def test_existing_target_without_trusted_creator_journal_goes_to_manual(self):
        target = WM.create_target_id("bunun", "newa")
        with self.Session() as s:
            s.add(Word(id=target, tribe_id=BUN.id, name="newa", dialect=""))          # 來路不明的既有詞條（沒有建立紀錄）
            s.commit()
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertIn("新增目標詞條已存在，但族語、詞形或建立紀錄不符，需人工", r["skipped"])

    def test_existing_target_with_wrong_name_goes_to_manual(self):
        A.apply_batch("bunun", 50, with_glosses=False)
        with self.Session() as s:
            s.query(Word).filter(Word.id == WM.create_target_id("bunun", "Dup")).update({"name": "Dup-renamed"})
            s.commit()
        WordlistApplyJournal.objects.filter(form__entry__entry_code="01-06").delete()
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertIn("新增目標詞條已存在，但族語、詞形或建立紀錄不符，需人工", r["skipped"])

    def test_cache_invalidated_even_when_a_later_step_raises(self):
        with mock.patch("adminapi.wordlist_apply.wa.create_word", side_effect=[{"before_hash": "none", "after_hash": "sha256:x", "created": True}, RuntimeError("boom")]):
            with self.assertRaises(RuntimeError):
                A.apply_batch("bunun", 50, with_glosses=False)
        self.assertTrue(self.invalidated)


class LockKeyTests(TestCase):
    def test_lock_key_never_contains_nul_which_postgresql_rejects(self):
        key = wa.create_lock_key("tribe-id", "ʼ:^-形")
        self.assertNotIn("\x00", key)
        self.assertEqual(wa.create_lock_key("a", "b"), wa.create_lock_key("a", "b"))
        self.assertNotEqual(wa.create_lock_key("a", "bc"), wa.create_lock_key("ab", "c"))


class RedecisionTests(CreateBase):
    def test_recreate_allowed_only_after_a_fresh_decision(self):
        A.auto_decide_create("bunun", dry_run=False)
        batch = A.apply_batch("bunun", 50, with_glosses=False)["batch_id"]
        A.revert_batch(batch, dry_run=False)
        A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(self._words("newa"), [])                          # 還原後、沒有重新決定：不自動重做
        for f in WordlistForm.objects.filter(decision="create"):            # 人重新決定
            f.decision, f.decided_word_id, f.decided_by_uid, f.decided_at, f.decision_basis = "", "", "", None, ""
            f.save()
        A.auto_decide_create("bunun", dry_run=False)
        r = A.apply_batch("bunun", 50, with_glosses=False)
        self.assertEqual(len(self._words("newa")), 1)                      # 重新決定後才會建立
        self.assertEqual(len(self._words("Dup")), 1)
