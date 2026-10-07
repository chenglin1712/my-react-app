"""千詞表『只增不減』更新：把對照表中已接受、未過期的決定，套用成辭典裡的來源連結（及受嚴格限制的釋義）。

資料流與保護：
- 只讀取 WordlistForm 中 decision=accept 且 decision_stale=False 的列；套用前【重新】對辭典分類一次，
  必須同時滿足：分類與候選指紋仍等於對照表記錄的、決定所指的詞條仍存在於完整候選之中、依據雜湊仍相符。
- 每個辭典寫入前，先在 Django 端寫一筆 pending 操作紀錄；辭典交易成功後補上寫入後雜湊並改為 applied。
  辭典寫入在『commit 前』失敗（DictionaryWriteError／雜湊不符）就刪掉那筆 pending（沒有寫入發生）；
  其他例外無法確定是否已寫入，pending 會留著，之後任何套用都會拒絕繼續，直到人查清楚。
- 釋義預設不寫；只有 with_glosses 且滿足全部條件才寫：分類為同語別唯一（語別明確等於目標）、詞條沒有任何有實質文字的中文釋義、
  詞表中文是單一義項（沒有 、／；;（( 等多義標記）、該條目只有一個詞形。
- 還原只移除該筆新增的來源連結／釋義，且只在詞條內容雜湊仍等於寫入後雜湊時才做。
"""
import re
import uuid
from collections import Counter

from django.db import transaction
from django.utils import timezone

from adminapi import dictionary_write as dw
from adminapi import wordlist_mapping as WM
from adminapi.dictionary_write import wordlist_append as wa
from adminapi.models.wordlist import (
    DECISION_ACCEPT, DECISION_CREATE, JOURNAL_APPEND_EXPLANATION, JOURNAL_APPEND_SOURCE, JOURNAL_APPLIED, JOURNAL_CREATE_WORD,
    JOURNAL_PENDING, JOURNAL_REVERTED, MATCH_NEW, MATCH_SAME_DIALECT, MATCH_UNKNOWN_DIALECT, WordlistApplyJournal, WordlistForm,
)
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal, dictionary_write_session
from dictionary_db.model import Source, Word

SOURCE_NAME = "學習詞表"
SYSTEM_ACTOR = "system:apply_wordlist_mapping"
AUTO_ACTOR = "system:auto-same-dialect"
_MULTI_SENSE = re.compile(r"[、／/；;（）()，,]")


class ApplyError(RuntimeError):
    pass


def form_basis(f: WordlistForm) -> str:
    e = f.entry
    return WM.decision_basis(form=f.form, zh=e.zh, note=e.note, raw_cell=e.raw_cell, match_class=f.match_class,
                             candidate_count=f.candidate_count, fingerprint=f.candidate_fingerprint, sense_check=f.sense_check)


def auto_decide_same_dialect(tribe: str | None, dry_run: bool) -> dict:
    """自動接受的條件（全部要成立）：辭典唯一完全同名；詞表中文與辭典既有釋義有『完全相同的義項』（sense_check=exact_sense）；
    語別明確等於目標語別（same_dialect_unique），或該族只有一份官方詞表且辭典未標語別（unknown_dialect_unique）。
    其他一律不碰，留給人工：義項不同或只是相近、辭典沒有釋義、未標語別且該族有多份詞表（布農）、跨語別、多筆、近似形。
    『接受』只代表『詞表的這個詞形與辭典這一筆指同一個詞』，之後只會據此新增來源連結。"""
    qs = WordlistForm.objects.filter(match_class__in=(MATCH_SAME_DIALECT, MATCH_UNKNOWN_DIALECT), decision="").select_related("entry")
    if tribe:
        qs = qs.filter(entry__tribe=tribe)
    todo, skipped = [], Counter()
    for f in qs:
        if f.candidate_count != 1 or len(f.candidates) != 1 or not f.candidates[0].get("word_id") or not f.candidate_fingerprint:
            skipped["候選不是唯一或缺指紋"] += 1
            continue
        if f.match_class == MATCH_UNKNOWN_DIALECT and f.entry.tribe not in WM.SINGLE_LIST_TRIBES:
            skipped["辭典未標語別且該族有多份詞表"] += 1
            continue
        if f.sense_check != WM.SENSE_EXACT:
            skipped[f"義項不是完全相符（{f.sense_check or '無'}）"] += 1
            continue
        todo.append(f)
    if not dry_run:
        now = timezone.now()
        with transaction.atomic():
            for f in todo:
                f.decision, f.decided_word_id = DECISION_ACCEPT, f.candidates[0]["word_id"]
                f.decided_by_uid, f.decided_at, f.decision_basis, f.decision_stale = AUTO_ACTOR, now, form_basis(f), False
                f.save(update_fields=["decision", "decided_word_id", "decided_by_uid", "decided_at", "decision_basis", "decision_stale"])
    return {"decided": len(todo), "skipped": dict(skipped)}


