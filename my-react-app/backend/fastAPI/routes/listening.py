import random
import threading
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastAPI.routes.connect import get_db
from fastAPI.routes.model import Word
from fastAPI.routes.word_data import load_explanation_items_for_words, load_audio_items_for_words
from config.tribes import TRIBE_IDS

router = APIRouter()

# 每個族語的有效詞彙（有音檔+有中文解釋）只在第一次請求時查詢+解析一次，
# 之後直接從記憶體回傳，不用每個 request 都重新撈全表、重新 parse JSON。
_valid_words_cache: dict[str, list[dict]] = {}
_valid_words_cache_lock = threading.Lock()


def _load_valid_words(db: Session, tribe_id: str) -> list[dict]:
    if tribe_id in _valid_words_cache:
        return _valid_words_cache[tribe_id]

    with _valid_words_cache_lock:
        if tribe_id in _valid_words_cache:
            return _valid_words_cache[tribe_id]

        words = db.query(Word).filter(Word.tribe_id == tribe_id).all()
        audio_map = load_audio_items_for_words(db, tribe_id=tribe_id)
        explanation_map = load_explanation_items_for_words(db, tribe_id=tribe_id)

        # 過濾：有 audio fileId 且有中文解釋
        valid_words = []
        for w in words:
            audio_items = audio_map.get(w.id, [])
            if not audio_items or not audio_items[0].get('fileId'):
                continue
            exp_items = explanation_map.get(w.id, [])
            if not exp_items:
                continue
            cn = (exp_items[0].get('chineseExplanation') or '').strip()
            if not cn:
                continue
            valid_words.append({
                'word': w.name,
                'audio_id': audio_items[0]['fileId'],
                'meaning': cn,
            })

        _valid_words_cache[tribe_id] = valid_words
        return valid_words


def warm_cache(db: Session) -> None:
    """在 app 啟動時預先為每個族語跑一次 _load_valid_words，
    把全表掃描的成本放在部署當下，而不是留給第一個打這個族語的使用者請求承擔。"""
    for tribe_id in TRIBE_IDS.values():
        _load_valid_words(db, tribe_id)


@router.get("/questions")
def get_listening_questions(
    tribe: str = 'tayal',
    count: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    tribe_id = TRIBE_IDS.get(tribe)
    if not tribe_id:
        raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")

    valid_words = _load_valid_words(db, tribe_id)

    if len(valid_words) < 4:
        raise HTTPException(status_code=500, detail='音頻詞彙不足，無法生成聽力題目')

    # 隨機抽取題目
    selected = random.sample(valid_words, min(count, len(valid_words)))
    all_meanings = list({w['meaning'] for w in valid_words})

    questions = []
    for item in selected:
        distractors = random.sample(
            [m for m in all_meanings if m != item['meaning']],
            min(3, len(all_meanings) - 1)
        )
        options = [item['meaning']] + distractors
        random.shuffle(options)
        questions.append({
            'word': item['word'],
            'audio_id': item['audio_id'],
            'correct': item['meaning'],
            'options': options,
        })

    return {'questions': questions, 'total': len(questions)}
