"""建立／更新「千詞表對照表」：把官方 2026 學習詞表的每個詞形，對辭典做唯讀比對後存進 Django 的 Wordlist* 表。
預設只預覽（dry-run），加 --apply 才寫入。【這個指令完全不寫辭典（dictionary_db）】。

  python manage.py build_wordlist_mapping --csv-dir "Z:/Desktop/win/族語單詞驗證"             # 預覽
  python manage.py build_wordlist_mapping --csv-dir "Z:/Desktop/win/族語單詞驗證" --apply
  python manage.py build_wordlist_mapping --csv-dir ... --tribe paiwan

語別採題庫標示（見 adminapi/wordlist_mapping.TARGETS）。每族需要恰好一份檔名含該語別的 CSV（xlsx 請先另存 CSV）。
解析是嚴格的：看不懂的資料列、編號重複、序號不連續、欄位空白或超長、未知寫法的占位項，都整批拒絕。

寫入規則（單一 transaction；PostgreSQL 下先取得 advisory lock，避免兩個 --apply 同時互蓋；辭典快照在取得鎖之後才讀）：
- 條目與詞形 upsert；來源檔已不存在的條目／詞形：沒有人工決定就刪除，有決定就整批中止（人要先處理）。
- 已有人工決定的詞形：詞形文字變了 → 整批中止；比對依據（候選、分類、詞表中文／備註）變了 → 保留決定但標 decision_stale，
  套用流程必須拒絕過期的決定。
"""
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from adminapi import wordlist_mapping as WM
from adminapi.models.wordlist import MATCH_CLASSES, WordlistEntry, WordlistForm
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal

ADVISORY_LOCK_KEY = 7_204_117_001


class Command(BaseCommand):
    help = "建立千詞表對照表（唯讀比對辭典，預設只預覽）"

    def add_arguments(self, parser):
        parser.add_argument("--csv-dir", required=True)
        parser.add_argument("--tribe", choices=sorted(WM.TARGETS))
        parser.add_argument("--apply", action="store_true")

    def _plan(self, slugs, parsed):
        tribes = {t.slug: t for t in TRIBES}
        plan = {}
        db = SessionLocal()
        try:
            for slug in slugs:
                snap = WM.load_snapshot(db, tribes[slug].id)
                items = []
                for e in parsed[slug].entries:
                    forms = [WM.nfc(f) for f in WM.split_forms(e.raw)]
                    if not forms:
                        raise CommandError(f"{slug} {e.code} 沒有可用詞形")
                    if len(set(forms)) != len(forms):
                        raise CommandError(f"{slug} {e.code} 同一格內有重複詞形")
                    WM.check_lengths(parsed[slug].label, e, forms, parsed[slug].source_label)
                    items.append((e, [(i, f, WM.classify(f, slug, snap, e.zh)) for i, f in enumerate(forms)]))
                plan[slug] = items
        finally:
            db.close()
        return plan

    def handle(self, *args, **opts):
        directory = Path(opts["csv_dir"])
        if not directory.is_dir():
            raise CommandError("找不到詞表資料夾")
        slugs = [opts["tribe"]] if opts["tribe"] else sorted(WM.TARGETS)
        try:
            parsed = {s: WM.parse_wordlist_csv(WM.find_list_file(directory, s), s) for s in slugs}
            if not opts["apply"]:
                self._report(slugs, parsed, self._plan(slugs, parsed))
                self.stdout.write("（預覽：未寫入。加 --apply 才寫入對照表）")
                return
            with transaction.atomic():
                if connection.vendor == "postgresql":
                    with connection.cursor() as cur:
                        cur.execute("SELECT pg_advisory_xact_lock(%s)", [ADVISORY_LOCK_KEY])
                plan = self._plan(slugs, parsed)       # 取得鎖之後才讀辭典快照
                self._write(slugs, parsed, plan)
        except WM.WordlistError as exc:
            raise CommandError(str(exc))
        self._report(slugs, parsed, plan)
        self.stdout.write("已寫入對照表（辭典未被修改）")

    def _report(self, slugs, parsed, plan):
        self.stdout.write("語別｜條目｜詞形｜" + "｜".join(MATCH_CLASSES))
        for slug in slugs:
            c = Counter(cl.match_class for _, fs in plan[slug] for _, _, cl in fs)
            n_forms = sum(len(fs) for _, fs in plan[slug])
            self.stdout.write(f"{parsed[slug].label}｜{len(plan[slug])}｜{n_forms}｜" + "｜".join(str(c[m]) for m in MATCH_CLASSES))

    def _write(self, slugs, parsed, plan):
        now = timezone.now()
        for slug in slugs:
            p = parsed[slug]
            current_codes = {e.code for e, _ in plan[slug]}
            for gone in WordlistEntry.objects.filter(tribe=slug, dialect_label=p.label).exclude(entry_code__in=current_codes):
                if gone.forms.exclude(decision="").exists():
                    raise CommandError(f"{p.label} {gone.entry_code} 已不在來源檔，但有人工決定，整批中止")
                gone.delete()
            for e, forms in plan[slug]:
                fields = dict(seq=e.seq, level=e.level, category=e.category, zh=e.zh, raw_cell=e.raw, note=e.note,
                              source_label=p.source_label, source_sha256=p.sha256)
                entry, _ = WordlistEntry.objects.update_or_create(tribe=slug, dialect_label=p.label, entry_code=e.code, defaults=fields)
                existing = {f.split_index: f for f in entry.forms.all()}
                for idx, form, cl in forms:
                    row = existing.pop(idx, None)
                    if row is None:
                        WordlistForm.objects.create(
                            entry=entry, split_index=idx, form=form, match_class=cl.match_class, candidates=cl.candidates,
                            candidate_count=cl.candidate_count, candidate_fingerprint=cl.fingerprint, sense_check=cl.sense_check, candidates_truncated=cl.candidate_count > len(cl.candidates),
                            snapshot_at=now)
                        continue
                    if row.decision and row.form != form:
                        raise CommandError(f"{p.label} {e.code} 第 {idx} 個詞形文字變了但已有人工決定，整批中止")
                    row.form, row.match_class, row.candidates = form, cl.match_class, cl.candidates
                    row.candidate_count, row.candidates_truncated = cl.candidate_count, cl.candidate_count > len(cl.candidates)
                    row.candidate_fingerprint, row.sense_check = cl.fingerprint, cl.sense_check
                    row.snapshot_at = now
                    if row.decision:
                        row.decision_stale = row.decision_basis != WM.decision_basis(
                            form=form, zh=e.zh, note=e.note, raw_cell=e.raw, match_class=cl.match_class,
                            candidate_count=cl.candidate_count, fingerprint=cl.fingerprint, sense_check=cl.sense_check)
                    row.save(update_fields=["form", "match_class", "candidates", "candidate_count", "candidates_truncated",
                                            "candidate_fingerprint", "sense_check", "snapshot_at", "decision_stale"])
                for leftover in existing.values():
                    if leftover.decision:
                        raise CommandError(f"{p.label} {e.code} 的詞形減少但被移除的詞形已有人工決定，整批中止")
                    leftover.delete()