_COMPOUND = re.compile(r"[\s=＝]")


def auto_decide_create(tribe: str | None, dry_run: bool) -> dict:
    """把『辭典完全沒有』的詞形標為 create，條件很嚴格（全部成立才算）：該族在 WM.CREATE_TRIBES；
    以（族語, NFC 詞形）分群，群內所有詞形的詞表備註皆空、原格只有一個詞形、中文單義（無 、／；，括號）、同形的中文完全相同；
    詞形不含空白、等號、詞中連字號；整份詞表沒有其他只差撇號／大小寫／^ : 的詞形。其他一律人工。
    新詞條 id 在決定當下就算好（同群共用同一個 id）。"""
    if tribe and tribe not in WM.CREATE_TRIBES:
        return {"decided": 0, "groups": 0, "skipped": {"此族暫不自動新增（排灣：下游不分語別；阿美／噶瑪蘭：會讓形態放行檔失效）": 1}}
    slugs = [tribe] if tribe else sorted(WM.CREATE_TRIBES)
    todo, groups_ok, skipped = [], 0, Counter()
    for slug in slugs:
        forms = list(WordlistForm.objects.filter(entry__tribe=slug).select_related("entry"))
        loose = {}
        for f in forms:
            loose.setdefault(WM.loose_key(f.form), set()).add(WM.nfc(f.form))
        groups = {}
        for f in forms:
            if f.match_class == MATCH_NEW:
                groups.setdefault(WM.nfc(f.form), []).append(f)
        for form, g in groups.items():
            why = None
            if any(x.decision not in ("", DECISION_CREATE) for x in g):
                why = "已有其他決定"
            elif any(x.entry.note.strip() for x in g):
                why = "詞表備註非空"
            elif any(len(WM.split_forms(x.entry.raw_cell)) != 1 for x in g):
                why = "原格有多個詞形"
            elif any(not _single_sense(x.entry.zh) for x in g):
                why = "中文多義或含括號"
            elif len({x.entry.zh for x in g}) != 1:
                why = "同形中文不同"
            elif _COMPOUND.search(form) or "-" in form.strip("-"):
                why = "疑似多詞或複合詞"
            elif len(loose[WM.loose_key(form)]) > 1:
                why = "有只差符號或大小寫的近形"
            if why:
                skipped[why] += 1
                continue
            groups_ok += 1
            todo += [x for x in g if x.decision == ""]
    if not dry_run:
        now = timezone.now()
        with transaction.atomic():
            for f in todo:
                f.decision, f.decided_word_id = DECISION_CREATE, WM.create_target_id(f.entry.tribe, f.form)
                f.decided_by_uid, f.decided_at, f.decision_basis, f.decision_stale = AUTO_ACTOR, now, form_basis(f), False
                f.save(update_fields=["decision", "decided_word_id", "decided_by_uid", "decided_at", "decision_basis", "decision_stale"])
    return {"decided": len(todo), "groups": groups_ok, "skipped": dict(skipped)}


def _single_sense(zh: str) -> bool:
    return bool(zh.strip()) and not _MULTI_SENSE.search(zh)


