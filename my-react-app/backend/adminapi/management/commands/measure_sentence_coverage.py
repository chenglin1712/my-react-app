"""唯讀：量測例句「整句都能對到辭典詞形」的比例——舊方法（預先斷詞的注記詞）對正式斷詞器，附未對到詞形的頻率與反事實估計。

  python manage.py measure_sentence_coverage                       # 泰雅、葛瑪蘭
  python manage.py measure_sentence_coverage --tribe amis --format json
  python manage.py measure_sentence_coverage --output coverage.json --format json    # 原子寫入

方法、口徑與限制見 adminapi/sentence_coverage.py。這是 M6（高頻未命中詞形佇列）動工前的量測：先量到再決定要不要改前處理。
注意：「未對到」只代表「沒有對應的辭典詞條（精確比對）」，不能直接解讀成辭典缺詞——也可能是詞綴／黏著詞形、拼寫變體或標註問題，
需要族語專家判斷。輸出含語料衍生的詞形與計數（不含完整句子），請當成內部資料。
只做 SELECT；不改資料庫、不改任何設定。
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from adminapi.management.commands.report_morphology_capabilities import write_atomic
from adminapi.sentence_coverage import duplicate_stats, headword_whitespace_stats, measure_tribe
from config.tribes import TRIBES
from dictionary_db.connect import SessionLocal
from dictionary_db.model import (
    Word, WordExplanation, WordExplanationAnaphora, WordExplanationAnaphoraItem, WordExplanationSentence,
)

DEFAULT_TRIBES = ("tayal", "kavalan")
_CHUNK = 500


def dedupe_sentences(rows) -> dict[int, str]:
    """(id, 原句) 列 -> {id: 原句}：同一個原句只留 id 最小的那筆。結果只由資料決定，與列的回傳順序無關
    （資料庫沒有保證順序；PostgreSQL 與 SQLite 的預設順序也不同）。空句丟掉。
    去重只比對原始字串（大小寫、空白不同的句子算不同句），所以報表叫 unique_texts 而不是「語意不重複」。"""
    lowest: dict[str, int] = {}
    for sid, original in rows:
        if original and (original not in lowest or sid < lowest[original]):
            lowest[original] = sid
    return {sid: original for original, sid in sorted(lowest.items(), key=lambda kv: kv[1])}


def load_sentences(db, tribe_id: str) -> tuple[dict[int, str], dict[int, list[str]], dict]:
    """(sentence_id -> 原句, sentence_id -> 預先斷詞的詞, 統計)。同一個原句只留 id 最小的那筆，結果與列順序無關。
    統計包含重複句與其斷詞是否一致，以及斷詞資料的漏斗（有 anaphora 列 → 有項目 → 過濾符號後仍有詞）。"""
    rows = (db.query(WordExplanationSentence.id, WordExplanationSentence.original_sentence)
            .join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
            .join(Word, Word.id == WordExplanation.word_id)
            .filter(Word.tribe_id == tribe_id).all())
    sentences = dedupe_sentences(rows)
    all_ids = [sid for sid, original in rows if original]
    legacy_all: dict[int, list[str]] = {}
    with_anaphora: set[int] = set()
    with_items: set[int] = set()
    for i in range(0, len(all_ids), _CHUNK):
        chunk = all_ids[i:i + _CHUNK]
        anaphora_ids = db.query(WordExplanationAnaphora.sentence_id).filter(WordExplanationAnaphora.sentence_id.in_(chunk)).distinct().all()
        with_anaphora.update(sid for (sid,) in anaphora_ids)
        items = (db.query(WordExplanationAnaphora.sentence_id, WordExplanationAnaphoraItem.name,
                          WordExplanationAnaphora.is_symbol)
                 .join(WordExplanationAnaphoraItem, WordExplanationAnaphoraItem.anaphora_id == WordExplanationAnaphora.id)
                 .filter(WordExplanationAnaphora.sentence_id.in_(chunk))
                 .order_by(WordExplanationAnaphora.sentence_id, WordExplanationAnaphora.sort_order,
                           WordExplanationAnaphoraItem.sort_order, WordExplanationAnaphoraItem.id).all())
        for sid, name, is_symbol in items:
            with_items.add(sid)
            if not is_symbol and name:
                legacy_all.setdefault(sid, []).append(name)
    kept = set(sentences)
    stats = {
        **duplicate_stats(rows, legacy_all),
        "segmentation_funnel": {
            "unique_texts": len(sentences),
            "with_anaphora_rows": len(kept & with_anaphora),
            "with_anaphora_items": len(kept & with_items),
            "with_tokens_after_filtering_symbols": len(kept & set(legacy_all)),
        },
    }
    return sentences, {sid: toks for sid, toks in legacy_all.items() if sid in kept}, stats


def build(db, slugs, top_n: int) -> dict:
    out = []
    for tribe in TRIBES:
        if tribe.slug not in slugs:
            continue
        sentences, legacy, stats = load_sentences(db, tribe.id)
        # 用【原始資料列】的詞條名稱：空白統計要看列數與撞名，不能先去重或正規化
        names = [n for (n,) in db.query(Word.name).filter(Word.tribe_id == tribe.id).all() if n]
        out.append({"tribe": tribe.slug, "sentence_data": stats, "headword_whitespace": headword_whitespace_stats(names),
                    **measure_tribe(names, sentences, legacy, top_n)})
    return {"measurement_version": 3, "tribes": out}


def _pct(x) -> str:
    return "—" if x is None else f"{x:.1%}"


def _ci(m) -> str:
    return f"{_pct(m['whole_sentence_rate'])}（95% 區間 {_pct(m['whole_sentence_ci95'][0])}–{_pct(m['whole_sentence_ci95'][1])}）"


def render_table(report: dict) -> str:
    lines = []
    for t in report["tribes"]:
        L, P = t["legacy_on_segmented"], t["production_on_segmented"]
        M, A = t["production_multiword_on_segmented"], t["production_multiword_on_all"]
        E = t["counterfactuals"]["edge_whitespace_trimmed"]
        K = t["counterfactuals"]["whitespace_canonicalized"]
        d, f = t["sentence_data"], t["sentence_data"]["segmentation_funnel"]
        w, pad = t["headword_whitespace"], t["whitespace_padded_headwords"]
        lines.append(f"{t['tribe']}｜詞條 {w['rows']} 列（{t['lexicon_forms']} 種正規化詞形，多詞 {t['lexicon_multiword_forms']}）｜"
                     f"句子列 {d['sentence_rows']}，不重複文字 {d['unique_texts']}（重複 {d['duplicate_rows']} 列，斷詞不一致 "
                     f"{d['texts_with_conflicting_segmentation']} 組）")
        lines.append(f"  詞條名稱帶空白：{w['padded_rows']} 列（前導 {w['leading_rows']}／尾端 {w['trailing_rows']}／非 ASCII 空白 "
                     f"{w['non_ascii_space_rows']}／內部連續空白 {w['inner_multi_space_rows']}；{w['padded_distinct_forms']} 種詞形）。"
                     f"正式查詢不去空白，這些詞條對不上同形的 token；例：" + "、".join(repr(x) for x in pad["examples"][:5]))
        lines.append(f"  去頭尾空白後會與別列同名：{w['rows_colliding_after_edge_trim']} 列、{w['collision_groups_after_edge_trim']} 組"
                     f"（其中帶空白的 {w['padded_rows_in_a_collision']} 列）——同名不一定該合併，需人工看")
        lines.append(f"  斷詞資料漏斗：有 anaphora 列 {f['with_anaphora_rows']} → 有項目 {f['with_anaphora_items']} → 過濾符號後仍有詞 "
                     f"{f['with_tokens_after_filtering_symbols']}（比較用的 {t['sentences_with_segmentation']} 句）")
        lines.append(f"  整句都對到辭典詞條（照實際存放；同一批 {P['sentences']} 句）：")
        lines.append(f"    舊方法（預先斷詞）        {_ci(L)}")
        lines.append(f"    正式斷詞器＋單詞詞條      {_ci(P)}")
        lines.append(f"    正式切法＋多詞最長匹配    {_ci(M)}｜涵蓋全部 {A['sentences']} 句：{_pct(A['whole_sentence_rate'])}")
        pr = t["paired_legacy_vs_production"]
        lines.append(f"  舊方法 vs 正式斷詞器（逐句配對）：兩邊都對 {pr['both_pass']}｜只有舊方法對 {pr['first_only_pass']}"
                     f"｜只有正式斷詞器對 {pr['second_only_pass']}｜都不對 {pr['neither_pass']}")
        lines.append("  反事實（非現況、非完整清洗模擬；正式切法＋多詞）整句比例："
                     f"只去頭尾空白 {_pct(E['production_multiword_on_segmented']['whole_sentence_rate'])}"
                     f"（多對到 {E['additional_tokens_matched']} 詞次）"
                     f"｜再加內部空白收斂 {_pct(K['production_multiword_on_segmented']['whole_sentence_rate'])}"
                     f"（多對到 {K['additional_tokens_matched']} 詞次）")
        pe = E["paired_stored_vs_this_production_multiword"]
        lines.append(f"  照實際存放 vs 只去頭尾空白（逐句）：兩邊都對 {pe['both_pass']}｜只有照實際存放對 {pe['first_only_pass']}"
                     f"｜只有去頭尾空白後對 {pe['second_only_pass']}｜都不對 {pe['neither_pass']}")
        lines.append(f"  詞覆蓋：舊 {_pct(L['token_coverage'])}｜正式單詞 {_pct(P['token_coverage'])}｜正式多詞 {_pct(M['token_coverage'])}"
                     f"；逐句平均 {_pct(M['macro_token_coverage'])}")
        lines.append("  依句長（詞數）的整句比例（正式切法＋多詞）：" + "｜".join(
            f"{k} 詞 {_pct(v['whole_sentence_rate'])}（{v['sentences']} 句）" for k, v in t["production_multiword_by_length"].items()))
        lu, mu = t["legacy_unmatched"], t["production_multiword_unmatched"]
        lines.append(f"  未對到：舊方法 {lu['unmatched_tokens']} 詞次（{lu['unmatched_types']} 種，非字母 {lu['non_letter_tokens']}）"
                     f"｜正式切法 {mu['unmatched_tokens']} 詞次（{mu['unmatched_types']} 種，非字母 {mu['non_letter_tokens']}）")
        lines.append("  正式切法下未對到的高頻詞形（詞次／句數）：" + "、".join(
            f"{i['form']} {i['count']}／{i['sentences']}" for i in mu["top"]))
        lines.append("  反事實：若詞次最高的前 K 種未對到詞形都算已知（非上限、非最佳解）：" + "｜".join(
            f"K={k} {_pct(v)}" for k, v in t["counterfactual_top_k_known"].items()))
    return "\n".join(lines)


class Command(BaseCommand):
    help = "唯讀：例句整句對到辭典詞形的比例，舊方法對正式斷詞器（M6 先行量測）。"

    def add_arguments(self, parser):
        parser.add_argument("--tribe", action="append", default=None, help=f"族語 slug（可重複；預設 {', '.join(DEFAULT_TRIBES)}）")
        parser.add_argument("--top-n", type=int, default=15)
        parser.add_argument("--format", choices=["table", "json"], default="table")
        parser.add_argument("--output", default=None, help="寫到這個檔案（原子寫入）；省略則印到標準輸出")

    def handle(self, *args, **opts):
        known = {t.slug for t in TRIBES}
        slugs = set(opts["tribe"] or DEFAULT_TRIBES)
        if slugs - known:
            raise CommandError(f"未知的族語：{', '.join(sorted(slugs - known))}")
        if not 0 <= opts["top_n"] <= 200:
            raise CommandError("--top-n 必須介於 0 到 200")
        db = SessionLocal()
        try:
            report = build(db, slugs, opts["top_n"])
        except Exception as exc:
            raise CommandError(f"量測失敗：{type(exc).__name__}")
        finally:
            db.close()
        text = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) if opts["format"] == "json"
                else render_table(report)) + "\n"
        if opts["output"]:
            out = Path(opts["output"])
            if not out.parent.is_dir():
                raise CommandError("輸出資料夾不存在")
            try:
                write_atomic(out, text)
            except OSError as exc:
                raise CommandError(f"寫入失敗：{type(exc).__name__}")
            self.stdout.write(f"已寫入 {out.name}（{len(text)} 字元）")
        else:
            self.stdout.write(text, ending="")
