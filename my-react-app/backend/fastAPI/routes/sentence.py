import random
import threading
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from fastAPI.routes.connect import get_db
from fastAPI.routes.model import Word
from fastAPI.routes.word_data import load_explanation_items_for_words, load_audio_items_for_words
from config.tribes import TRIBE_IDS

router = APIRouter()

# 每個族語去重後的例句清單只在第一次請求時查詢+解析一次，
# 之後直接從記憶體回傳，不用每個 request 都重新撈全表、重新 parse JSON。
_unique_sentences_cache: dict[str, list[dict]] = {}
_unique_sentences_cache_lock = threading.Lock()


def _load_unique_sentences(db: Session, tribe_id: str) -> list[dict]:
    if tribe_id in _unique_sentences_cache:
        return _unique_sentences_cache[tribe_id]

    with _unique_sentences_cache_lock:
        if tribe_id in _unique_sentences_cache:
            return _unique_sentences_cache[tribe_id]

        words = db.query(Word).filter(Word.tribe_id == tribe_id).all()
        explanation_map = load_explanation_items_for_words(db, tribe_id=tribe_id)
        audio_map = load_audio_items_for_words(db, tribe_id=tribe_id)

        # 從每個詞彙的 explanation_items → sentenceItems 提取例句
        valid_sentences = []
        for w in words:
            for exp in explanation_map.get(w.id, []):
                for sent in (exp.get('sentenceItems') or []):
                    original = (sent.get('originalSentence') or '').strip()
                    chinese  = (sent.get('chineseSentence') or '').strip()
                    if not original or not chinese:
                        continue
                    audio_items = sent.get('audioItems') or []
                    audio_id = audio_items[0].get('fileId') if audio_items else None
                    if not audio_id:
                        word_audio = audio_map.get(w.id, [])
                        audio_id = word_audio[0].get('fileId') if word_audio else None
                    valid_sentences.append({
                        'tayal':    original,
                        'chinese':  chinese,
                        'audio_id': audio_id,
                    })

        # 以 tayal 句子去重，優先保留有音訊的版本
        seen = set()
        unique_sentences = []
        for s in valid_sentences:
            if s['tayal'] not in seen:
                seen.add(s['tayal'])
                unique_sentences.append(s)

        _unique_sentences_cache[tribe_id] = unique_sentences
        return unique_sentences


def warm_cache(db: Session) -> None:
    """在 app 啟動時預先為每個族語跑一次 _load_unique_sentences，
    把全表掃描的成本放在部署當下，而不是留給第一個打這個族語的使用者請求承擔。"""
    for tribe_id in TRIBE_IDS.values():
        _load_unique_sentences(db, tribe_id)


@router.get("/questions")
def get_sentence_questions(
    tribe: str = 'tayal',
    count: int = 5,
    db: Session = Depends(get_db)
):
    tribe_id = TRIBE_IDS.get(tribe)
    if not tribe_id:
        raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")

    unique_sentences = _load_unique_sentences(db, tribe_id)

    # 只從有音訊的句子中抽題，確保每題都有發音輔助
    with_audio = [s for s in unique_sentences if s['audio_id']]
    pool = with_audio if len(with_audio) >= 4 else unique_sentences

    if len(pool) < 4:
        raise HTTPException(status_code=500, detail='例句資料不足，無法生成句型題目')

    # 隨機抽題
    selected = random.sample(pool, min(count, len(pool)))
    all_chinese = list({s['chinese'] for s in unique_sentences})

    questions = []
    for item in selected:
        distractors = random.sample(
            [c for c in all_chinese if c != item['chinese']],
            min(3, len(all_chinese) - 1)
        )
        options = [item['chinese']] + distractors
        random.shuffle(options)
        questions.append({
            'tayal':    item['tayal'],
            'chinese':  item['chinese'],
            'audio_id': item['audio_id'],
            'options':  options,
        })

    return {'questions': questions, 'total': len(questions)}