def _snapshots(db, slugs):
    tribes = {t.slug: t for t in TRIBES}
    return {s: WM.load_snapshot(db, tribes[s].id) for s in slugs}


def _candidate_ids(snap, form: str) -> set:
    f = WM.nfc(form).strip()
    ids = {w for w, _, _ in snap.exact.get(f, [])}
    ids |= {w for w, _, _ in snap.near.get(WM.loose_key(f), [])}
    return ids


def plan(tribe: str | None, with_glosses: bool) -> tuple[list, Counter]:
    """回傳 ([(form, [actions])], 略過原因計數)。actions 是 'source' 與（符合條件時）'gloss'。"""
    qs = WordlistForm.objects.filter(decision__in=(DECISION_ACCEPT, DECISION_CREATE)).select_related("entry").order_by("entry__tribe", "entry__seq", "split_index")
    if tribe:
        qs = qs.filter(entry__tribe=tribe)
    forms = list(qs)
    skipped = Counter()
    out = []
    if not forms:
        return out, skipped
    db = SessionLocal()
    try:
        snaps = _snapshots(db, sorted({f.entry.tribe for f in forms}))
        for f in forms:
            slug = f.entry.tribe
            if f.decision_stale:
                skipped["決定已過期"] += 1
                continue
            if f.decision_basis != form_basis(f):
                skipped["決定依據與對照表不符"] += 1
                continue
            if f.decision == DECISION_CREATE:
                target = WM.create_target_id(slug, f.form)
                if f.decided_word_id != target or slug not in WM.CREATE_TRIBES:
                    skipped["新增決定的詞條 id 或族語不符規則"] += 1
                    continue
                # 只擋『還原發生在這個決定之後』的情況；人重新決定（decided_at 較新）之後就可以再建立
                if WordlistApplyJournal.objects.filter(form=f, action=JOURNAL_CREATE_WORD, status=JOURNAL_REVERTED,
                                                       reverted_at__gte=f.decided_at).exists():
                    skipped["這個新增曾被還原，需人工重新決定"] += 1
                    continue
                row = db.query(Word.tribe_id, Word.name).filter(Word.id == target).first()
                already = row is not None
                if already:
                    # 目標 id 已存在：必須是同一族、同一詞形，而且有『我們建立』的 applied 紀錄，否則轉人工（不信任來路不明的既有詞條）
                    trusted = (row[0] == {t.slug: t.id for t in TRIBES}[slug] and WM.nfc(row[1] or "") == WM.nfc(f.form)
                               and WordlistApplyJournal.objects.filter(word_id=target, action=JOURNAL_CREATE_WORD,
                                                                       status=JOURNAL_APPLIED, details__created=True).exists())
                    if not trusted:
                        skipped["新增目標詞條已存在，但族語、詞形或建立紀錄不符，需人工"] += 1
                        continue
                fresh = WM.classify(f.form, slug, snaps[slug], f.entry.zh)
                if not already and (fresh.match_class != MATCH_NEW or f.match_class != MATCH_NEW):
                    skipped["辭典自對照表建立後已有同名或近形詞條（請重跑 build_wordlist_mapping）"] += 1
                    continue
                out.append((f, ["create"]))
                continue
            fresh = WM.classify(f.form, slug, snaps[slug], f.entry.zh)
            if (fresh.match_class != f.match_class or fresh.fingerprint != f.candidate_fingerprint
                    or fresh.sense_check != f.sense_check):
                skipped["辭典自對照表建立後已變動（請重跑 build_wordlist_mapping）"] += 1
                continue
            if f.decided_word_id not in _candidate_ids(snaps[slug], f.form):
                skipped["決定指定的詞條不在候選中"] += 1
                continue
            actions = ["source"]
            if with_glosses and fresh.match_class == MATCH_SAME_DIALECT and _single_sense(f.entry.zh) \
                    and len(WM.split_forms(f.entry.raw_cell)) == 1 and fresh.candidates \
                    and not fresh.candidates[0]["has_explanation"]:
                actions.append("gloss")
            out.append((f, actions))
    finally:
        db.close()
    return out, skipped


