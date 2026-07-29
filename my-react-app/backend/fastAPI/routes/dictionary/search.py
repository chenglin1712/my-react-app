import asyncio
import logging
import re
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from dictionary_db.connect import get_db
from dictionary_db.model import Tribe, Word
from dictionary_db.word_data import (
    load_audio_items_for_words,
    load_explanation_items_for_words,
    load_sources_for_words,
)
from config.tribes import TRIBE_MAP, resolve_tribe_name
from fastAPI.rate_limit import limiter

from ..keyed_cache import KeyedCache
from .schemas import (
    AllWordsRequest,
    KeywordRequest,
    MultiWordSearchRequest,
    WordResult,
    parse_audios,
    parse_explanations,
)

router = APIRouter()

logger = logging.getLogger(__name__)


# ------------------------- Utilities -------------------------
def simplify_tayal(word: str) -> str:
    """忽略數字結尾（例：maku3 → maku）"""
    return re.sub(r'\d+$', '', word or "")

def is_chinese(text: str) -> bool:
    return any('一' <= ch <= '鿿' for ch in text)

def _tribe_id_subquery(tribe_name: str):
    # tribe (chinese name) -> tribe_id, replaces the old Word.tribe == tribe_name filter
    return select(Tribe.id).where(Tribe.name == tribe_name).scalar_subquery()


# ------------------------- 搜尋邏輯 -------------------------
# search_by_chinese/fuzzy_search_by_chinese/search/fuzzy_search 這四個函式
# 原本每次呼叫都對 Word table 做一次 tribe 全表掃描＋JSON parse。
# 沿用 listening.py 的做法：每個 tribe 的詞條只在第一次用到時真正查詢＋解析一次，
# 之後直接從記憶體快取的 WordResult 清單做過濾，不用每個 request 都重新打 DB。
_tribe_words_cache: KeyedCache[str, List[WordResult]] = KeyedCache()


