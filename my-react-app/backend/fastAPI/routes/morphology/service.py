"""詞形分析：輸入一個族語詞形，回傳可能的詞根、詞綴切分、詞綴功能、辭典例句與信心。

跟翻譯的佐證檢核是兩件不同的事，不能混為一談：
- 佐證檢核（translation/morph.py）要「判斷這個詞存不存在」，錯放行代價高，所以只用通過
  獨立測試校準的少數規則、只用直接命中、預設關閉。
- 這裡是「讓使用者探索一個詞的構成」，使用者看得到每個結果的依據與信心，所以可以給出更多
  候選，但每個候選都明確標示它的來源與信心，絕不把低信心的結果包裝成事實：

  來源／信心        意義
  dictionary       辭典本身就標註了這個詞形的詞根（最可靠）
  rule  / high     辭典歸納出的詞綴規則，且該規則通過獨立測試校準（見 config/morphology_calibration.py）
  rule  / medium   辭典歸納出的詞綴規則，但沒通過校準（準確度因族語與規則而異，只供參考）
  similar / low    不是形態分析，只是「拼寫相近」的詞（編輯距離 1）；實測第一名只有約 16~25% 是對的，
                   只用來回答「你是不是想找…」

分析結果只回答「這個詞形可能怎麼構成」，不代表這個詞形在族語裡真的存在或被使用。

什麼時候才顯示規則分析（避免亂拆詞根）：辭典約一半的詞條沒有標註詞根，它們多半本身就是
詞根，規則很容易把它們錯拆（例如泰雅語 blaq「好」被拆成 b-l-aq）。所以：
- 詞條有辭典標註的詞根 → 只顯示辭典的，不再疊上規則結果（規則結果只會製造矛盾）；
- 詞條沒有標註 → 只顯示通過校準的規則（高信心），其餘不顯示；
- 辭典查不到的詞形（沒有詞條可以參考）→ 才顯示全部規則結果（高／中）與相近的詞。

全部只用 ORM 查詢，不用任何單一資料庫專有的 SQL（正式環境是 PostgreSQL、SQLite 當備份）。
每個族語的分析器（規則歸納、詞庫索引）在第一次用到時建立一次並快取，辭典異動時由
/internal/cache/invalidate 失效。
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from config import morphology as M
from config import translation_lexicon as lexicon
from config.tribes import TRIBES
from dictionary_db.model import (
    GrammarAffix, TranslationAttestedForm, Word, WordExplanationSentence, WordExplanationSentenceAudio,
)
from dictionary_db.word_data import load_audio_items_for_words, load_explanation_items_for_words

from ..keyed_cache import KeyedCache
from ..translation import morph as translation_morph
from .schemas import (
    AnalyzeResponse, CandidateOut, ExampleOut, RuleOut, SegmentOut, TokenInfoOut,
)

logger = logging.getLogger(__name__)

# 衍生詞標註少於這個數量的族語，歸納出的規則沒有統計意義（布農語、排灣語目前都不到），
# 只顯示辭典本身標註的詞根，不做規則分析。
MIN_PAIRS_FOR_RULES = 500
MIN_ROOT_LEN = 3
MAX_RULE_CANDIDATES = 5
MAX_SIMILAR = 3
MAX_HOMOGRAPHS = 3            # 同形異義詞（同一拼寫多個詞條）最多取幾個
MAX_EXAMPLES = 2
MAX_WORD_LEN = 40


class UnsupportedTribeError(ValueError):
    pass


class InvalidWordError(ValueError):
    pass


@dataclass(frozen=True)
class _TribeData:
    tribe_id: str
    lexicon_index: dict[str, tuple[str, ...]]     # 正規化詞條名 -> word ids
    n_pairs: int
    rules_available: bool
    exact: M.MorphAnalyzer | None                  # 只用直接命中
    fuzzy: M.MorphAnalyzer | None                  # 容許編輯距離 1，只用來產生「相近的詞」
    admitted: frozenset[M.MorphRule]               # 通過獨立測試校準的規則（空＝沒有）
    functions: dict[str, str]


@dataclass
class _WordDetail:
    name: str
    gloss: str | None
    audio_file_id: str | None
    sentences: list[ExampleOut]


_CACHE: KeyedCache[str, _TribeData] = KeyedCache()


def invalidate(tribe_id: str | None = None) -> None:
    """辭典或詞綴表有異動時呼叫。None＝全部族語。"""
    if tribe_id is None:
        for key in _CACHE.keys():
            _CACHE.invalidate(key)
    else:
        _CACHE.invalidate(tribe_id)


def _build_tribe_data(db: Session, tribe_id: str, full_name: str) -> _TribeData:
    rows = db.query(Word.id, Word.name, Word.derivative_root).filter(Word.tribe_id == tribe_id).all()

    index: dict[str, list[str]] = {}
    for word_id, name, _ in rows:
        norm = lexicon.normalize_token(name or "")
        if norm:
            index.setdefault(norm, []).append(word_id)
    lexicon_index = {k: tuple(v) for k, v in index.items()}
    lexicon_set = {k for k in lexicon_index if " " not in k}

    pairs, _ = M.build_pairs([(full_name, name, root) for _, name, root in rows if root and root.strip()])
    rules_available = len(pairs) >= MIN_PAIRS_FOR_RULES

    exact = fuzzy = None
    if rules_available:
        rules = M.induce_rules(pairs, lexicon_set)
        precision = M.estimate_rule_precision(pairs, rules, lexicon_set)
        common = dict(precision=precision, rank_by="precision", min_root_len=MIN_ROOT_LEN)
        exact = M.MorphAnalyzer(rules, lexicon_set, max_edit=0, **common)
        fuzzy = M.MorphAnalyzer(rules, lexicon_set, max_edit=1, **common)

    # 通過獨立測試校準的規則：沿用翻譯佐證檢核載入的那一份（含詞庫指紋驗證，不一致就是空）。
    entry = translation_morph.get_entry(db, tribe_id)
    admitted = frozenset(entry.analyzer.rules) if entry.analyzer is not None else frozenset()

    affix_rows = [{"affix": a, "function": f}
                  for a, f in db.query(GrammarAffix.affix, GrammarAffix.function)
                  .filter(GrammarAffix.tribe_id == tribe_id).all()]
    return _TribeData(tribe_id, lexicon_index, len(pairs), rules_available, exact, fuzzy, admitted,
                      M.build_function_table(affix_rows))


def _tribe_data(db: Session, tribe) -> _TribeData:
    return _CACHE.get_or_compute(tribe.id, lambda: _build_tribe_data(db, tribe.id, tribe.full_name))


def _resolve_tribe(value: str):
    for t in TRIBES:
        if value in (t.slug, t.full_name):
            return t
    raise UnsupportedTribeError(f"不支援的族語：{value}")


def _normalize_input(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        raise InvalidWordError("請輸入要分析的詞形")
    if re.search(r"\s", text):
        raise InvalidWordError("請一次輸入一個詞形，不要包含空白")
    if len(text) > MAX_WORD_LEN:
        raise InvalidWordError(f"詞形太長（上限 {MAX_WORD_LEN} 個字元）")
    norm = lexicon.normalize_token(text).strip("-")
    if not norm or not M._is_valid_derived(norm):
        raise InvalidWordError("只能輸入族語拼寫用的英文字母、撇號與底線")
    return norm


def _load_details(db: Session, word_ids: list[str]) -> dict[str, _WordDetail]:
    if not word_ids:
        return {}
    names = dict(db.query(Word.id, Word.name).filter(Word.id.in_(word_ids)).all())
    explanations = load_explanation_items_for_words(db, word_ids=word_ids)
    audios = load_audio_items_for_words(db, word_ids=word_ids)

    out: dict[str, _WordDetail] = {}
    for wid in word_ids:
        gloss = None
        sentences: list[ExampleOut] = []
        for exp in explanations.get(wid, []):
            if gloss is None and (exp.get("chineseExplanation") or "").strip():
                gloss = exp["chineseExplanation"].strip()
            for sent in exp.get("sentenceItems") or []:
                original = (sent.get("originalSentence") or "").strip()
                chinese = (sent.get("chineseSentence") or "").strip()
                if original and chinese:
                    audio_items = sent.get("audioItems") or []
                    sentences.append(ExampleOut(
                        original=original, chinese=chinese,
                        audioFileId=audio_items[0].get("fileId") if audio_items else None,
                    ))
        word_audio = audios.get(wid) or []
        out[wid] = _WordDetail(names.get(wid, ""), gloss, word_audio[0].get("fileId") if word_audio else None, sentences)
    return out


def _merge_details(ids: tuple[str, ...], details: dict[str, _WordDetail]):
    """同形異義的多個詞條合成一份：釋義取各自第一筆（用「／」連接）、音檔取第一個有的、例句最多 MAX_EXAMPLES 句。"""
    picked = [details[i] for i in ids[:MAX_HOMOGRAPHS] if i in details]
    glosses = list(dict.fromkeys(d.gloss for d in picked if d.gloss))
    audio = next((d.audio_file_id for d in picked if d.audio_file_id), None)
    examples: list[ExampleOut] = []
    for d in picked:
        for s in d.sentences:
            if len(examples) < MAX_EXAMPLES and s.original not in {e.original for e in examples}:
                examples.append(s)
    return (" ／ ".join(glosses) or None), audio, examples


def _attested(db: Session, tribe_id: str, norm: str) -> tuple[bool, ExampleOut | None]:
    """(這個詞形有沒有在辭典例句裡出現過, 它第一次出現的那個例句)。"""
    row = (db.query(TranslationAttestedForm.source_sentence_id)
           .filter(TranslationAttestedForm.tribe_id == tribe_id, TranslationAttestedForm.surface_form_norm == norm)
           .first())
    if row is None:
        return False, None
    sent = (db.query(WordExplanationSentence).filter(WordExplanationSentence.id == row[0]).first()
            if row[0] is not None else None)
    if sent is None or not (sent.original_sentence or "").strip():
        return True, None
    audio = (db.query(WordExplanationSentenceAudio.file_id)
             .filter(WordExplanationSentenceAudio.sentence_id == sent.id)
             .order_by(WordExplanationSentenceAudio.sort_order).first())
    return True, ExampleOut(original=sent.original_sentence.strip(), chinese=(sent.chinese_sentence or "").strip(),
                            audioFileId=audio[0] if audio else None, isTokenSource=True)


def _segments_and_rule(rule: M.MorphRule, norm: str, functions: dict[str, str]):
    segs = rule.segment(norm)
    return (
        [SegmentOut(text=t, kind=k) for t, k in segs] if segs else None,
        RuleOut(marker=rule.marker, kind=rule.kind, function=M.describe_rule(rule, functions)),
    )


def analyze(db: Session, tribe_value: str, word: str) -> AnalyzeResponse:
    tribe = _resolve_tribe(tribe_value)
    norm = _normalize_input(word)
    data = _tribe_data(db, tribe)

    own_ids = data.lexicon_index.get(norm, ())
    is_attested, attested_sentence = (False, None) if own_ids else _attested(db, tribe.id, norm)

    # ---- 辭典標註的詞根
    dictionary_roots: list[tuple[str, M.MorphRule | None]] = []
    if own_ids:
        for _, raw_root in db.query(Word.id, Word.derivative_root).filter(Word.id.in_(list(own_ids))).all():
            roots, reason = M.clean_root_field(raw_root, norm)
            for root in roots if reason is None else ():
                if root in data.lexicon_index and root not in {r for r, _ in dictionary_roots}:
                    found = M.derive_rules(norm, root)
                    dictionary_roots.append((root, M.simplest_rule(found) if found else None))
    dictionary_root_names = {r for r, _ in dictionary_roots}

    # ---- 規則分析（直接命中）。顯示條件見模組說明。
    rule_hits: list[M.Analysis] = []
    if data.exact is not None and not dictionary_roots:
        for a in data.exact.analyze(norm, top_n=MAX_RULE_CANDIDATES * 2):
            if len(rule_hits) >= MAX_RULE_CANDIDATES:
                continue
            if own_ids and a.rule not in data.admitted:
                continue          # 辭典詞條沒有標註詞根：只信通過校準的規則
            rule_hits.append(a)

    # ---- 拼寫相近（只在完全沒有其他線索、且這個詞形本身不在辭典／語料裡時才給）
    similar: list[M.Analysis] = []
    if data.fuzzy is not None and not own_ids and not is_attested and not rule_hits:
        seen: set[str] = set()
        for a in data.fuzzy.analyze(norm, top_n=MAX_SIMILAR * 3):
            if a.stage == "fuzzy" and a.root not in seen and len(similar) < MAX_SIMILAR:
                seen.add(a.root)
                similar.append(a)

    # ---- 一次撈齊所有要顯示的詞條細節
    roots = [r for r, _ in dictionary_roots] + [a.root for a in rule_hits] + [a.root for a in similar]
    ids_needed = list(dict.fromkeys(
        list(own_ids[:MAX_HOMOGRAPHS]) + [i for r in roots for i in data.lexicon_index[r][:MAX_HOMOGRAPHS]]
    ))
    details = _load_details(db, ids_needed)

    def base(root: str):
        ids = data.lexicon_index[root]
        gloss, audio, examples = _merge_details(ids, details)
        return dict(root=root, rootWordIds=list(ids[:MAX_HOMOGRAPHS]), gloss=gloss, audioFileId=audio, examples=examples)

    candidates: list[CandidateOut] = []
    for root, rule in dictionary_roots:
        segments, rule_out = _segments_and_rule(rule, norm, data.functions) if rule else (None, None)
        candidates.append(CandidateOut(source="dictionary", confidence="dictionary", segments=segments,
                                       rule=rule_out, **base(root)))
    for a in rule_hits:
        segments, rule_out = _segments_and_rule(a.rule, norm, data.functions)
        candidates.append(CandidateOut(
            source="rule", confidence="high" if a.rule in data.admitted else "medium",
            segments=segments, rule=rule_out, **base(a.root),
        ))
    for a in similar:
        candidates.append(CandidateOut(source="similar", confidence="low", distance=a.distance, **base(a.root)))

    gloss, audio, _ = _merge_details(own_ids, details) if own_ids else (None, None, [])
    token = TokenInfoOut(
        status="headword" if own_ids else "attested" if is_attested else "unknown",
        lemma=details[own_ids[0]].name if own_ids and own_ids[0] in details else None,
        gloss=gloss, audioFileId=audio, wordIds=list(own_ids[:MAX_HOMOGRAPHS]), attestedSentence=attested_sentence,
    )

    notes: list[str] = []
    if not data.rules_available:
        notes.append(f"這個族語的辭典衍生詞標註只有 {data.n_pairs} 筆，不足以自動歸納詞綴規則；只顯示辭典本身標註的詞根。")
    elif not data.admitted:
        notes.append("這個族語目前沒有通過獨立測試校準的詞綴規則，規則分析的結果最高只標示「中」信心，請當作參考。")
    if not candidates:
        if own_ids:
            notes.append("辭典沒有標註這個詞條的詞根，規則分析也找不到可信的結果——它可能本身就是詞根。")
        elif is_attested:
            notes.append("這個詞形在辭典例句裡出現過，但找不到可信的詞根分析。")
        else:
            notes.append("辭典裡沒有這個詞形，也找不到可信的分析結果。")

    return AnalyzeResponse(
        tribe=tribe.full_name, tribeSlug=tribe.slug, input=word.strip(), normalized=norm, token=token,
        candidates=candidates, rulesAvailable=data.rules_available, admittedRuleCount=len(data.admitted), notes=notes,
    )