def _source_id(db) -> int:
    row = db.query(Source.id).filter(Source.name == SOURCE_NAME).first()
    if row is None:
        raise ApplyError(f"辭典沒有資料來源「{SOURCE_NAME}」")
    return row[0]


def _journal_for(f, action, word_id, before_hash, batch_id, details):
    return WordlistApplyJournal.objects.create(
        batch_id=batch_id, form=f, action=action, tribe=f.entry.tribe, word_id=word_id,
        before_hash=before_hash, details=details, status=JOURNAL_PENDING, actor=SYSTEM_ACTOR)


def apply_batch(tribe: str | None, limit: int, with_glosses: bool) -> dict:
    if WordlistApplyJournal.objects.filter(status=JOURNAL_PENDING).exists():
        raise ApplyError("有狀態為 pending 的操作紀錄（上次中斷，辭典是否已寫入不明）；請先查清楚再繼續")
    todo, skipped = plan(tribe, with_glosses)
    trib = {t.slug: t for t in TRIBES}
    batch_id = str(uuid.uuid4())
    done = Counter()
    touched = set()
    try:
        for f, actions in todo:
            if done["forms"] >= limit:
                break
            word_id, tid = f.decided_word_id, trib[f.entry.tribe].id
            acted = False      # 只有真的嘗試寫入的詞形才算進 --limit；已套用過的不佔額度
            for action in actions:
                kind = {"source": JOURNAL_APPEND_SOURCE, "gloss": JOURNAL_APPEND_EXPLANATION, "create": JOURNAL_CREATE_WORD}[action]
                if WordlistApplyJournal.objects.filter(form=f, action=kind).exclude(status=JOURNAL_REVERTED).exists():
                    done["已套用過（略過）"] += 1
                    continue
                acted = True
                with SessionLocal() as rdb:
                    exists = rdb.query(Word.id).filter(Word.id == word_id).first() is not None
                    before = wa.tree_hash(rdb, word_id) if (exists or action != "create") else "none"
                    source_id = _source_id(rdb)
                details = {"source_id": source_id} if action == "source" else (
                    {"text": f.entry.zh} if action == "gloss" else {
                        "source_id": source_id, "name": f.form, "zh": f.entry.zh, "intent": "verify_existing" if exists else "create"})
                j = _journal_for(f, kind, word_id, before, batch_id, details)
                try:
                    with dictionary_write_session() as wdb:
                        if action == "source":
                            res = wa.append_source(wdb, word_id, tid, source_id, before)
                        elif action == "gloss":
                            res = wa.append_explanation(wdb, word_id, tid, f.entry.zh, before)
                        elif exists:
                            res = wa.verify_existing(wdb, word_id, tid, before)
                        else:
                            res = wa.create_word(wdb, tid, word_id, f.form, WM.TARGETS[f.entry.tribe]["dictionary_dialect"],
                                                 source_id, f.entry.zh)
                except dw.DictionaryWriteError:
                    j.delete()                                   # commit 前失敗：沒有寫入發生
                    done["失敗-辭典拒絕（內容已變或不符條件）"] += 1
                    continue
                # 其他例外不攔：pending 留著，下次拒絕繼續
                j.after_hash, j.status, j.applied_at = res["after_hash"], JOURNAL_APPLIED, timezone.now()
                if action == "source":
                    j.details = {**details, "added": res["added"], "source_row_id": res.get("source_row_id")}
                elif action == "gloss":
                    j.details = {**details, "explanation_id": res["explanation_id"]}
                else:
                    j.details = {**details, "created": res["created"]}
                j.save(update_fields=["after_hash", "status", "applied_at", "details"])
                done[{"source": "來源連結新增" if res.get("added") else "來源連結已存在", "gloss": "釋義新增",
                      "create": "詞條新增" if res.get("created") else "詞條已存在（同群，未重複建立）"}[action]] += 1
                touched.add(f.entry.tribe)
            if acted:
                done["forms"] += 1
    finally:
        _invalidate_cache(touched)
    return {"batch_id": batch_id, "eligible_forms": len(todo), "processed_forms": done["forms"],
            "results": {k: v for k, v in done.items() if k != "forms"}, "skipped": dict(skipped)}


