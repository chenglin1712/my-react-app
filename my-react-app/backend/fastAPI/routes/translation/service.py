"""檢索 -> prompt -> LLM -> 佐證檢核，串成一次翻譯請求。不碰 HTTP（例外往上
拋，由 api.py 決定要回什麼狀態碼），比照 backend/AIModel/services.py 的
run_tayal_chat／run_review_tayal_chat 角色分工：這裡只管「怎麼產生翻譯結果」，
認證/限流/HTTP 狀態碼是呼叫端的事。
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass

from sqlalchemy.orm import Session

from config.llm import get_llm_client, DEFAULT_MODEL
from config.tribes import TRIBE_IDS, TRIBE_MAP
from dictionary_db.model import GrammarAffix

from . import lexicon
from . import prompts
from . import retrieve as R

# Jaccard 相似度達到這個門檻，視為「語料裡已經有幾乎一樣的句子」，直接短路
# 回傳、不呼叫 LLM——比呼叫模型再拿它的輸出去跟語料比對更快更省，品質也
# 嚴格更高（直接是人工編纂的句子，不是模型改寫過的版本）。
_EXACT_CORPUS_THRESHOLD = 0.85

# grammar_affix 每族只有 12~23 筆，查詢成本可忽略，這裡做行程內快取純粹是
# 避免同一個請求內對每個 unsupported token 都重查一次；不需要 KeyedCache
# 那套失效機制——詞綴表幾乎不會變動，真的改了，process 重啟後自然會拿到
# 新值，不值得為此另外接一條快取失效路徑。
_STRIP_RULES_CACHE: dict[str, lexicon.StripRules] = {}


class UnsupportedDirectionError(ValueError):
    pass


class UnsupportedTribeError(ValueError):
    pass


@dataclass
class TokenResult:
    surface: str
    status: str  # lexicon.TokenStatus: headword | attested | derived | unsupported | punct
    word_id: str | None = None
    lemma: str | None = None
    gloss: str | None = None
    audio_file_id: str | None = None
    note: str | None = None
    sentence_ref: int | None = None


@dataclass
class Coverage:
    total: int
    headword: int
    attested: int
    derived: int
    unsupported: int
    corroborated_ratio: float


@dataclass
class TranslationResult:
    direction: str
    tribe_full_name: str
    tribe_slug: str
    source_text: str
    translation: str
    match_type: str    # exact_corpus | grounded | generated
    confidence: str     # high | medium | low
    token_side: str     # target（zh2tribe，tokens 描述輸出）｜ source（tribe2zh，tokens 描述輸入）
    tokens: list[TokenResult]
    coverage: Coverage
    warning: str | None
    evidence_sentences: list[dict]
    evidence_words: list[dict]
    notes: str
    model_used: str | None
    elapsed_ms: int = 0


def _get_strip_rules(db: Session, tribe_id: str) -> lexicon.StripRules:
    if tribe_id not in _STRIP_RULES_CACHE:
        rows = (
            db.query(GrammarAffix.affix, GrammarAffix.function)
            .filter(GrammarAffix.tribe_id == tribe_id)
            .all()
        )
        _STRIP_RULES_CACHE[tribe_id] = lexicon.build_strip_rules(
            [{"affix": a, "function": f} for a, f in rows]
        )
    return _STRIP_RULES_CACHE[tribe_id]


def _sentence_to_dict(s: R.SentenceMatch) -> dict:
    return {"id": s.id, "original": s.original, "chinese": s.chinese,
            "audioFileId": s.audio_file_id, "score": round(s.score, 3)}


def _word_to_dict(w: R.WordMatch) -> dict:
    return {"id": w.id, "name": w.name, "gloss": w.gloss, "audioFileId": w.audio_file_id}


def _build_warning(coverage: Coverage) -> str | None:
    if coverage.unsupported <= 0:
        return None
    return f"本翻譯有 {coverage.unsupported}/{coverage.total} 個詞無語料佐證"


def _confidence_from_coverage(coverage: Coverage) -> str:
    if coverage.total == 0:
        return "medium"
    if coverage.corroborated_ratio >= 1.0:
        return "high"
    if coverage.corroborated_ratio >= 0.5:
        return "medium"
    return "low"


def _spans_to_tokens_and_coverage(spans: list[R.MatchedSpan]) -> tuple[list[TokenResult], Coverage]:
    """把 retrieve.corroborate_full_sentence()／corroborate_tokens() 回傳的
    MatchedSpan 序列轉成對外的 TokenResult + Coverage。punct 不計入分母；
    headword/attested/derived 算「有佐證」，unsupported（含被判定為非拉丁
    字元的『foreign』內容，那些在 MatchedSpan 裡本來就已經標成
    status="unsupported"）算沒有。"""
    tokens = [
        TokenResult(surface=sp.surface, status=sp.status, word_id=sp.word_id, lemma=sp.lemma,
                     gloss=sp.gloss, audio_file_id=sp.audio_file_id, note=sp.note,
                     sentence_ref=sp.sentence_ref)
        for sp in spans
    ]
    counts = {"headword": 0, "attested": 0, "derived": 0, "unsupported": 0}
    for sp in spans:
        if sp.status in counts:
            counts[sp.status] += 1
    total = sum(counts.values())
    supported = counts["headword"] + counts["attested"] + counts["derived"]
    ratio = (supported / total) if total else 1.0
    coverage = Coverage(total=total, headword=counts["headword"], attested=counts["attested"],
                         derived=counts["derived"], unsupported=counts["unsupported"], corroborated_ratio=ratio)
    return tokens, coverage


def _corroborate_sentence(db: Session, tribe_id: str, sentence: str) -> tuple[list[TokenResult], Coverage]:
    """對一句（通常是 LLM 產生的）族語句子，逐詞查證能不能對回辭典資料。
    分四層：headword（字典詞條原形）> attested（語料句子裡實際出現過的
    詞形）> derived（剝掉一層詞綴後命中前兩層）> unsupported，並把非拉丁
    字元（模型意外夾雜的中文字/數字等）直接算 unsupported，不會被靜默排除
    在分母之外。多詞詞條（如 "babaw nya'"）用相鄰 token 的最長匹配偵測，
    不會被拆成兩個各自查無佐證的單詞。這些邏輯集中在 retrieve.py 的
    corroborate_full_sentence()，族語→中文方向的輸入側顯示也共用同一套，
    確保兩個方向對「這個詞形算不算有佐證」判斷一致。"""
    strip_rules = _get_strip_rules(db, tribe_id)
    spans = R.corroborate_full_sentence(db, tribe_id, sentence, strip_rules=strip_rules)
    return _spans_to_tokens_and_coverage(spans)


def _parse_llm_json(raw: str) -> dict | None:
    """解析 LLM 回應的 JSON，防禦寫法比照 AIModel/services.py 的
    _extract_study_plan：格式不對就回 None，呼叫端 fallback 成把原始文字
    當譯文，不讓前端卡在半殘的資料上。只驗證能被 json.loads() 解析還不夠
    ——模型仍可能回傳合法 JSON 但欄位型別不對（例如 translation 是陣列而
    不是字串），這裡額外驗證關鍵欄位的型別，型別不對就整包當解析失敗，
    逼呼叫端走原始文字 fallback，而不是讓非字串值一路帶進後面的 regex
    切詞（那會直接丟 TypeError，變成整支請求 500）。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        # 有些模型即使明確要求「不要加 ``` 標記」仍會加，這裡容錯剝掉。
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    if not text.startswith("{"):
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    translation = parsed.get("translation")
    if translation is not None and not isinstance(translation, str):
        return None
    note = parsed.get("note")
    if note is not None and not isinstance(note, str):
        return None
    return parsed


