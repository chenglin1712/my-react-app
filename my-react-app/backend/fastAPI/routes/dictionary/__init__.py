"""辭典路由：原本 1100+ 行的單一 dictionary.py 混了 5 種不相關的職責（Pydantic
schema、搜尋/排序演算法、原始 SQL 文法查詢、4 組行程內快取、音檔代理含 SSRF
處理），任何一次修改都得讓 reviewer 翻過整個檔案、承擔動到不相干邏輯的風險。
拆成職責單一的子模組：

- schemas.py：Pydantic request/response model + JSON 欄位解析函式
- search.py：詞條搜尋/排序演算法、tribe 詞條快取、/keys/、/all/、/key/ 端點
- grammar.py：文法章節/規則/例句/詞綴的原始 SQL 查詢與快取、/grammar/* 端點
- audio_proxy.py：ILRDF 音檔代理（含 SSRF 防護）、/audio/*、/sentence-audio/ 端點

search.py／grammar.py 的行程內快取原本各自用 keyed_lock.py 的 _KeyedLock 手動
管理，現在改用 ..keyed_cache.KeyedCache（跟 quiz.py／listening.py／sentence.py
共用同一套 get-or-compute 實作，見 keyed_cache.py 說明），這個子套件不再需要
自己的鎖工具類別。

這個 __init__.py 把三個子路由合併成單一 router，對外（main.py 的
`app.include_router(dictionary.router, ...)`）行為不變；也重新匯出
schemas/warm_cache，維持既有測試（test_dictionary_request_validation.py）
原本 `from fastAPI.routes.dictionary import ...` 的匯入路徑不必更動。
"""
from fastapi import APIRouter

from . import audio_proxy, grammar, search
from .schemas import (
    AllWordsRequest,
    AnaphoraItem,
    AnaphoraSentence,
    AudioItem,
    ExplanationItem,
    KeywordRequest,
    MultiWordSearchRequest,
    SentenceAudioRequest,
    SentenceItem,
    WordResult,
    parse_anaphoras,
    parse_anaphoraSentences,
    parse_audios,
    parse_explanations,
    parse_sentences,
)
from .search import search_all, warm_cache

router = APIRouter()
router.include_router(search.router)
router.include_router(grammar.router)
router.include_router(audio_proxy.router)

__all__ = [
    "router",
    "warm_cache",
    "search_all",
    "AllWordsRequest",
    "AnaphoraItem",
    "AnaphoraSentence",
    "AudioItem",
    "ExplanationItem",
    "KeywordRequest",
    "MultiWordSearchRequest",
    "SentenceAudioRequest",
    "SentenceItem",
    "WordResult",
    "parse_anaphoras",
    "parse_anaphoraSentences",
    "parse_audios",
    "parse_explanations",
    "parse_sentences",
]
