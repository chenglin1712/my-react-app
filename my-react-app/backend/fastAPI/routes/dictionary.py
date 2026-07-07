import json, re, logging, httpx, threading
from typing import List, Dict, Tuple, Optional

from fastapi import APIRouter, Request, Depends, Response, Body
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, select, bindparam
from pydantic import BaseModel
from dotenv import load_dotenv
import os

from fastAPI.routes.connect import get_db
from fastAPI.routes.model import Word, Tribe
from fastAPI.routes.word_data import (
    load_sources_for_words,
    load_audio_items_for_words,
    load_explanation_items_for_words,
)
from config.tribes import TRIBE_MAP
from fastAPI.rate_limit import limiter

router = APIRouter()


logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)


class AnaphoraItem(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None

class AnaphoraSentence(BaseModel):
    anaphoraItems: Optional[List[AnaphoraItem]] = None
    isHighlight: Optional[bool] = None
    isSymbol: Optional[bool] = None

class AudioItem(BaseModel):
    id: Optional[str] = None
    fileId: Optional[str] = None
    audioClass: Optional[str] = None

class SentenceItem(BaseModel):
    id: Optional[str] = None
    originalSentence: Optional[str] = None
    anaphoraSentence: Optional[list[AnaphoraSentence]] = None
    chineseSentence: Optional[str] = None
    englishSentence: Optional[str] = None
    audioItems: Optional[list[AudioItem]] = None

class ExplanationItem(BaseModel):
    id: Optional[str] = None
    chineseExplanation: Optional[str] = None
    englishExplanation: Optional[str] = None
    category: Optional[list] = None
    partOfSpeech: Optional[list] = None
    focus: Optional[list] = None
    imageUrl: Optional[list] = None
    sentenceItems: Optional[List[SentenceItem]] = None

class WordResult(BaseModel):
    id: Optional[str] = None
    tribeId: Optional[str] = None
    tribe: Optional[str] = None
    dialect: Optional[str] = None
    name: Optional[str] = None
    pinyin: Optional[str] = None
    variant: Optional[str] = None
    formationWord: Optional[str] = None
    derivativeRoot: Optional[str] = None
    frequency: Optional[int] = None
    hit: Optional[int] = None 
    dictionaryNote: Optional[str] = None
    sources: Optional[list] = None
    explanationItems: Optional[List[ExplanationItem]] = None
    audioItems: Optional[list[AudioItem]] = None
    word_img: Optional[str] = None
    isDerivativeRoot: Optional[bool] = None
    isImage: Optional[bool] = None
    isZuzucidian: Optional[bool] = None
    isOtherDialect: Optional[bool] = None


class KeywordRequest(BaseModel):
    keyword: Optional[str] = ''
    tribe: Optional[str] = '泰雅'


# ------------------------- Utilities -------------------------
def simplify_tayal(word: str) -> str:
    """忽略數字結尾（例：maku3 → maku）"""
    return re.sub(r'\d+$', '', word or "")

def is_chinese(text: str) -> bool:
    return any('\u4e00' <= ch <= '\u9fff' for ch in text)

def _tribe_id_subquery(tribe_name: str):
    # tribe (chinese name) -> tribe_id, replaces the old Word.tribe == tribe_name filter
    return select(Tribe.id).where(Tribe.name == tribe_name).scalar_subquery()


def parse_explanations(value) -> List[ExplanationItem]:
    """解析 explanationItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            ExplanationItem(
                id=item.get("id"),
                chineseExplanation=item.get("chineseExplanation"),
                englishExplanation=item.get("englishExplanation"),
                category=item.get("category", []),
                partOfSpeech=item.get("partOfSpeech", []),
                focus=item.get("focus", []),
                imageUrl=item.get("imageUrl", []),
                sentenceItems=parse_sentences(item.get("sentenceItems", [])),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 explanationItems 時錯誤: {e}")
        return []
    
def parse_sentences(value) -> List[SentenceItem]:
    """解析 sentenceItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            SentenceItem(
                id=item.get("id"),
                originalSentence=item.get("originalSentence"),
                anaphoraSentence=parse_anaphoraSentences(item.get("anaphoraSentence",[])),
                chineseSentence=item.get("chineseSentence"),
                englishSentence=item.get("englishSentence"),
                audioItems=parse_audios(item.get("audioItems", [])),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 sentenceItems 時錯誤: {e}")
        return []

def parse_anaphoraSentences(value) -> List[AnaphoraSentence]:
    """解析 anaphoraSentences 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            AnaphoraSentence(
                anaphoraItems=parse_anaphoras(item.get("anaphoraItems",[])),
                isHighlight=item.get("isHighlight"),
                isSymbol=item.get("isSymbol"),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 anaphoraSentences 時錯誤: {e}")
        return []

def parse_anaphoras(value) -> List[AnaphoraItem]:
    """解析 anaphoraItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            AnaphoraItem(
                id=item.get("id"),
                name=item.get("name"),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 anaphoraItems 時錯誤: {e}")
        return []
    
def parse_audios(value) -> List[AudioItem]:
    """解析 audioItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            AudioItem(
                id=item.get("id"),
                fileId=item.get("fileId"),
                audioClass=item.get("audioClass"),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 audioItems 時錯誤: {e}")
        return []




# ------------------------- 搜尋邏輯 -------------------------
# search_by_chinese/fuzzy_search_by_chinese/search/fuzzy_search 這四個函式
# 原本每次呼叫都對 Word table 做一次 tribe 全表掃描＋JSON parse。
# 沿用 listening.py 的做法：每個 tribe 的詞條只在第一次用到時真正查詢＋解析一次，
# 之後直接從記憶體快取的 WordResult 清單做過濾，不用每個 request 都重新打 DB。
_tribe_words_cache: Dict[str, List[WordResult]] = {}
_tribe_words_cache_lock = threading.Lock()


def _load_tribe_words(db: Session, tribe: str) -> List[WordResult]:
    if tribe in _tribe_words_cache:
        return _tribe_words_cache[tribe]

    with _tribe_words_cache_lock:
        if tribe in _tribe_words_cache:
            return _tribe_words_cache[tribe]

        words = db.query(Word).filter(Word.tribe_id == _tribe_id_subquery(tribe)).all()
        tribe_id = words[0].tribe_id if words else None
        sources_map = load_sources_for_words(db, tribe_id)
        audio_map = load_audio_items_for_words(db, tribe_id)
        explanation_map = load_explanation_items_for_words(db, tribe_id)

        results = [
            WordResult(
                id=word.id,
                tribeId=word.tribe_id,
                tribe=tribe,
                dialect=word.dialect,
                name=word.name,
                pinyin=word.pinyin,
                variant=word.variant,
                formationWord=word.formation_word,
                derivativeRoot=word.derivative_root,
                frequency=word.frequency,
                hit=word.hit,
                dictionaryNote=word.dictionary_note,
                sources=sources_map.get(word.id, []),
                explanationItems=parse_explanations(explanation_map.get(word.id, [])),
                audioItems=parse_audios(audio_map.get(word.id, [])),
                word_img=word.word_img,
                isDerivativeRoot=word.is_derivative_root,
                isImage=word.is_image,
                isZuzucidian=word.is_zuzucidian,
                isOtherDialect=word.is_other_dialect,
            )
            for word in words
        ]
        _tribe_words_cache[tribe] = results
        return results


def warm_cache(db: Session) -> None:
    """在 app 啟動時預先為每個族語跑一次 _load_tribe_words，
    把全表掃描＋JSON parse 的成本放在部署當下，而不是留給第一批使用者的查詢請求承擔。"""
    for tribe_name in set(TRIBE_MAP.values()):
        _load_tribe_words(db, tribe_name)


def search_by_chinese(db: Session, keyword: str, tribe: str = '泰雅語') -> Tuple[List[WordResult], List[str]]:
    """完全比對中文解釋"""
    words = sorted(_load_tribe_words(db, tribe), key=lambda w: (w.name or "").lower())

    results = []
    matched_names = []

    for word in words:
        for defin in (word.explanationItems or []):
            if defin.chineseExplanation == keyword:
                matched_names.append(simplify_tayal(word.name))
                results.append(word)
                break

    return results, matched_names




def fuzzy_search_by_chinese(db: Session, keyword: str, exclude_names: List[str], tribe: str = '泰雅語') -> Dict[str, List[WordResult]]:
    """模糊搜尋中文解釋"""
    words = _load_tribe_words(db, tribe)
    fuzzy_content = {}

    for word in words:
        name_simple = simplify_tayal(word.name)
        if name_simple in exclude_names:
            continue

        for defin in (word.explanationItems or []):
            if keyword in (defin.chineseExplanation or ""):
                fuzzy_content.setdefault(defin.chineseExplanation, []).append(word)

    return fuzzy_content

def search(db: Session, keyword: str, tribe: str = '泰雅語') -> Tuple[List[WordResult], List[str]]:
    """完全比對族語"""
    words = _load_tribe_words(db, tribe)

    results = []
    matched_names = []

    for word in words:
        if word.name == keyword:
            matched_names.append(simplify_tayal(word.name))
            results.append(word)

    return results, matched_names




def fuzzy_search(db: Session, keyword: str, exclude_names: List[str], tribe: str = '泰雅語') -> Dict[str, List[WordResult]]:
    """模糊搜尋族語"""
    words = _load_tribe_words(db, tribe)
    fuzzy_content = {}

    for word in words:
        name_simple = simplify_tayal(word.name)
        if name_simple in exclude_names:
            continue

        if keyword in (word.name or ""):
            fuzzy_content.setdefault(word.name, []).append(word)

    return fuzzy_content

def _frequency_bucket(freq: Optional[int]) -> int:
    """把 frequency 數值換成前端顯示的星等（1~5），跟
    frontend/src/_search/index.jsx 的 filterAndSortWords 星等換算邏輯保持一致。"""
    fre = freq if freq is not None else 0
    if 0 <= fre <= 200:
        return 1
    elif fre <= 400:
        return 2
    elif fre <= 800:
        return 3
    elif fre <= 1000:
        return 4
    return 5


def _matches_category(word_result: "WordResult", category: Optional[str]) -> bool:
    if not category:
        return True
    return any(category in (exp.category or []) for exp in (word_result.explanationItems or []))


def _sort_key_name(name: Optional[str]):
    """跟前端排序邏輯一致：忽略非字母開頭（-、ʼ 等）取字母部分排序，
    純非字母開頭的詞條一律排在最後。"""
    lowered = (name or '').lower()
    stripped = re.sub(r'^[^a-z]+', '', lowered) or lowered
    is_prefixed = bool(re.match(r'^[^a-z]', lowered))
    return (is_prefixed, stripped, lowered)


def _sort_words(word_results: List["WordResult"], sort_order: str) -> List["WordResult"]:
    """降冪排序等於升冪排序結果整個反過來（字母部分與非字母開頭的排列同時翻轉），
    詳見 frontend/src/_search/index.jsx filterAndSortWords 的排序邏輯。"""
    ascending = sorted(word_results, key=lambda w: _sort_key_name(w.name))
    return list(reversed(ascending)) if sort_order == 'desc' else ascending


def search_all(
    db: Session,
    tribe: str = '泰雅語',
    limit: Optional[int] = None,
    offset: int = 0,
    letter: Optional[str] = None,
    frequency: Optional[int] = None,
    category: Optional[str] = None,
    favorites_only: bool = False,
    favorite_names: Optional[List[str]] = None,
    sort_order: str = 'asc',
) -> Tuple[Dict[str, List[WordResult]], int]:
    """回傳所有詞條，依 letter/frequency/category/favorites_only 篩選、依 sort_order 排序後，
    再用 limit/offset 做分頁（篩選+排序完成後才切頁，讓「載入更多」逐頁拿到的資料彼此一致）。
    全部不傳則維持原本回傳全部（未篩選、未分頁）的行為。回傳 (分組後的當頁資料, 篩選後總筆數)。"""
    words = db.query(Word).filter(Word.tribe_id == _tribe_id_subquery(tribe)).order_by(Word.name).all()

    word_ids = [word.id for word in words]
    sources_map = load_sources_for_words(db, word_ids=word_ids)
    audio_map = load_audio_items_for_words(db, word_ids=word_ids)
    explanation_map = load_explanation_items_for_words(db, word_ids=word_ids)

    all_word_results: List[WordResult] = []
    for word in words:
        explanations = parse_explanations(explanation_map.get(word.id, []))
        if not explanations:
            continue

        all_word_results.append(
            WordResult(
                id=word.id,
                        tribeId=word.tribe_id,
                        tribe=tribe,
                        dialect=word.dialect,
                        name=word.name,
                        pinyin=word.pinyin,
                        variant=word.variant,
                        formationWord=word.formation_word,
                        derivativeRoot=word.derivative_root,
                        frequency=word.frequency,
                        hit=word.hit,
                        dictionaryNote=word.dictionary_note,
                        sources=sources_map.get(word.id, []),
                        explanationItems=explanations,
                        audioItems=parse_audios(audio_map.get(word.id, [])),
                        word_img=word.word_img,
                        isDerivativeRoot=word.is_derivative_root,
                        isImage=word.is_image,
                        isZuzucidian=word.is_zuzucidian,
                        isOtherDialect=word.is_other_dialect,
            )
        )

    favorite_names_set = set(favorite_names or [])
    filtered = [
        wr for wr in all_word_results
        if (not letter or (wr.name or '').lower().startswith(letter.lower()))
        and (not frequency or _frequency_bucket(wr.frequency) == frequency)
        and _matches_category(wr, category)
        and (not favorites_only or wr.name in favorite_names_set)
    ]
    ordered = _sort_words(filtered, sort_order)
    total = len(ordered)
    page = ordered[offset:offset + limit] if limit is not None else ordered[offset:]

    # 回應仍維持 {key: [WordResult]} 的分組格式（相容既有前端 Object.values(...).flat()
    # 用法），但 key 一律用該筆在 page 裡的序號，確保每個詞各自一組。
    # 舊版用 chineseExplanation 當 key，多個詞共用同一個中文釋義時會被歸成同一組，
    # flatten 後這些詞會被搬到一起，把前面 _sort_words 排好的順序打亂。
    content: Dict[str, List[WordResult]] = {
        str(idx): [wr] for idx, wr in enumerate(page)
    }

    return content, total


# ------------------------- API 路由 -------------------------
@router.post("/keys/")
@limiter.limit("60/minute")  # 全表掃描（走快取），每用戶每分鐘最多 60 次避免大量請求造成壓力
async def search_tayal_dictionary(request: Request, db: Session = Depends(get_db)):
    """多關鍵字搜尋"""
    try:
        data = await request.json()
        words = data.get("words", [])
        tribe_name = TRIBE_MAP.get(data.get("tribe", "泰雅"), '泰雅語')
        if not words:
            return JSONResponse({"detail": "查詢字詞不可為空"}, status_code=400)

        exact_match_results = {}
        fuzzy_match_results = {}

        for word in words:
            if is_chinese(word):
                results, matched_names = search_by_chinese(db, word, tribe=tribe_name)
                exact_match_results[word] = [r.dict() for r in results]

                fuzzy = fuzzy_search_by_chinese(db, word, exclude_names=matched_names, tribe=tribe_name)
                fuzzy_match_results[word] = {k: [r.dict() for r in v] for k, v in fuzzy.items()}
            else:
                results, matched_names = search(db, word, tribe=tribe_name)
                exact_match_results[word] = [r.dict() for r in results]

                fuzzy = fuzzy_search(db, word, exclude_names=matched_names, tribe=tribe_name)
                fuzzy_match_results[word] = {k: [r.dict() for r in v] for k, v in fuzzy.items()}

        return JSONResponse(
            {"exact_match_results": exact_match_results, "fuzzy_match_results": fuzzy_match_results},
            status_code=200
        )

    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


@router.post("/all/")
@limiter.limit("60/minute")  # 全表掃描（走快取），每用戶每分鐘最多 60 次避免 fetchAllWords 大量請求造成壓力
async def all_tayal_dictionary(request: Request, db: Session = Depends(get_db)):
    """查詢所有詞條。可選傳入 letter/frequency/category/favorites_only(+favorite_names)/
    sort_order 做篩選與排序，並用 limit/offset 做分頁；都不傳則維持原本回傳全部
    （未篩選、未分頁）的行為，供 frontend/src/_favorite/index.jsx 沿用舊行為。"""
    try:
        try:
            body = await request.json()
            tribe = body.get('tribe', '泰雅') or '泰雅'
            limit = body.get('limit')
            offset = body.get('offset') or 0
            letter = body.get('letter') or None
            frequency = body.get('frequency')
            frequency = int(frequency) if frequency not in (None, '') else None
            category = body.get('category') or None
            favorites_only = bool(body.get('favorites_only'))
            favorite_names = body.get('favorite_names') or []
            sort_order = body.get('sort_order') or 'asc'
        except Exception:
            tribe = '泰雅'
            limit = None
            offset = 0
            letter = None
            frequency = None
            category = None
            favorites_only = False
            favorite_names = []
            sort_order = 'asc'
        tribe_name = TRIBE_MAP.get(tribe, '泰雅語')
        results, total = search_all(
            db, tribe=tribe_name, limit=limit, offset=offset,
            letter=letter, frequency=frequency, category=category,
            favorites_only=favorites_only, favorite_names=favorite_names,
            sort_order=sort_order,
        )
        return JSONResponse(
            {
                "all_results": {k: [r.dict() for r in v] for k, v in results.items()},
                "total": total,
            },
            status_code=200
        )
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


@router.post("/key/")
async def allsearch_tayal_dictionary(request: KeywordRequest, db: Session = Depends(get_db)):
    """單一字搜尋"""
    try:
        keyword = request.keyword.strip().replace("　", "")
        if not keyword:
            return JSONResponse({"detail": "查詢字詞不可為空"}, status_code=400)
        tribe_name = TRIBE_MAP.get(request.tribe or '泰雅', '泰雅語')

        if is_chinese(keyword):
            exact, matched_names = search_by_chinese(db, keyword, tribe=tribe_name)
            fuzzy = fuzzy_search_by_chinese(db, keyword, exclude_names=matched_names, tribe=tribe_name)
        else:
            exact, matched_names = search(db, keyword, tribe=tribe_name)
            fuzzy = fuzzy_search(db, keyword, exclude_names=matched_names, tribe=tribe_name)

        return JSONResponse(
            {
                "exact_match_results": {keyword: [r.dict() for r in exact]},
                "fuzzy_match_results": {keyword: {k: [r.dict() for r in v] for k, v in fuzzy.items()}},
            },
            status_code=200
        )

    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


# ------------------------- 文法資料 -------------------------
# 文法資料（章節/規則/例句/詞綴）是固定的參考資料，不會頻繁變動，
# 但 get_grammar 每次都要對 section/rule/example/affix 做好幾輪查詢，
# 沿用 listening.py / sentence.py 的做法：每個 tribe 只在第一次請求時
# 真正查詢一次，之後直接吃記憶體快取，避免重複的多輪 SQL 往返。
_grammar_cache: Dict[str, Optional[dict]] = {}
_grammar_cache_lock = threading.Lock()
_grammar_affixes_cache: Dict[Tuple[str, str], dict] = {}
_grammar_affixes_cache_lock = threading.Lock()
_grammar_quiz_cache: Dict[Tuple[str, str], dict] = {}
_grammar_quiz_cache_lock = threading.Lock()


def _load_grammar(db: Session, tribe_name: str) -> Optional[dict]:
    if tribe_name in _grammar_cache:
        return _grammar_cache[tribe_name]

    with _grammar_cache_lock:
        if tribe_name in _grammar_cache:
            return _grammar_cache[tribe_name]

        sections = db.execute(
            text("SELECT id, section_order, section_key, title, description FROM grammar_section WHERE tribe_id = (SELECT id FROM tribe WHERE name = :tribe) ORDER BY section_order"),
            {"tribe": tribe_name}
        ).fetchall()

        if not sections:
            return None

        result = []
        for sec in sections:
            sec_id, s_order, s_key, s_title, s_desc = sec

            rules = db.execute(
                text("SELECT id, rule_order, rule_key, title, structure, function, notes FROM grammar_rule WHERE section_id = :sid ORDER BY rule_order"),
                {"sid": sec_id}
            ).fetchall()

            # 一次取出本 section 所有 rule 對應的詞綴
            rule_ids = [r[0] for r in rules]
            affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
            if rule_ids:
                affix_rows = db.execute(
                    text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
                    .bindparams(bindparam("rule_ids", expanding=True)),
                    {"rule_ids": rule_ids}
                ).fetchall()
                for r_id, affix in affix_rows:
                    affix_map[r_id].append(affix)

            rules_out = []
            for rule in rules:
                r_id, r_order, r_key, r_title, r_struct, r_func, r_notes = rule

                examples = db.execute(
                    text("SELECT id, example_order, tribe_text, chinese_text, analysis FROM grammar_example WHERE rule_id = :rid ORDER BY example_order"),
                    {"rid": r_id}
                ).fetchall()

                rules_out.append({
                    "id": r_id,
                    "order": r_order,
                    "rule_key": r_key,
                    "title": r_title,
                    "structure": r_struct,
                    "function": r_func,
                    "notes": r_notes,
                    "affix_tags": affix_map.get(r_id, []),
                    "examples": [
                        {
                            "id": ex[0],
                            "tribe_text": ex[2],
                            "chinese_text": ex[3],
                            "analysis": ex[4],
                            "linked_word_ids": [],
                        }
                        for ex in examples
                    ],
                })

            result.append({
                "id": sec_id,
                "order": s_order,
                "section_key": s_key,
                "title": s_title,
                "description": s_desc,   # 純文字，直接回傳
                "rules": rules_out,
            })

        payload = {"tribe": tribe_name, "sections": result}
        _grammar_cache[tribe_name] = payload
        return payload


@router.get("/grammar/{tribe}")
def get_grammar(tribe: str, limit: Optional[int] = None, offset: int = 0, db: Session = Depends(get_db)):
    """查詢指定族語的所有文法章節（含規則、例句、詞綴）
    limit/offset 為選填的章節分頁參數，不傳則維持原本回傳全部章節的行為"""
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        payload = _load_grammar(db, tribe_name)
        if payload is None:
            return JSONResponse({"detail": f"找不到 {tribe_name} 的文法資料"}, status_code=404)
        sections = payload["sections"]
        sliced = sections[offset:offset + limit] if limit is not None else sections[offset:]
        return JSONResponse({**payload, "sections": sliced, "total": len(sections)}, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


@router.get("/grammar/{tribe}/search")
def search_grammar(tribe: str, q: str, db: Session = Depends(get_db)):
    """搜尋文法規則或例句
    q: 關鍵字，可搜尋規則標題、功能說明、例句原文、中文翻譯
    """
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        kw = f"%{q}%"

        # 透過 JOIN grammar_section 取得 tribe，不再依賴 grammar_rule.tribe
        rule_rows = db.execute(
            text("""
                SELECT r.id, r.rule_key, r.title, r.structure, r.function, r.notes
                FROM grammar_rule r
                JOIN grammar_section s ON r.section_id = s.id
                WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                  AND (r.title LIKE :kw OR r.function LIKE :kw OR r.notes LIKE :kw OR r.structure LIKE :kw)
                ORDER BY r.rule_order
            """),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        # 取各 rule 的詞綴
        rule_ids = [r[0] for r in rule_rows]
        affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
        if rule_ids:
            for r_id, affix in db.execute(
                text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
                .bindparams(bindparam("rule_ids", expanding=True)),
                {"rule_ids": rule_ids}
            ).fetchall():
                affix_map[r_id].append(affix)

        example_rows = db.execute(
            text("""
                SELECT e.id, e.rule_id, e.tribe_text, e.chinese_text, e.analysis
                FROM grammar_example e
                JOIN grammar_rule r  ON e.rule_id   = r.id
                JOIN grammar_section s ON r.section_id = s.id
                WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                  AND (e.tribe_text LIKE :kw OR e.chinese_text LIKE :kw OR e.analysis LIKE :kw)
            """),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        affix_rows = db.execute(
            text("SELECT id, affix, affix_type, function, example_form FROM grammar_affix WHERE tribe_id = (SELECT id FROM tribe WHERE name = :tribe) AND (affix LIKE :kw OR function LIKE :kw)"),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        return JSONResponse({
            "tribe": tribe_name,
            "query": q,
            "rules": [
                {"id": r[0], "rule_key": r[1], "title": r[2],
                 "structure": r[3], "function": r[4], "notes": r[5],
                 "affix_tags": affix_map.get(r[0], [])}
                for r in rule_rows
            ],
            "examples": [
                {"id": r[0], "rule_id": r[1], "tribe_text": r[2],
                 "chinese_text": r[3], "analysis": r[4]}
                for r in example_rows
            ],
            "affixes": [
                {"id": r[0], "affix": r[1], "affix_type": r[2],
                 "function": r[3], "example_form": r[4]}
                for r in affix_rows
            ],
        }, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


def _load_grammar_affixes(db: Session, tribe_name: str, affix_type: Optional[str]) -> dict:
    key = (tribe_name, affix_type or "")
    if key in _grammar_affixes_cache:
        return _grammar_affixes_cache[key]

    with _grammar_affixes_cache_lock:
        if key in _grammar_affixes_cache:
            return _grammar_affixes_cache[key]

        if affix_type:
            rows = db.execute(
                text("""
                    SELECT a.id, a.affix, a.affix_type, a.function, a.example_form,
                           GROUP_CONCAT(ra.rule_id) AS rule_ids
                    FROM grammar_affix a
                    LEFT JOIN grammar_rule_affix ra ON ra.affix_id = a.id
                    WHERE a.tribe_id = (SELECT id FROM tribe WHERE name = :tribe) AND a.affix_type = :at
                    GROUP BY a.id
                    ORDER BY a.affix
                """),
                {"tribe": tribe_name, "at": affix_type}
            ).fetchall()
        else:
            rows = db.execute(
                text("""
                    SELECT a.id, a.affix, a.affix_type, a.function, a.example_form,
                           GROUP_CONCAT(ra.rule_id) AS rule_ids
                    FROM grammar_affix a
                    LEFT JOIN grammar_rule_affix ra ON ra.affix_id = a.id
                    WHERE a.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                    GROUP BY a.id
                    ORDER BY a.affix_type, a.affix
                """),
                {"tribe": tribe_name}
            ).fetchall()

        payload = {
            "tribe": tribe_name,
            "affixes": [
                {"id": r[0], "affix": r[1], "affix_type": r[2],
                 "function": r[3], "example_form": r[4],
                 "rule_ids": [int(x) for x in r[5].split(",")] if r[5] else []}
                for r in rows
            ]
        }
        _grammar_affixes_cache[key] = payload
        return payload


@router.get("/grammar/{tribe}/affixes")
def get_grammar_affixes(
    tribe: str,
    affix_type: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """取得詞綴清單
    affix_type: prefix / suffix / infix / circumfix / reduplication / auxiliary（不傳則回傳全部）
    limit/offset 為選填的分頁參數，不傳則維持原本回傳全部詞綴的行為
    """
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        payload = _load_grammar_affixes(db, tribe_name, affix_type)
        affixes = payload["affixes"]
        sliced = affixes[offset:offset + limit] if limit is not None else affixes[offset:]
        return JSONResponse({**payload, "affixes": sliced, "total": len(affixes)}, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


def _load_grammar_quiz_material(db: Session, tribe_name: str, section_key: Optional[str]) -> dict:
    key = (tribe_name, section_key or "")
    if key in _grammar_quiz_cache:
        return _grammar_quiz_cache[key]

    with _grammar_quiz_cache_lock:
        if key in _grammar_quiz_cache:
            return _grammar_quiz_cache[key]

        if section_key:
            rows = db.execute(
                text("""
                    SELECT r.id, r.rule_key, r.title, r.structure, r.function,
                           e.id, e.tribe_text, e.chinese_text, e.analysis
                    FROM grammar_rule r
                    JOIN grammar_section s ON r.section_id = s.id
                    JOIN grammar_example e ON e.rule_id = r.id
                    WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe) AND s.section_key LIKE :sk
                      AND e.tribe_text IS NOT NULL AND e.tribe_text != ''
                    ORDER BY r.rule_order, e.example_order
                """),
                {"tribe": tribe_name, "sk": f"%{section_key}%"}
            ).fetchall()
        else:
            rows = db.execute(
                text("""
                    SELECT r.id, r.rule_key, r.title, r.structure, r.function,
                           e.id, e.tribe_text, e.chinese_text, e.analysis
                    FROM grammar_rule r
                    JOIN grammar_section s ON r.section_id = s.id
                    JOIN grammar_example e ON e.rule_id = r.id
                    WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                      AND e.tribe_text IS NOT NULL AND e.tribe_text != ''
                    ORDER BY r.rule_order, e.example_order
                """),
                {"tribe": tribe_name}
            ).fetchall()

        # 取詞綴資料
        rule_ids = list({row[0] for row in rows})
        affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
        if rule_ids:
            for r_id, affix in db.execute(
                text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
                .bindparams(bindparam("rule_ids", expanding=True)),
                {"rule_ids": rule_ids}
            ).fetchall():
                affix_map[r_id].append(affix)

        # 將例句聚合到各規則下
        rules_map: Dict[int, dict] = {}
        for row in rows:
            r_id = row[0]
            if r_id not in rules_map:
                rules_map[r_id] = {
                    "id": r_id,
                    "rule_key": row[1],
                    "title": row[2],
                    "structure": row[3],
                    "function": row[4],
                    "affix_tags": affix_map.get(r_id, []),
                    "examples": [],
                }
            rules_map[r_id]["examples"].append({
                "id": row[5],
                "tribe_text": row[6],
                "chinese_text": row[7],
                "analysis": row[8],
                "linked_word_ids": [],
            })

        payload = {
            "tribe": tribe_name,
            "rules": list(rules_map.values()),
        }
        _grammar_quiz_cache[key] = payload
        return payload


@router.get("/grammar/{tribe}/quiz")
def get_grammar_quiz_material(
    tribe: str,
    section_key: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """取得有例句的規則清單（用於自動生成測驗題）
    section_key: 指定章節 key（不傳則回傳全部有例句的規則）
    limit/offset 為選填的分頁參數，不傳則維持原本回傳全部規則的行為
    """
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        payload = _load_grammar_quiz_material(db, tribe_name, section_key)
        rules = payload["rules"]
        sliced = rules[offset:offset + limit] if limit is not None else rules[offset:]
        return JSONResponse({**payload, "rules": sliced, "total": len(rules)}, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"detail": str(e)}, status_code=500)


ILRDF_AUDIO_API = "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"

@router.get("/audio/{file_id:path}")
async def proxy_audio(file_id: str):
    try:
        first_url = ILRDF_AUDIO_API + file_id

        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            res = await client.get(first_url)

            if res.status_code in [301, 302, 303, 307, 308]:
                final_url = res.headers.get("Location", "")
            else:
                final_url = res.text.strip()

            if not final_url or "http" not in final_url:
                return Response(content="Unable to resolve audio URL", media_type="text/plain", status_code=404)

            async with httpx.AsyncClient(timeout=15) as c2:
                audio_res = await c2.get(final_url)
                if audio_res.status_code != 200:
                    return Response(content="Audio file not found", media_type="text/plain", status_code=404)
                content_type = audio_res.headers.get("content-type", "audio/mpeg")
                return Response(content=audio_res.content, media_type=content_type)

    except httpx.ConnectError:
        return Response(content="Audio API unreachable", media_type="text/plain", status_code=503)
    except Exception as e:
        return Response(content=str(e), media_type="text/plain", status_code=500)
    

# /debug_audio 只回傳內部除錯資訊（音檔真實 URL、狀態碼、bytes 內容），只在本機開發時註冊，
# 正式環境（DJANGO_DEBUG=False）不掛載這個路由，避免暴露內部資訊。
if os.getenv("DJANGO_DEBUG", "False") == "True":
    @router.get("/debug_audio/{audio_id}")
    async def debug_audio(audio_id: str):

        try:
            # 使用你原本的邏輯抓音檔
            load_dotenv()
            VITE_AUDIO_FILE_URL = os.getenv("VITE_AUDIO_FILE_URL")
            first_url = VITE_AUDIO_FILE_URL + audio_id

            async with httpx.AsyncClient(follow_redirects=False) as client:
                res = await client.get(first_url)

                # 判斷是否 redirect
                if res.status_code in [301, 302, 303, 307, 308]:
                    final_url = res.headers.get("Location")
                else:
                    final_url = res.text.strip()

                if not final_url or "http" not in final_url:
                    return {
                        "success": False,
                        "step": "resolve_redirect",
                        "raw_text": res.text
                    }

            # 第二次請求真正的音檔
            async with httpx.AsyncClient() as c2:
                audio_res = await c2.get(final_url)

                target_bytes = audio_res.content

                # 回傳訊息（避免太大，只回前 50 bytes）
                return {
                    "success": True,
                    "download_url": final_url,
                    "status_code": audio_res.status_code,
                    "content_type": audio_res.headers.get("Content-Type"),
                    "bytes_length": len(target_bytes),
                    "bytes_preview": list(target_bytes[:50])
                }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


@router.post("/sentence-audio/")
async def get_sentence_audio(request: Request, db: Session = Depends(get_db)):
    """
    將句子拆成詞，依序查詢各詞在字典中的音檔 fileId，
    回傳有音檔的詞清單（依句子順序），供前端逐詞串接播放。
    """
    from sqlalchemy import func as sa_func
    body = await request.json()
    sentence: str = body.get("sentence", "")
    tribe: str = body.get("tribe", "布農")
    tribe_name = TRIBE_MAP.get(tribe, tribe)

    # 以空白與標點切詞，保留字母、撇號、連字號
    tokens = re.findall(r"[a-zA-ZʼʻΩ'\-]+", sentence)

    audio_tokens = []
    seen_file_ids: set = set()
    tribe_id_subq = _tribe_id_subquery(tribe_name)

    for token in tokens:
        token_lower = token.lower()
        word = db.query(Word).filter(
            Word.tribe_id == tribe_id_subq,
            sa_func.lower(Word.name) == token_lower
        ).first()

        if not word:
            continue

        audios = load_audio_items_for_words(db, word_ids=[word.id]).get(word.id, [])
        if not audios:
            continue

        file_id = audios[0].get("fileId")
        if not file_id or file_id in seen_file_ids:
            continue

        seen_file_ids.add(file_id)
        audio_tokens.append({"word": token, "fileId": file_id})

    return JSONResponse({"audioTokens": audio_tokens})