def _call_llm(prompt: str, user_message: str) -> str:
    client = get_llm_client()
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content or ""


def _translate_zh2tribe(db: Session, tribe_id: str, tribe_slug: str, tribe_full_name: str,
                         source_text: str) -> TranslationResult:
    retrieval = R.retrieve_for_zh(db, tribe_id, source_text)

    best = retrieval.sentences[0] if retrieval.sentences else None
    if best is not None:
        sim = lexicon.jaccard(
            lexicon.char_trigrams(lexicon.normalize_sentence(source_text)),
            lexicon.char_trigrams(lexicon.normalize_sentence(best.chinese)),
        )
        if sim >= _EXACT_CORPUS_THRESHOLD:
            tokens, coverage = _corroborate_sentence(db, tribe_id, best.original)
            return TranslationResult(
                direction="zh2tribe", tribe_full_name=tribe_full_name, tribe_slug=tribe_slug,
                source_text=source_text, translation=best.original, match_type="exact_corpus",
                confidence="high", token_side="target", tokens=tokens, coverage=coverage,
                warning=_build_warning(coverage), evidence_sentences=[_sentence_to_dict(best)],
                evidence_words=[], notes="此翻譯直接取自辭典例句，非模型生成。", model_used=None,
            )

    prompt = prompts.build_zh2tribe_prompt(tribe_full_name, source_text, retrieval.sentences, retrieval.words)
    raw = _call_llm(prompt, source_text)
    parsed = _parse_llm_json(raw)

    translation = (parsed.get("translation") if parsed else None) or raw.strip() or source_text
    notes = (parsed.get("note") if parsed else None) or ""

    tokens, coverage = _corroborate_sentence(db, tribe_id, translation)
    supported_any = (coverage.headword + coverage.attested + coverage.derived) > 0
    match_type = "grounded" if supported_any else "generated"

    return TranslationResult(
        direction="zh2tribe", tribe_full_name=tribe_full_name, tribe_slug=tribe_slug,
        source_text=source_text, translation=translation, match_type=match_type,
        confidence=_confidence_from_coverage(coverage), token_side="target", tokens=tokens,
        coverage=coverage, warning=_build_warning(coverage),
        evidence_sentences=[_sentence_to_dict(s) for s in retrieval.sentences],
        evidence_words=[_word_to_dict(w) for w in retrieval.words],
        notes=notes, model_used=DEFAULT_MODEL,
    )


