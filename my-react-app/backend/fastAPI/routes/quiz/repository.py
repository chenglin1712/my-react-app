"""出題用的詞彙資料存取層——依 tribe 分開快取的候選單字清單，以及每個
單字附帶的釋義／音檔資料。跟 irt.py（怎麼排序/評分候選字）、generator.py
（怎麼把候選字組成一道題）是不同關注點，這裡只管「資料從哪裡來、怎麼快取」。
"""
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from config.tribes import TRIBE_IDS
from dictionary_db.model import Word
from dictionary_db.word_data import load_audio_items_for_words, load_explanation_items_for_words

from ..keyed_cache import KeyedCache
from .schemas import WordDTO

# ----------------------------
# DB helper: load all words (module-level cache)
# ----------------------------
_words_cache: KeyedCache[str, List[WordDTO]] = KeyedCache()
_word_explanations_cache: Dict[str, List[dict]] = {}
_word_audios_cache: Dict[str, List[dict]] = {}

def load_all_words(db: Optional[Session] = None, tribe_id: Optional[str] = None) -> List[WordDTO]:
    """依 tribe_id 載入該族語的詞彙清單（模組級快取，每個族語第一次請求時查詢一次）。
    word id 在 words 表裡全域唯一，不同族語不會撞號，所以 explanation/audio 快取
    繼續當成單一全域字典累加即可，只有 _words_cache（出題用的候選單字清單）需要
    依族語分開存，避免出題時把不同族語的單字混在同一份候選池裡。"""
    if tribe_id in _words_cache:
        return _words_cache.get(tribe_id)
    if not db:
        return []

    def _compute():
        query = db.query(Word)
        if tribe_id:
            query = query.filter(Word.tribe_id == tribe_id)
        words = [WordDTO(id=w.id, name=w.name, frequency=w.frequency) for w in query.all()]
        _word_explanations_cache.update(load_explanation_items_for_words(db, tribe_id=tribe_id))
        _word_audios_cache.update(load_audio_items_for_words(db, tribe_id=tribe_id))
        return words

    return _words_cache.get_or_compute(tribe_id, _compute)


def warm_cache(db: Session) -> None:
    """在 app 啟動時預先為每個族語跑一次 load_all_words，
    把全表掃描的成本放在部署當下，而不是留給第一個打 quiz 的使用者請求承擔。"""
    for tribe_id in TRIBE_IDS.values():
        load_all_words(db, tribe_id)

# ----------------------------
# 出題用小工具（原本是 generate_quiz_frontend 內的巢狀函式，
# 因為只讀模組級快取＋參數都已明確傳入，不需要 closure，抽成模組層級函式）
# ----------------------------
def _get_cn(word_obj):
    items = _word_explanations_cache.get(word_obj.id, [])
    return (items[0].get('chineseExplanation') or '未知') if items else '未知'

def _get_audio(word_obj):
    items = _word_audios_cache.get(word_obj.id, [])
    return items[0].get('fileId') if items else None