def _invalidate_cache(tribes) -> None:
    """辭典寫入已完成後通知 FastAPI 清除 words 快取（失敗只記 log，不影響已完成的寫入；詳見 dictionary_cache.py）。"""
    if not tribes:
        return
    from adminapi.dictionary_cache import invalidate_dictionary_cache
    invalidate_dictionary_cache(["words"], tribes=sorted(tribes))


def revert_batch(batch_id: str, dry_run: bool) -> dict:
    if WordlistApplyJournal.objects.filter(status=JOURNAL_PENDING).exists():
        raise ApplyError("有 pending 的操作紀錄，請先查清楚")
    rows = list(WordlistApplyJournal.objects.filter(batch_id=batch_id, status=JOURNAL_APPLIED).order_by("-id"))
    trib = {t.slug: t for t in TRIBES}
    res = Counter()
    reverted_tribes = set()
    try:
        for j in rows:
            if j.action == JOURNAL_APPEND_SOURCE:
                added = j.details.get("added", True)
            elif j.action == JOURNAL_CREATE_WORD:
                added = j.details.get("created", True)
            else:
                added = True
            if not added:
                res["沒有實際寫入（只標記為已還原）"] += 1
                if not dry_run:
                    j.status, j.reverted_at = JOURNAL_REVERTED, timezone.now()
                    j.save(update_fields=["status", "reverted_at"])
                continue
            if j.action == JOURNAL_CREATE_WORD:
                dependents = (WordlistApplyJournal.objects.filter(word_id=j.word_id, action=JOURNAL_CREATE_WORD, status=JOURNAL_APPLIED)
                              .exclude(pk=j.pk).exclude(batch_id=batch_id))
                if dependents.exists():
                    res["略過：另一批操作也依賴這個詞條"] += 1
                    continue
            if j.action == JOURNAL_APPEND_SOURCE:
                other = (WordlistApplyJournal.objects.filter(word_id=j.word_id, action=JOURNAL_APPEND_SOURCE, status=JOURNAL_APPLIED,
                                                             details__source_id=j.details["source_id"]).exclude(pk=j.pk)
                         .exclude(batch_id=batch_id))
                if other.exists():
                    res["略過：另一批操作也依賴這個來源連結"] += 1
                    continue
            if dry_run:
                res["可還原"] += 1
                continue
            try:
                with dictionary_write_session() as wdb:
                    if j.action == JOURNAL_CREATE_WORD:
                        wa.delete_created_word(wdb, j.word_id, trib[j.tribe].id, j.after_hash)
                    elif j.action == JOURNAL_APPEND_SOURCE:
                        wa.remove_appended_source(wdb, j.word_id, trib[j.tribe].id, j.details["source_id"],
                                                  j.details["source_row_id"], j.after_hash)
                    else:
                        wa.remove_appended_explanation(wdb, j.word_id, trib[j.tribe].id, j.details["explanation_id"], j.details["text"], j.after_hash)
            except dw.DictionaryWriteError:
                res["略過：詞條在寫入後又被改過，或連結已不是當初那一列"] += 1
                continue
            j.status, j.reverted_at = JOURNAL_REVERTED, timezone.now()
            j.save(update_fields=["status", "reverted_at"])
            res["已還原"] += 1
            reverted_tribes.add(j.tribe)
    finally:
        if not dry_run:
            _invalidate_cache(reverted_tribes)
    return dict(res)