def _translate_tribe2zh(db: Session, tribe_id: str, tribe_slug: str, tribe_full_name: str,
                         source_text: str) -> TranslationResult:
    strip_rules = _get_strip_rules(db, tribe_id)
    # retrieve_for_tribe 現在會對輸入側也做多詞最長匹配 + attested/derived
    # 兩層（原本只查 headword，語料裡才有的詞形/詞綴變化形一律誤判成查無
    # 釋義，翻譯品質跟佐證顯示都會被拖累——見對話紀錄的獨立 code review）。
    retrieval = R.retrieve_for_tribe(db, tribe_id, source_text, strip_rules=strip_rules)

    best = retrieval.sentences[0] if retrieval.sentences else None
    if best is not None:
        sim = lexicon.jaccard(
            lexicon.char_trigrams(lexicon.normalize_sentence(source_text)),
            lexicon.char_trigrams(lexicon.normalize_sentence(best.original)),
        )
        if sim >= _EXACT_CORPUS_THRESHOLD:
            tokens, coverage = _spans_to_tokens_and_coverage(retrieval.tokens)
            return TranslationResult(
                direction="tribe2zh", tribe_full_name=tribe_full_name, tribe_slug=tribe_slug,
                source_text=source_text, translation=best.chinese, match_type="exact_corpus",
                confidence="high", token_side="source", tokens=tokens, coverage=coverage,
                warning=_build_warning(coverage), evidence_sentences=[_sentence_to_dict(best)],
                evidence_words=[], notes="此翻譯直接取自辭典例句，非模型生成。", model_used=None,
            )

    prompt = prompts.build_tribe2zh_prompt(tribe_full_name, source_text, retrieval.tokens, retrieval.sentences)
    raw = _call_llm(prompt, source_text)
    parsed = _parse_llm_json(raw)

    translation = (parsed.get("translation") if parsed else None) or raw.strip()
    notes = (parsed.get("note") if parsed else None) or ""

    # tribe2zh 的佐證檢核針對「輸入」的族語 token（目標語中文不需要查證，
    # 模型翻中文本身就強），沿用檢索階段已經算好的逐詞對照，不用再查一次庫。
    tokens, coverage = _spans_to_tokens_and_coverage(retrieval.tokens)
    supported_any = (coverage.headword + coverage.attested + coverage.derived) > 0
    match_type = "grounded" if supported_any else "generated"

    return TranslationResult(
        direction="tribe2zh", tribe_full_name=tribe_full_name, tribe_slug=tribe_slug,
        source_text=source_text, translation=translation, match_type=match_type,
        confidence=_confidence_from_coverage(coverage), token_side="source", tokens=tokens,
        coverage=coverage, warning=_build_warning(coverage),
        evidence_sentences=[_sentence_to_dict(s) for s in retrieval.sentences],
        evidence_words=[], notes=notes, model_used=DEFAULT_MODEL,
    )


def translate(db: Session, tribe_slug: str, direction: str, text_in: str) -> TranslationResult:
    if tribe_slug not in TRIBE_IDS:
        raise UnsupportedTribeError(f"不支援的族語：{tribe_slug}")
    tribe_id = TRIBE_IDS[tribe_slug]
    tribe_full_name = TRIBE_MAP[tribe_slug]

    t0 = time.monotonic()
    if direction == "zh2tribe":
        result = _translate_zh2tribe(db, tribe_id, tribe_slug, tribe_full_name, text_in)
    elif direction == "tribe2zh":
        result = _translate_tribe2zh(db, tribe_id, tribe_slug, tribe_full_name, text_in)
    else:
        raise UnsupportedDirectionError(f"不支援的翻譯方向：{direction}")
    result.elapsed_ms = int((time.monotonic() - t0) * 1000)
    return result
