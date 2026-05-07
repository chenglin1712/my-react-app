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
def get_sentence_questions(
    tribe: str = 'tayal',
    count: int = 5,
    db: Session = Depends(get_db)
):
    tribe_id = TRIBE_IDS.get(tribe)
    if not tribe_id:
        raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")

    words = db.query(Word).filter(
        Word.tribe_id == tribe_id,
        Word.explanation_items.isnot(None),
    ).all()

    # 從每個詞彙的 explanation_items → sentenceItems 提取例句
    valid_sentences = []
    for w in words:
        try:
            exp_items = json.loads(w.explanation_items or '[]')
            for exp in exp_items:
                for sent in (exp.get('sentenceItems') or []):
                    original = (sent.get('originalSentence') or '').strip()
                    chinese  = (sent.get('chineseSentence') or '').strip()
                    if not original or not chinese:
                        continue
                    audio_items = sent.get('audioItems') or []
                    audio_id = audio_items[0].get('fileId') if audio_items else None
                    if not audio_id:
                        try:
                            word_audio = json.loads(w.audio_items or '[]')
                            audio_id = word_audio[0].get('fileId') if word_audio else None
                        except Exception:
                            pass
                    valid_sentences.append({
                        'tayal':    original,
                        'chinese':  chinese,
                        'audio_id': audio_id,
                    })
        except Exception:
            continue

    # 以 tayal 句子去重
    seen = set()
    unique_sentences = []
    for s in valid_sentences:
        if s['tayal'] not in seen:
            seen.add(s['tayal'])
            unique_sentences.append(s)

    if len(unique_sentences) < 4:
        raise HTTPException(status_code=500, detail='例句資料不足，無法生成句型題目')

    # 隨機抽題
    selected = random.sample(unique_sentences, min(count, len(unique_sentences)))
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
