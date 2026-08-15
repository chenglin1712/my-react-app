"""繁體中文 ⇄ 族語 雙向檢索——直接查 PostgreSQL 的 pg_trgm 模糊比對，不建任何
應用層側索引。

一開始曾評估在應用程式記憶體裡建一份 SQLite FTS5 側索引，但這個專案的辭典
DB 正式環境本來就是 PostgreSQL（dictionary_db/connect.py 的
DICTIONARY_DATABASE_URL），維護一份跟主資料庫脫鉤、需要手動失效/重建的記憶體
副本，複雜度比直接用 Postgres 原生模糊比對更高。詳細理由與效能實測數字見
backend/fastAPI/alembic/versions/86d389a704d0_add_translation_support.py
的說明。

**這個模組只在 PostgreSQL 上運作**：pg_trgm 的 % 運算子／similarity() 函式、
migration 建立的運算式 GIN 索引都是 Postgres 專屬。SQLite 開發模式（README
記載的「對一個全新、空的 SQLite 檔案執行 alembic upgrade head」）下呼叫這裡
的函式會在第一次真的查詢時丟 UnsupportedDialectError——比照
backend/AIModel/views.py::_get_client() 缺 ANTHROPIC_API_KEY 時的 lazy check
精神，import 當下不檢查，只有實際呼叫翻譯功能時才顯式失敗，不拖垮其他不
相關的功能。

跟這裡的 SQL 正規化運算式（_NORM_EXPR_NAME／_NORM_EXPR_ORIG）必須跟
lexicon.normalize_token() 逐字一致，已用全庫 30,684 筆 words.name 做過交叉
驗證（0 筆不一致）。

`corroborate_tokens()` 是 retrieve_for_tribe()（族語→中文，輸入側逐詞顯示）
與 service.py 的 _corroborate_sentence()（中文→族語，輸出側佐證檢核）共用
的核心比對邏輯：多詞最長匹配 + headword/attested/derived 三層查證。兩個
方向共用同一套函式，才能保證「這個詞形算不算有佐證」的判斷邏輯一致——
最初分開實作過一次，導致 tribe2zh 方向完全沒有 attested/derived 兩層、
zh2tribe 方向的多詞詞條無法通過佐證檢核，這裡合併成一個路徑後兩個問題
一次解決（獨立 code review 抓到的問題，見對話紀錄）。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import lexicon

# 跟 alembic migration 裡 _normalize_expr() 產生的字串逐字相同——SQL 端用來
# 建運算式索引，這裡用同一個運算式當查詢條件，Planner 才可能用上索引；
# Python 端則是 lexicon.normalize_token()，兩邊已做過全量交叉驗證。
_NORM_EXPR_NAME = "lower(regexp_replace(regexp_replace(name, '[ʼʾ]', '''', 'g'), '\\^', '', 'g'))"
_NORM_EXPR_ORIG = (
    "lower(regexp_replace(regexp_replace(coalesce(original_sentence, ''), "
    "'[ʼʾ]', '''', 'g'), '\\^', '', 'g'))"
)

_FIRST_WORD_AUDIO = (
    "(SELECT wa.file_id FROM word_audio wa WHERE wa.word_id = w.id "
    "ORDER BY wa.sort_order NULLS LAST LIMIT 1)"
)
_FIRST_SENTENCE_AUDIO = (
    "(SELECT sa.file_id FROM word_explanation_sentence_audio sa "
    "WHERE sa.sentence_id = s.id ORDER BY sa.sort_order NULLS LAST LIMIT 1)"
)
_FIRST_GLOSS = (
    "(SELECT e2.chinese_explanation FROM word_explanation e2 "
    "WHERE e2.word_id = w.id AND coalesce(trim(e2.chinese_explanation), '') <> '' "
    "ORDER BY e2.sort_order LIMIT 1)"
)

# 多詞詞條最長匹配的滑動視窗上限。實測全庫 words.name 含空格的詞條中，
# 最長的一筆是 7 個詞（"i ikor no tosa^ a romiʼ ad"），5~7 詞的雖然只有
# 23 筆，但視窗設小會讓這些詞條永遠無法被當成一個整體匹配，寧可讓候選
# 片語集合大一點（batch 查詢一次打完，成本可忽略），也不要漏掉這些真實
# 存在的詞條。
MAX_HEADWORD_WINDOW = 7


class UnsupportedDialectError(RuntimeError):
    """目前資料庫連線不是 PostgreSQL，翻譯功能的模糊檢索無法運作。"""


def _require_postgres(db: Session) -> None:
    if db.bind.dialect.name != "postgresql":
        raise UnsupportedDialectError(
            "族語翻譯功能需要 PostgreSQL（pg_trgm）才能運作，目前資料庫連線不是 PostgreSQL。"
        )


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass
class SentenceMatch:
    id: int
    original: str
    chinese: str
    audio_file_id: str | None
    score: float


@dataclass
class WordMatch:
    id: str
    name: str
    gloss: str | None
    audio_file_id: str | None
    score: float = 1.0


@dataclass
class ZhRetrieval:
    """中文 -> 族語方向的檢索結果，句對跟詞彙分開列，供 prompts.py 分別編號引用。"""
    sentences: list[SentenceMatch] = field(default_factory=list)
    words: list[WordMatch] = field(default_factory=list)


@dataclass
class MatchedSpan:
    """corroborate_tokens() 的回傳單位：一段（可能吃掉多個原始 token 的）
    比對結果，依輸入順序、互不重疊，token_count 之和等於輸入 token 數。"""
    surface: str
    token_count: int
    status: str   # headword | attested | derived | unsupported（lexicon.TokenStatus 的子集，不含 punct）
    word_id: str | None = None
    lemma: str | None = None
    gloss: str | None = None
    audio_file_id: str | None = None
    note: str | None = None
    sentence_ref: int | None = None


@dataclass
class TribeRetrieval:
    tokens: list[MatchedSpan] = field(default_factory=list)
    sentences: list[SentenceMatch] = field(default_factory=list)


def _sentence_rows_to_matches(rows) -> list[SentenceMatch]:
    return [
        SentenceMatch(id=r.id, original=r.original_sentence or "", chinese=r.chinese_sentence or "",
                      audio_file_id=r.audio_file_id, score=float(r.score))
        for r in rows
    ]


def _short_sentence_fallback(db: Session, tribe_id: str, column_expr: str, q: str, k: int) -> list[SentenceMatch]:
    """trigram 相似度對 <3 字的查詢效果不可靠（幾乎湊不出完整的三連字），
    改用精確相等 + 子字串 LIKE 當短查詢的 fallback，而不是完全不查句對——
    像「水」「你好」這種很常見的短輸入，語料裡往往就有完全命中的句子，不查
    等於平白放棄最有機會觸發語料短路的情況。"""
    like_q = _escape_like(q)
    sql = text(f"""
        SELECT s.id, s.original_sentence, s.chinese_sentence, {_FIRST_SENTENCE_AUDIO} AS audio_file_id,
               CASE WHEN {column_expr} = :q THEN 1.0 ELSE 0.5 END AS score
        FROM word_explanation_sentence s
        JOIN word_explanation e ON e.id = s.explanation_id
        JOIN words w ON w.id = e.word_id
        WHERE w.tribe_id = :tribe_id
          AND ({column_expr} = :q OR {column_expr} LIKE '%' || :like_q || '%' ESCAPE '\\')
        ORDER BY score DESC
        LIMIT :k
    """)
    rows = db.execute(sql, {"tribe_id": tribe_id, "q": q, "like_q": like_q, "k": k}).fetchall()
    return _sentence_rows_to_matches(rows)


def retrieve_zh_sentences(db: Session, tribe_id: str, query_zh: str, k: int = 8) -> list[SentenceMatch]:
    _require_postgres(db)
    if len(query_zh) < 3:
        return _short_sentence_fallback(db, tribe_id, "s.chinese_sentence", query_zh, k)
    sql = text(f"""
        SELECT s.id, s.original_sentence, s.chinese_sentence,
               {_FIRST_SENTENCE_AUDIO} AS audio_file_id,
               similarity(s.chinese_sentence, :q) AS score
        FROM word_explanation_sentence s
        JOIN word_explanation e ON e.id = s.explanation_id
        JOIN words w ON w.id = e.word_id
        WHERE w.tribe_id = :tribe_id AND s.chinese_sentence % :q
        ORDER BY score DESC
        LIMIT :k
    """)
    rows = db.execute(sql, {"tribe_id": tribe_id, "q": query_zh, "k": k}).fetchall()
    return _sentence_rows_to_matches(rows)


def retrieve_tribe_sentences(db: Session, tribe_id: str, query_norm: str, k: int = 8) -> list[SentenceMatch]:
    """query_norm 必須已經過 lexicon.normalize_sentence() 正規化。"""
    _require_postgres(db)
    if len(query_norm) < 3:
        return _short_sentence_fallback(db, tribe_id, _NORM_EXPR_ORIG, query_norm, k)
    sql = text(f"""
        SELECT s.id, s.original_sentence, s.chinese_sentence,
               {_FIRST_SENTENCE_AUDIO} AS audio_file_id,
               similarity({_NORM_EXPR_ORIG}, :q) AS score
        FROM word_explanation_sentence s
        JOIN word_explanation e ON e.id = s.explanation_id
        JOIN words w ON w.id = e.word_id
        WHERE w.tribe_id = :tribe_id AND {_NORM_EXPR_ORIG} % :q
        ORDER BY score DESC
        LIMIT :k
    """)
    rows = db.execute(sql, {"tribe_id": tribe_id, "q": query_norm, "k": k}).fetchall()
    return _sentence_rows_to_matches(rows)


def retrieve_zh_gloss_words(db: Session, tribe_id: str, query_zh: str, k: int = 12) -> list[WordMatch]:
    """中文詞彙候選：先精確比對整個中文釋義，再補模糊比對。exact 排最前面，
    分數固定 1.0；模糊比對走 pg_trgm。pg_trgm 對 <3 字的短字串仍能算相似度
    （Postgres 內部會補位湊出可比對的 trigram），但精確度較低，所以精確比對
    這一段不能省略，否則像「水」「你好」這種常見短查詢反而拿不到最直接的
    候選。"""
    _require_postgres(db)
    exact_sql = text(f"""
        SELECT w.id, w.name, e.chinese_explanation AS gloss, {_FIRST_WORD_AUDIO} AS audio_file_id
        FROM word_explanation e
        JOIN words w ON w.id = e.word_id
        WHERE w.tribe_id = :tribe_id AND e.chinese_explanation = :q
        LIMIT :k
    """)
    exact_rows = db.execute(exact_sql, {"tribe_id": tribe_id, "q": query_zh, "k": k}).fetchall()
    results = [WordMatch(id=r.id, name=r.name, gloss=r.gloss, audio_file_id=r.audio_file_id, score=1.0)
               for r in exact_rows]
    seen_ids = {w.id for w in results}

    remaining = max(0, k - len(results))
    if remaining and len(query_zh) >= 3:
        fuzzy_sql = text(f"""
            SELECT w.id, w.name, e.chinese_explanation AS gloss, {_FIRST_WORD_AUDIO} AS audio_file_id,
                   similarity(e.chinese_explanation, :q) AS score
            FROM word_explanation e
            JOIN words w ON w.id = e.word_id
            WHERE w.tribe_id = :tribe_id AND e.chinese_explanation % :q
            ORDER BY score DESC
            LIMIT :k
        """)
        fuzzy_rows = db.execute(fuzzy_sql, {"tribe_id": tribe_id, "q": query_zh, "k": remaining + len(seen_ids)}).fetchall()
        for r in fuzzy_rows:
            if r.id in seen_ids:
                continue
            results.append(WordMatch(id=r.id, name=r.name, gloss=r.gloss,
                                      audio_file_id=r.audio_file_id, score=float(r.score)))
            seen_ids.add(r.id)
            if len(results) >= k:
                break
    return results


def retrieve_for_zh(db: Session, tribe_id: str, text_zh: str, k_sentences: int = 8, k_words: int = 12) -> ZhRetrieval:
    """中文 -> 族語方向的完整檢索：句對＋詞彙分開回傳，由 prompts.py 決定
    怎麼編號、怎麼混排進 prompt。"""
    norm = lexicon.normalize_sentence(text_zh)
    sentences = retrieve_zh_sentences(db, tribe_id, norm, k=k_sentences) if norm else []
    words = retrieve_zh_gloss_words(db, tribe_id, text_zh.strip(), k=k_words)
    return ZhRetrieval(sentences=sentences, words=words)


# ---------------------------------------------------------------------------
# headword / attested batch 查詢 + 共用的多詞最長匹配／三層佐證比對
# ---------------------------------------------------------------------------

def lookup_headwords_batch(db: Session, tribe_id: str, normalized_forms: list[str]) -> dict[str, WordMatch]:
    """batch 查詢多個「已正規化」的詞形字串是否命中 words.name（含多詞詞條，
    呼叫端負責用 lexicon.normalize_phrase() 組出候選片語字串）。回傳
    {normalized_form: WordMatch}，查無的 key 不會出現在回傳的 dict 裡。"""
    _require_postgres(db)
    forms = sorted(set(f for f in normalized_forms if f))
    if not forms:
        return {}
    sql = text(f"""
        SELECT {_NORM_EXPR_NAME} AS norm_name, w.id, w.name, {_FIRST_GLOSS} AS gloss, {_FIRST_WORD_AUDIO} AS audio_file_id
        FROM words w
        WHERE w.tribe_id = :tribe_id AND {_NORM_EXPR_NAME} = ANY(:forms)
    """)
    rows = db.execute(sql, {"tribe_id": tribe_id, "forms": forms}).fetchall()
    result: dict[str, WordMatch] = {}
    for r in rows:
        if r.norm_name in result:
            continue  # 同一個正規化詞形有多筆詞條（異體字/多詞性）時取第一筆
        result[r.norm_name] = WordMatch(id=r.id, name=r.name, gloss=r.gloss, audio_file_id=r.audio_file_id)
    return result


def lookup_attested_batch(db: Session, tribe_id: str, normalized_forms: list[str]) -> dict[str, int]:
    """batch 查詢多個「已正規化」的詞形字串是否在 translation_attested_form
    出現過（Tier B 佐證）。回傳 {normalized_form: source_sentence_id}。"""
    _require_postgres(db)
    forms = sorted(set(f for f in normalized_forms if f))
    if not forms:
        return {}
    sql = text("""
        SELECT surface_form_norm, source_sentence_id
        FROM translation_attested_form
        WHERE tribe_id = :tribe_id AND surface_form_norm = ANY(:forms)
    """)
    rows = db.execute(sql, {"tribe_id": tribe_id, "forms": forms}).fetchall()
    return {r.surface_form_norm: r.source_sentence_id for r in rows if r.source_sentence_id is not None}


def fetch_sentence_by_id(db: Session, sentence_id: int) -> SentenceMatch | None:
    sql = text(f"""
        SELECT s.id, s.original_sentence, s.chinese_sentence, {_FIRST_SENTENCE_AUDIO} AS audio_file_id
        FROM word_explanation_sentence s
        WHERE s.id = :id
    """)
    r = db.execute(sql, {"id": sentence_id}).fetchone()
    if r is None:
        return None
    return SentenceMatch(id=r.id, original=r.original_sentence or "", chinese=r.chinese_sentence or "",
                          audio_file_id=r.audio_file_id, score=1.0)


def corroborate_tokens(db: Session, tribe_id: str, raw_tokens: list[str],
                        strip_rules: lexicon.StripRules | None = None,
                        max_window: int = MAX_HEADWORD_WINDOW) -> list[MatchedSpan]:
    """對一串「已切好、彼此在原句中確實相鄰」的族語詞形 token，做多詞最長
    匹配 + 三層佐證判定，回傳依序、互不重疊的 MatchedSpan 清單。

    retrieve_for_tribe()（族語→中文，輸入側逐詞顯示）與 service.py 的
    _corroborate_sentence()（中文→族語，輸出側佐證檢核）共用這個函式，
    確保「這個詞形算不算有佐證」在兩個方向判斷一致——呼叫端負責只把「原句
    中真正相鄰」的 token 序列傳進來（中間如果隔著標點或非拉丁字元，要切成
    多段分別呼叫，不能把不相鄰的詞硬湊成候選片語）。
    """
    n = len(raw_tokens)
    window = min(max_window, n) if n else 0

    candidate_phrases: set[str] = set()
    for w in range(window, 0, -1):
        for start in range(0, n - w + 1):
            candidate_phrases.add(lexicon.normalize_phrase(raw_tokens[start:start + w]))

    headword_map = lookup_headwords_batch(db, tribe_id, list(candidate_phrases)) if candidate_phrases else {}
    attested_map = lookup_attested_batch(db, tribe_id, list(candidate_phrases)) if candidate_phrases else {}

    # Phase 1：貪婪多詞最長匹配。未命中的單一 token 位置先記下來（kind=None），
    # 晚點批次處理詞綴剝除，避免對每個未命中 token 各自查一次 DB。
    provisional: list[tuple[str, int, str | None, str | None]] = []  # (surface, token_count, kind, norm_key)
    i = 0
    while i < n:
        matched = False
        for w in range(window, 0, -1):
            if i + w > n:
                continue
            phrase = lexicon.normalize_phrase(raw_tokens[i:i + w])
            if phrase in headword_map:
                provisional.append((" ".join(raw_tokens[i:i + w]), w, "headword", phrase))
                i += w
                matched = True
                break
            if phrase in attested_map:
                provisional.append((" ".join(raw_tokens[i:i + w]), w, "attested", phrase))
                i += w
                matched = True
                break
        if not matched:
            provisional.append((raw_tokens[i], 1, None, None))
            i += 1

    # Phase 2：未命中的單一 token 批次查詞綴剝除候選。
    pending_indices = [idx for idx, p in enumerate(provisional) if p[2] is None]
    candidates_by_idx: dict[int, list[lexicon.StripCandidate]] = {}
    all_residues: set[str] = set()
    if strip_rules is not None:
        for idx in pending_indices:
            token = provisional[idx][0]
            norm = lexicon.normalize_token(token)
            cands = strip_rules.strip_candidates(norm)
            candidates_by_idx[idx] = cands
            all_residues.update(c.residue for c in cands)

    residue_headword_map = lookup_headwords_batch(db, tribe_id, list(all_residues)) if all_residues else {}
    residue_attested_map = lookup_attested_batch(db, tribe_id, list(all_residues)) if all_residues else {}

    spans: list[MatchedSpan] = []
    for idx, (surface, token_count, kind, norm_key) in enumerate(provisional):
        if kind == "headword":
            m = headword_map[norm_key]
            spans.append(MatchedSpan(surface=surface, token_count=token_count, status="headword",
                                      word_id=m.id, lemma=m.name, gloss=m.gloss, audio_file_id=m.audio_file_id))
            continue
        if kind == "attested":
            spans.append(MatchedSpan(surface=surface, token_count=token_count, status="attested",
                                      note="見例句", sentence_ref=attested_map[norm_key]))
            continue

        hit: MatchedSpan | None = None
        for cand in candidates_by_idx.get(idx, []):
            if cand.residue in residue_headword_map:
                m = residue_headword_map[cand.residue]
                hit = MatchedSpan(surface=surface, token_count=1, status="derived", word_id=m.id,
                                   lemma=m.name, gloss=m.gloss, audio_file_id=m.audio_file_id, note=cand.note)
                break
            if cand.residue in residue_attested_map:
                hit = MatchedSpan(surface=surface, token_count=1, status="derived", lemma=cand.residue,
                                   note=cand.note, sentence_ref=residue_attested_map[cand.residue])
                break
        spans.append(hit or MatchedSpan(surface=surface, token_count=1, status="unsupported"))

    return spans


def get_capability_stats(db: Session, tribe_id: str) -> dict:
    """給 /capabilities 端點用：這族有多少組對照句對／詞條，以及例句本身
    有沒有真人整句原音（見對話紀錄：全庫只有 kavalan／tayal 有
    word_explanation_sentence_audio，前端不該對其餘三族承諾整句原音）。"""
    _require_postgres(db)
    sql = text("""
        SELECT
            (SELECT COUNT(*) FROM (
                SELECT DISTINCT s.original_sentence, s.chinese_sentence
                FROM word_explanation_sentence s
                JOIN word_explanation e ON e.id = s.explanation_id
                JOIN words w ON w.id = e.word_id
                WHERE w.tribe_id = :tribe_id
                  AND coalesce(trim(s.original_sentence), '') <> ''
                  AND coalesce(trim(s.chinese_sentence), '') <> ''
            ) pairs) AS pair_count,
            (SELECT COUNT(*) FROM words WHERE tribe_id = :tribe_id) AS headword_count,
            EXISTS (
                SELECT 1 FROM word_explanation_sentence_audio sa
                JOIN word_explanation_sentence s ON s.id = sa.sentence_id
                JOIN word_explanation e ON e.id = s.explanation_id
                JOIN words w ON w.id = e.word_id
                WHERE w.tribe_id = :tribe_id
            ) AS has_sentence_audio
    """)
    r = db.execute(sql, {"tribe_id": tribe_id}).fetchone()
    return {"pair_count": r.pair_count, "headword_count": r.headword_count,
            "has_sentence_audio": bool(r.has_sentence_audio)}


def get_all_capability_stats(db: Session) -> dict[str, dict]:
    from config.tribes import TRIBES
    return {t.slug: get_capability_stats(db, t.id) for t in TRIBES}


def corroborate_full_sentence(db: Session, tribe_id: str, sentence: str,
                               strip_rules: lexicon.StripRules | None = None) -> list[MatchedSpan]:
    """把一整句族語文字（可能含標點、可能夾雜非拉丁字元）展開成『每個顯示
    token 各一筆』的 MatchedSpan 序列，跟 lexicon.split_display_tokens() 切
    出來的片段一一對應：
    - "punct" 片段直接標 status="punct"。
    - "foreign" 片段（含字母/數字但不是這個語言的拼寫）直接標
      status="unsupported"，不查表。
    - "word" 片段依「原句中真正相鄰」分段（run）——標點/外文字元會中斷
      相鄰性，不能把中間隔著逗號的兩個詞湊成候選片語——各段分別丟給
      corroborate_tokens() 做多詞最長匹配 + 三層佐證，一個 span 若吃掉多個
      原始 token，這裡會把同一個比對結果複製到每個被吃掉的位置，讓回傳
      序列長度固定等於 split_display_tokens() 的結果，前端不需要處理變寬
      的合併儲存格。

    retrieve_for_tribe()（族語→中文，輸入側顯示）與 service.py 的
    _corroborate_sentence()（中文→族語，輸出側佐證檢核）共用這個函式。
    """
    display = lexicon.split_display_tokens(sentence)
    classes = [lexicon.classify_display_piece(p) for p in display]

    results: list[MatchedSpan | None] = [None] * len(display)
    for i, (piece, cls) in enumerate(zip(display, classes)):
        if cls == "punct":
            results[i] = MatchedSpan(surface=piece, token_count=1, status="punct")
        elif cls == "foreign":
            results[i] = MatchedSpan(surface=piece, token_count=1, status="unsupported")

    i = 0
    while i < len(display):
        if classes[i] != "word":
            i += 1
            continue
        j = i
        while j < len(display) and classes[j] == "word":
            j += 1
        run_tokens = display[i:j]
        spans = corroborate_tokens(db, tribe_id, run_tokens, strip_rules=strip_rules)
        pos = i
        for span in spans:
            for _ in range(span.token_count):
                results[pos] = MatchedSpan(surface=display[pos], token_count=1, status=span.status,
                                            word_id=span.word_id, lemma=span.lemma, gloss=span.gloss,
                                            audio_file_id=span.audio_file_id, note=span.note,
                                            sentence_ref=span.sentence_ref)
                pos += 1
        i = j

    # results 的每個位置都會在上面兩段迴圈其中一段被填到，這裡的 None 過濾
    # 是防禦寫法，理論上不會真的濾掉任何東西。
    return [r for r in results if r is not None]


def retrieve_for_tribe(db: Session, tribe_id: str, text_tribe: str, k_sentences: int = 8,
                        strip_rules: lexicon.StripRules | None = None) -> TribeRetrieval:
    """族語 -> 中文方向的完整檢索：逐詞對照（含多詞詞條的最長匹配 + attested/
    derived 兩層——原本只查 headword，未命中直接算查無，會讓合法的詞綴變化
    形或語料才有的詞形在輸入側被誤判成查無釋義，見對話紀錄的獨立 code
    review）＋相近例句。"""
    tokens = corroborate_full_sentence(db, tribe_id, text_tribe, strip_rules=strip_rules)

    norm_sentence = lexicon.normalize_sentence(text_tribe)
    sentences = retrieve_tribe_sentences(db, tribe_id, norm_sentence, k=k_sentences) if norm_sentence else []
    return TribeRetrieval(tokens=tokens, sentences=sentences)