def _load_tribe_words(db: Session, tribe: str) -> List[WordResult]:
    def _compute():
        words = db.query(Word).filter(Word.tribe_id == _tribe_id_subquery(tribe)).all()
        tribe_id = words[0].tribe_id if words else None
        sources_map = load_sources_for_words(db, tribe_id)
        audio_map = load_audio_items_for_words(db, tribe_id)
        explanation_map = load_explanation_items_for_words(db, tribe_id)

        return [
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

    return _tribe_words_cache.get_or_compute(tribe, _compute)


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
    全部不傳則維持原本回傳全部（未篩選、未分頁）的行為。回傳 (分組後的當頁資料, 篩選後總筆數)。

    這支原本每次呼叫都重新查整個 tribe 的 Word + 逐一批次查 sources/audio/explanation
    再組成 WordResult（單詞查詢頁一進頁面就會自動打這支 API，實測泰雅語 6,202 筆詞
    要價約 11.7 秒，「載入更多」等後續分頁請求 filter/sort 前一樣要整套重跑一次，
    約 8.7 秒），是全站唯一沒吃到 search()/fuzzy_search() 等既有 _load_tribe_words()
    tribe 級快取（見上方、app 啟動時已由 warm_cache() 預熱）的查詢路徑。改成沿用
    同一份快取後，篩選/排序/分頁全部改在這份已經解析好的清單上做，DB 查詢與逐詞
    組裝 WordResult 的成本只會在該 tribe 第一次被用到時付一次。"""
    all_word_results = _load_tribe_words(db, tribe)

    favorite_names_set = set(favorite_names or [])
    filtered = [
        wr for wr in all_word_results
        if wr.explanationItems  # 沿用原本「沒有釋義的詞不列入查詢結果」的行為
        and (not letter or (wr.name or '').lower().startswith(letter.lower()))
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
def _search_multi_words(db: Session, words: List[str], tribe_name: str) -> Tuple[dict, dict]:
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

    return exact_match_results, fuzzy_match_results


@router.post("/keys/")
@limiter.limit("60/minute")  # 全表掃描（走快取），每用戶每分鐘最多 60 次避免大量請求造成壓力
async def search_tayal_dictionary(request: Request, body: MultiWordSearchRequest, db: Session = Depends(get_db)):
    """多關鍵字搜尋"""
    try:
        words = body.words
        try:
            tribe_name = resolve_tribe_name(body.tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        if not words:
            return JSONResponse({"detail": "查詢字詞不可為空"}, status_code=400)

        # 冷快取時 _load_tribe_words 是同步的全表掃描＋JSON parse，直接呼叫會卡住
        # 整個 event loop（同一 worker 上的其他請求，包含 /health，都會被一起卡住）。
        # 丟到執行緒池執行，跟同一支檔案已修好的 compare_audio／analyze_image 同一套作法。
        exact_match_results, fuzzy_match_results = await asyncio.to_thread(
            _search_multi_words, db, words, tribe_name
        )

        return JSONResponse(
            {"exact_match_results": exact_match_results, "fuzzy_match_results": fuzzy_match_results},
            status_code=200
        )

    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)


@router.post("/all/")
@limiter.limit("60/minute")  # 全表掃描（走快取），每用戶每分鐘最多 60 次避免 fetchAllWords 大量請求造成壓力
async def all_tayal_dictionary(request: Request, body: AllWordsRequest, db: Session = Depends(get_db)):
    """查詢所有詞條。可選傳入 letter/frequency/category/favorites_only(+favorite_names)/
    sort_order 做篩選與排序，並用 limit/offset 做分頁；都不傳則維持原本回傳全部
    （未篩選、未分頁）的行為，供 frontend/src/_favorite/index.jsx 沿用舊行為。"""
    try:
        try:
            tribe_name = resolve_tribe_name(body.tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        # 冷快取時 search_all -> _load_tribe_words 是同步的全表掃描＋JSON parse，
        # 丟到執行緒池執行，避免卡住 event loop（見 /keys/ 同樣的說明）。
        results, total = await asyncio.to_thread(
            search_all, db, tribe=tribe_name, limit=body.limit, offset=body.offset,
            letter=body.letter, frequency=body.frequency, category=body.category,
            favorites_only=body.favorites_only, favorite_names=body.favorite_names,
            sort_order=body.sort_order,
        )
        return JSONResponse(
            {
                "all_results": {k: [r.dict() for r in v] for k, v in results.items()},
                "total": total,
            },
            status_code=200
        )
    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)


def _search_single_keyword(db: Session, keyword: str, tribe_name: str):
    if is_chinese(keyword):
        exact, matched_names = search_by_chinese(db, keyword, tribe=tribe_name)
        fuzzy = fuzzy_search_by_chinese(db, keyword, exclude_names=matched_names, tribe=tribe_name)
    else:
        exact, matched_names = search(db, keyword, tribe=tribe_name)
        fuzzy = fuzzy_search(db, keyword, exclude_names=matched_names, tribe=tribe_name)
    return exact, fuzzy


@router.post("/key/")
@limiter.limit("60/minute")  # 原本沒有限流，見同檔案其他端點的說明
async def allsearch_tayal_dictionary(request: Request, body: KeywordRequest, db: Session = Depends(get_db)):
    """單一字搜尋"""
    try:
        keyword = body.keyword.strip().replace("　", "")
        if not keyword:
            return JSONResponse({"detail": "查詢字詞不可為空"}, status_code=400)
        try:
            tribe_name = resolve_tribe_name(body.tribe or '泰雅')
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)

        # 冷快取時是同步的全表掃描＋JSON parse，丟到執行緒池執行，
        # 避免卡住 event loop（見 /keys/ 同樣的說明）。
        exact, fuzzy = await asyncio.to_thread(_search_single_keyword, db, keyword, tribe_name)

        return JSONResponse(
            {
                "exact_match_results": {keyword: [r.dict() for r in exact]},
                "fuzzy_match_results": {keyword: {k: [r.dict() for r in v] for k, v in fuzzy.items()}},
            },
            status_code=200
        )

    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)
