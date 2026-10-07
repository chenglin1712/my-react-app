"""例句「整句都能對到辭典詞形」比例的量測（M6 的先行量測）：同一批句子、同一份辭典，比較舊方法與正式斷詞器。

為什麼要量：先前探索腳本（E3）報出「整句可逐詞標註」泰雅 36.7%、葛瑪蘭 46.9%，並觀察到未對到的詞形裡高頻的是 na、ta、i 與符號
"/"，推論是前處理問題。但那支腳本的斷詞來源是資料庫裡預先切好的注記詞（anaphora_item，只排除 is_symbol 的項目），不是翻譯功能
實際用的斷詞，而 translation_lexicon.tokenize() 本來就不會切出 "/"。所以先量，再決定要不要動任何東西。

【量的是什麼、不是什麼】這裡的「對到」一律指「正規化後精確等於某個辭典詞條（words.name）」，不含詞綴剝除、不含形態分析、
也【不含 translation_attested_form】——後者是從這批例句本身重建的，拿它來佐證同一批例句等於自己佐證自己（幾乎必然全部對到），
所以刻意不用。因此這些數字不是「翻譯佐證流程的覆蓋率」，只是「辭典詞條對例句的精確比對覆蓋率」，用來分辨斷詞差異與辭典缺詞。

四種口徑（同一批「有預先斷詞」的不重複例句上比較，才是同條件）：
- legacy：anaphora_item 的詞（不含 is_symbol、名稱非空）逐詞比對單詞詞條；
- production：translation_lexicon.tokenize(original_sentence) 逐詞比對單詞詞條；
- production_multiword：用與正式佐證流程相同的 token／run 規則，加上相同的詞條最長匹配策略——split_display_tokens 切成顯示片段，
  標點中斷相鄰性，相鄰的詞段做貪婪多詞最長匹配（窗口同 retrieve.MAX_HEADWORD_WINDOW），數字與外文字元片段算「未對到」（正式流程標
  unsupported）。它是「只允許詞條時重新做一次貪婪切分」，不是「跑完整正式流程再只統計詞條層」：正式流程在每個窗口大小依序檢查
  headword、attested，較長的 attested 片語可能先吃掉一段，所以兩者的切分在少數句子上會不同；
- 兩個「去空白」反事實（都不是現況，也不是完整的資料清洗模擬）：edge_whitespace_trimmed 只去詞條名稱的頭尾空白；
  whitespace_canonicalized 還會把內部的空白類字元（NBSP、tab、連續空白）收斂成單一空格。兩者的差距才能歸因於「內部空白」；
- production_multiword_on_all：同上，但涵蓋【全部】不重複例句（含沒有預先斷詞的句子）。

整句比例 = 全部單位都對到的句數 ÷ 至少有一個單位的句數；詞覆蓋 = 對到的詞次 ÷ 總詞次；macro_token_coverage = 先算每句的詞覆蓋再對句子平均
（整句比例會強烈懲罰長句，所以另列句長分層）。整句比例附 Wilson 95% 區間，並列 legacy 與 production 的配對比較（兩邊都過、只有一邊過）。

counterfactual_top_k_known：假設 production_multiword 未對到的詞形裡「詞次最高的前 K 種」都算已知，整句比例會是多少。這是【反事實估計】，
不是上限、也不是最佳解（整句覆蓋是組合問題，頻率最高的詞形不一定讓最多的句子完整），更不代表那些詞形是虛詞或缺詞——它只回答
「如果最常見的幾種都有人處理，整句比例大概會到哪裡」。

隱私：輸出含語料衍生的詞形（高頻未對到詞形）與計數，不含完整句子；語料若含人名、地名或未公開內容，請當成內部資料處理。
純函式部分不碰 DB；讀資料庫的部分只有 SELECT。
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable, Mapping, Sequence

from config.morphology_reporting import ratio
from config.translation_lexicon import (
    classify_display_piece, normalize_phrase, normalize_token, split_display_tokens, tokenize,
)

K_VALUES = (0, 5, 10, 25, 50, 100)
MAX_HEADWORD_WINDOW = 7   # 與 fastAPI/routes/translation/retrieve.py 的 MAX_HEADWORD_WINDOW 相同（有測試鎖住兩者一致）
LENGTH_BUCKETS = (("1-3", 1, 3), ("4-6", 4, 6), ("7-10", 7, 10), ("11+", 11, 10**9))

# 一個「單位」：(正規化後的字串, 佔幾個詞次, 是否對到辭典)
Unit = tuple[str, int, bool]


def _rate(k: int, n: int) -> float | None:
    return round(k / n, 6) if n else None


def _lexicon_as_stored(lexicon_set: Iterable[str]) -> set[str]:
    """照實際存放的詞條名稱（與正式流程一致）：只做 normalize_token（撇號統一、caret 移除、小寫），【不去頭尾空白】。
    正式查詢的 SQL 運算式（retrieve._NORM_EXPR_NAME）也不去空白，所以名稱帶頭尾空白的詞條（例如 'baqi '）
    永遠對不上 token 'baqi'——這是資料品質問題，不是比對方法問題。"""
    return {normalize_token(w) for w in lexicon_set if w and normalize_token(w)}


def _lexicon_edge_trimmed(lexicon_set: Iterable[str]) -> set[str]:
    """反事實一：只去詞條名稱的頭尾空白（normalize_token 之後 .strip()），內部空白不動。"""
    return {t for t in (normalize_token(w).strip() for w in lexicon_set if w) if t}


def _lexicon_canonicalized(lexicon_set: Iterable[str]) -> set[str]:
    """反事實二：頭尾空白去掉，內部的空白類字元（NBSP、tab、連續空白）也收斂成單一空格（normalize_phrase 的規則）。"""
    return {normalize_phrase(w.split()) for w in lexicon_set if w and w.strip()}


def headword_whitespace_stats(raw_names: Iterable[str | None]) -> dict:
    """從【原始資料列】（不是已去重的詞形集合）統計詞條名稱的空白狀況：幾列、哪一種空白、去空白後有多少列會與別的列同名。
    撞名不代表該合併（同形異義、不同詞性或方言都合理），只是清洗時必須人工看的清單規模。"""
    rows = [n for n in raw_names if n]
    norm = [normalize_token(n) for n in rows]
    padded = [n for n in norm if n and n != n.strip()]
    stripped_counts = Counter(n.strip() for n in norm if n.strip())
    collided_forms = {f for f, c in stripped_counts.items() if c > 1}
    padded_in_collision = sum(1 for n in padded if n.strip() in collided_forms)
    return {
        "rows": len(rows), "padded_rows": len(padded),
        "leading_rows": sum(1 for n in padded if n != n.lstrip()),
        "trailing_rows": sum(1 for n in padded if n != n.rstrip()),
        "non_ascii_space_rows": sum(1 for n in norm if n and any(c.isspace() and c != " " for c in n)),
        "inner_multi_space_rows": sum(1 for n in norm if n and "  " in n.strip()),
        "padded_distinct_forms": len(set(padded)),
        "rows_colliding_after_edge_trim": sum(c for c in stripped_counts.values() if c > 1),
        "collision_groups_after_edge_trim": len(collided_forms),
        "padded_rows_in_a_collision": padded_in_collision,
    }


def whitespace_padded(lexicon_set: Iterable[str]) -> list[str]:
    """名稱有頭尾空白的詞條（正規化、去重後的詞形）。"""
    return sorted(w for w in {normalize_token(x) for x in lexicon_set if x} if w and w != w.strip())


def _single_units(tokens: Iterable[str], known: set[str]) -> list[Unit]:   # token 本身不含空白，所以 `in known` 等於單詞比對
    out = []
    for t in tokens:
        n = normalize_token(t)
        if n:
            out.append((n, 1, n in known))
    return out


def _production_units(sentence: str, known_all: set[str], window: int = MAX_HEADWORD_WINDOW) -> list[Unit]:
    """模擬 retrieve.corroborate_full_sentence 的切法與多詞最長匹配（只比對詞條）。"""
    display = split_display_tokens(sentence)
    classes = [classify_display_piece(p) for p in display]
    units: list[Unit] = []
    i = 0
    while i < len(display):
        if classes[i] == "punct":
            i += 1
        elif classes[i] == "foreign":
            piece = display[i].strip()   # 外文片段是兩個詞之間的間隔字串，會帶著相鄰的空白
            units.append((normalize_token(piece) or piece, 1, False))
            i += 1
        else:
            j = i
            while j < len(display) and classes[j] == "word":
                j += 1
            run = display[i:j]
            k = 0
            while k < len(run):
                for w in range(min(window, len(run) - k), 0, -1):
                    phrase = normalize_phrase(run[k:k + w])
                    if phrase in known_all:
                        units.append((phrase, w, True))
                        k += w
                        break
                else:
                    units.append((normalize_token(run[k]), 1, False))
                    k += 1
            i = j
    return units


def _score(sentences: Sequence[Sequence[Unit]]) -> dict:
    scored = [s for s in sentences if s]
    tokens = sum(u[1] for s in scored for u in s)
    covered = sum(u[1] for s in scored for u in s if u[2])
    whole = sum(1 for s in scored if all(u[2] for u in s))
    per_sentence = [sum(u[1] for u in s if u[2]) / sum(u[1] for u in s) for s in scored]
    r = ratio(whole, len(scored))
    return {
        "sentences": len(scored), "sentences_without_tokens": len(sentences) - len(scored),
        "tokens": tokens, "tokens_known": covered, "token_coverage": _rate(covered, tokens),
        "macro_token_coverage": _rate_float(sum(per_sentence), len(per_sentence)),
        "whole_sentence_known": whole, "whole_sentence_rate": r["value"],
        "whole_sentence_ci95": [r["lo"], r["hi"]],
    }


def _rate_float(total: float, n: int) -> float | None:
    return round(total / n, 6) if n else None


def _unmatched(sentences: Sequence[Sequence[Unit]], top_n: int) -> dict:
    counts: Counter = Counter()
    in_sentences: Counter = Counter()
    for s in sentences:
        for form in {u[0] for u in s if not u[2]}:
            in_sentences[form] += 1
        for u in s:
            if not u[2]:
                counts[u[0]] += u[1]
    total = sum(counts.values())
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return {
        "unmatched_tokens": total, "unmatched_types": len(counts),
        "non_letter_tokens": sum(c for f, c in counts.items() if not any(ch.isalpha() for ch in f)),
        "top": [{"form": f, "count": c, "sentences": in_sentences[f], "share": _rate(c, total)} for f, c in ordered[:top_n]],
    }


def _counterfactual(sentences: Sequence[Sequence[Unit]]) -> dict:
    scored = [s for s in sentences if s]
    counts: Counter = Counter(u[0] for s in scored for u in s if not u[2])
    ordered = [f for f, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    out = {}
    for k in K_VALUES:
        extra = set(ordered[:k])
        whole = sum(1 for s in scored if all(u[2] or u[0] in extra for u in s))
        out[str(k)] = _rate(whole, len(scored))
    return out


def _by_length(sentences: Sequence[Sequence[Unit]]) -> dict:
    scored = [s for s in sentences if s]
    out = {}
    for label, lo, hi in LENGTH_BUCKETS:
        group = [s for s in scored if lo <= sum(u[1] for u in s) <= hi]
        whole = sum(1 for s in group if all(u[2] for u in s))
        out[label] = {"sentences": len(group), "whole_sentence_rate": _rate(whole, len(group))}
    return out


def _paired(a: Sequence[Sequence[Unit]], b: Sequence[Sequence[Unit]]) -> dict:
    """同一批句子在兩種斷詞下「整句都對到」的配對比較（順序對應）。"""
    both = a_only = b_only = neither = 0
    for sa, sb in zip(a, b):
        if not sa or not sb:
            continue
        pa, pb = all(u[2] for u in sa), all(u[2] for u in sb)
        both += pa and pb
        a_only += pa and not pb
        b_only += pb and not pa
        neither += not pa and not pb
    return {"both_pass": both, "first_only_pass": a_only, "second_only_pass": b_only, "neither_pass": neither}


def duplicate_stats(rows: Sequence[tuple[int, str | None]], legacy_by_id: Mapping[int, Sequence[str]]) -> dict:
    """重複句的敏感度：同文句有幾列、它們的預先斷詞是否一致。rows 是 (id, 原句)；legacy_by_id 涵蓋所有列。"""
    by_text: dict[str, list[int]] = {}
    for sid, text in rows:
        if text:
            by_text.setdefault(text, []).append(sid)
    conflicting = 0
    for ids in by_text.values():
        sequences = {tuple(normalize_token(t) for t in legacy_by_id.get(i, ()) if normalize_token(t)) for i in ids}
        sequences.discard(())
        conflicting += len(sequences) > 1
    total = sum(len(v) for v in by_text.values())
    return {
        "sentence_rows": total, "unique_texts": len(by_text), "duplicate_rows": total - len(by_text),
        "texts_with_conflicting_segmentation": conflicting,
    }


def _views(known: set[str], ids: Sequence[int], sentences: Mapping[int, str], legacy_tokens: Mapping[int, Sequence[str]],
           top_n: int, full: bool) -> tuple[dict, list[int], list[list[Unit]]]:
    """一種詞條口徑下的各種量測；回傳 (結果, 比較用的句子 id, production_multiword 的單位序列)。"""
    segmented = [i for i in ids if _single_units(legacy_tokens.get(i, ()), known)]
    legacy = [_single_units(legacy_tokens[i], known) for i in segmented]
    prod_single = [_single_units(tokenize(sentences[i]), known) for i in segmented]
    prod_multi = [_production_units(sentences[i], known) for i in segmented]
    out = {
        "legacy_on_segmented": _score(legacy),
        "production_on_segmented": _score(prod_single),
        "production_multiword_on_segmented": _score(prod_multi),
        "production_multiword_on_all": _score([_production_units(sentences[i], known) for i in ids]),
        "paired_legacy_vs_production": _paired(legacy, prod_single),
        "production_multiword_unmatched": _unmatched(prod_multi, top_n),
    }
    if full:
        out.update({
            "legacy_unmatched": _unmatched(legacy, top_n),
            "production_unmatched": _unmatched(prod_single, top_n),
            "production_multiword_by_length": _by_length(prod_multi),
            "counterfactual_top_k_known": _counterfactual(prod_multi),
        })
    return out, segmented, prod_multi


def measure_tribe(lexicon_set: Iterable[str], sentences: Mapping[int, str], legacy_tokens: Mapping[int, Sequence[str]],
                  top_n: int = 15) -> dict:
    """sentences：sentence_id -> 原句（已依文字去重）；legacy_tokens：sentence_id -> 預先斷詞的詞（只含有斷詞的句子）。
    lexicon_set 可以是原始詞條名稱（含重複、未正規化）；這裡自己正規化。

    頂層各欄位用「照實際存放」的詞條（與正式流程一致）；counterfactuals 是兩種「去空白」的反事實，
    兩者與現況的差距才是空白造成的對不上，且 edge 與 canonicalized 之間的差距才可歸因於內部空白。"""
    lexicon_set = list(lexicon_set)
    stored = _lexicon_as_stored(lexicon_set)
    edge, canon = _lexicon_edge_trimmed(lexicon_set), _lexicon_canonicalized(lexicon_set)
    ids = sorted(sentences)
    main, segmented, prod_multi = _views(stored, ids, sentences, legacy_tokens, top_n, full=True)
    cf_edge, _, multi_edge = _views(edge, ids, sentences, legacy_tokens, top_n, full=False)
    cf_canon, _, multi_canon = _views(canon, ids, sentences, legacy_tokens, top_n, full=False)
    padded = whitespace_padded(lexicon_set)
    return {
        "lexicon_forms": len(stored), "lexicon_multiword_forms": sum(1 for w in stored if " " in w.strip()),
        "whitespace_padded_headwords": {"distinct_forms": len(padded), "examples": padded[:10]},
        "unique_sentences": len(ids), "sentences_with_segmentation": len(segmented),
        **main,
        "counterfactuals": {
            "note": "反事實：詞條名稱去空白後的對到比例；不是現況，也不是完整的資料清洗模擬，也不代表這些詞條一定該被合併",
            "edge_whitespace_trimmed": {
                "lexicon_forms": len(edge), **cf_edge,
                "additional_tokens_matched": cf_edge["production_multiword_on_segmented"]["tokens_known"]
                - main["production_multiword_on_segmented"]["tokens_known"],
                "paired_stored_vs_this_production_multiword": _paired(prod_multi, multi_edge),
            },
            "whitespace_canonicalized": {
                "lexicon_forms": len(canon), **cf_canon,
                "additional_tokens_matched": cf_canon["production_multiword_on_segmented"]["tokens_known"]
                - main["production_multiword_on_segmented"]["tokens_known"],
                "paired_stored_vs_this_production_multiword": _paired(prod_multi, multi_canon),
            },
        },
    }
