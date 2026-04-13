import json
import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from fastAPI.routes.connect import get_db
from fastAPI.routes.model import Word

router = APIRouter()

TRIBE_IDS = {
    'tayal':   'fc76ed97-0dd8-4587-82ad-7a6dbe125001',
    'amis':    'e68273b9-1f2b-4c42-8d95-f52189ab24b7',
    'bunun':   '865a96e3-3384-45b3-8bd0-e1f799b75515',
    'kavalan': 'c5974f37-b49d-466a-ab24-6893ab4ef6a5',
    'paiwan':  '19c77a3b-3a81-496f-b0f4-afe6d9155edd',
}


@router.get("/questions")
def get_listening_questions(
    tribe: str = 'tayal',
    count: int = 10,
    db: Session = Depends(get_db)
):
    tribe_id = TRIBE_IDS.get(tribe)
    if not tribe_id:
        raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")

    words = db.query(Word).filter(
        Word.tribe_id == tribe_id,
        Word.audio_items.isnot(None),
        Word.explanation_items.isnot(None),
    ).all()

    # 過濾：有 audio fileId 且有中文解釋
    valid_words = []
    for w in words:
        try:
            audio_items = json.loads(w.audio_items or '[]')
            if not audio_items or not audio_items[0].get('fileId'):
                continue
            exp_items = json.loads(w.explanation_items or '[]')
            if not exp_items:
                continue
            cn = exp_items[0].get('chineseExplanation', '').strip()
            if not cn:
                continue
            valid_words.append({
                'word': w.name,
                'audio_id': audio_items[0]['fileId'],
                'meaning': cn,
            })
        except Exception:
            continue

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