def pending_report() -> list[dict]:
    """列出所有 pending 操作紀錄，附上目前辭典狀態，給人判斷『辭典是否已經寫入』。"""
    out = []
    for j in WordlistApplyJournal.objects.filter(status=JOURNAL_PENDING).select_related("form", "form__entry"):
        with SessionLocal() as db:
            try:
                current = wa.tree_hash(db, j.word_id)
            except dw.WordNotFoundError:
                current = "none" if j.action == JOURNAL_CREATE_WORD else "(詞條已不存在)"
            from dictionary_db import model as m
            if j.action == JOURNAL_CREATE_WORD:
                artifact = "詞條已存在" if db.query(m.Word.id).filter(m.Word.id == j.word_id).first() else "詞條不存在"
            elif j.action == JOURNAL_APPEND_SOURCE:
                row = db.query(m.WordSource.id).filter(m.WordSource.word_id == j.word_id, m.WordSource.source_id == j.details.get("source_id")).first()
                artifact = f"來源連結存在（列 id {row[0]}）" if row else "來源連結不存在"
            else:
                rows = db.query(m.WordExplanation.id).filter(m.WordExplanation.word_id == j.word_id,
                                                              m.WordExplanation.chinese_explanation == j.details.get("text")).all()
                artifact = f"符合的釋義 {len(rows)} 筆" if rows else "符合的釋義不存在"
        out.append({"id": j.pk, "batch": j.batch_id, "action": j.action, "tribe": j.tribe, "word_id": j.word_id,
                    "form": j.form.form, "intent": j.details.get("intent", ""), "before_hash": j.before_hash, "current_hash": current,
                    "dictionary_changed": current != j.before_hash, "artifact": artifact})
    return out


def resolve_pending(journal_id: int, as_: str, dry_run: bool) -> str:
    """人工對帳：as_='cancelled'（辭典沒有被寫入）只在目前雜湊等於寫入前雜湊時允許，並刪除該 pending；
    as_='applied'（辭典已寫入）只在雜湊已變且新增物仍存在時允許，補上寫入後雜湊與新增物 id 並改為 applied。"""
    j = WordlistApplyJournal.objects.filter(pk=journal_id, status=JOURNAL_PENDING).first()
    if j is None:
        raise ApplyError("找不到該筆 pending 紀錄")
    from dictionary_db import model as m
    with SessionLocal() as db:
        try:
            current = wa.tree_hash(db, j.word_id)
        except dw.WordNotFoundError:
            if j.action != JOURNAL_CREATE_WORD:
                raise ApplyError("詞條已不存在")
            current = "none"
        if as_ == "cancelled":
            if current != j.before_hash:
                raise ApplyError("詞條內容已和寫入前不同，不能當作『沒有寫入』；請改查是否為 applied")
            if not dry_run:
                j.delete()
            return "辭典未變動，已取消 pending" if not dry_run else "預覽：可取消"
        if as_ != "applied":
            raise ApplyError("as_ 必須是 applied 或 cancelled")
        if current == j.before_hash:
            raise ApplyError("詞條內容與寫入前相同，不能標為 applied")
        details = dict(j.details)
        if j.action == JOURNAL_CREATE_WORD:
            details["created"] = details.get("intent") != "verify_existing"   # 只是驗證既有詞條的紀錄，永遠不能推定為『由我們建立』
        elif j.action == JOURNAL_APPEND_SOURCE:
            row = db.query(m.WordSource).filter(m.WordSource.word_id == j.word_id, m.WordSource.source_id == details.get("source_id")).first()
            if row is None:
                raise ApplyError("找不到新增的來源連結，不能標為 applied")
            details.update(added=True, source_row_id=row.id)
        else:
            rows = db.query(m.WordExplanation).filter(m.WordExplanation.word_id == j.word_id,
                                                      m.WordExplanation.chinese_explanation == details.get("text")).all()
            if len(rows) != 1:
                raise ApplyError("找不到唯一符合的釋義，不能標為 applied")
            details["explanation_id"] = rows[0].id
    if dry_run:
        return "預覽：可標為 applied"
    j.after_hash, j.details, j.status, j.applied_at = current, details, JOURNAL_APPLIED, timezone.now()
    j.save(update_fields=["after_hash", "details", "status", "applied_at"])
    return "已標為 applied"
