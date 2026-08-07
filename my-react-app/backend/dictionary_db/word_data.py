"""共用的 bulk 查詢工具：把 word_source/word_audio/word_explanation 等一系列
正規化後的資料表，組回原本 words.sources/explanation_items/audio_items
那種巢狀 JSON 的等價結構，供 dictionary.py、sentence.py、listening.py、
quiz.py 等所有原本直接 json.loads(word.xxx_items) 的地方共用。

全部用「整批查、Python 端分組」的方式實作（每種資料最多幾個查詢，
不會是每個字各自查一次）。篩選範圍二選一：
- tribe_id：透過 JOIN 一路連回 words.tribe_id，適合「整個族語」這種大範圍、
  且會被快取的情境（例如 dictionary.py 的 _load_tribe_words）。
- word_ids：用 IN (...) 篩選一組明確、數量有限的 word id，適合分頁查詢
  這種只需要一小批字的情境（例如 dictionary.py 的 search_all）。
tribe_id 和 word_ids 都不傳時代表不篩選，一次撈全表（給 quiz.py 這種
需要全部單字的情境用）。
"""
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from dictionary_db.model import (
    Word,
    Source, WordSource,
    WordAudio,
    WordExplanation,
    Category, WordExplanationCategory,
    PartOfSpeech, WordExplanationPos,
    Focus, WordExplanationFocus,
    WordExplanationImage,
    WordExplanationSentence,
    WordExplanationSentenceAudio,
    WordExplanationAnaphora,
    WordExplanationAnaphoraItem,
    MediaAsset,
)


def _needs_word_join(tribe_id: Optional[str], word_ids: Optional[List[str]]) -> bool:
    return tribe_id is not None or word_ids is not None


def _apply_word_filter(query, tribe_id: Optional[str], word_ids: Optional[List[str]]):
    if tribe_id is not None:
        return query.filter(Word.tribe_id == tribe_id)
    if word_ids is not None:
        return query.filter(Word.id.in_(word_ids))
    return query


def load_sources_for_words(
    db: Session, tribe_id: Optional[str] = None, word_ids: Optional[List[str]] = None
) -> Dict[str, List[str]]:
    """回傳 {word_id: [source_name, ...]}"""
    query = db.query(WordSource.word_id, Source.name).join(Source, Source.id == WordSource.source_id)
    if _needs_word_join(tribe_id, word_ids):
        query = _apply_word_filter(query.join(Word, Word.id == WordSource.word_id), tribe_id, word_ids)
    rows = query.order_by(WordSource.word_id, WordSource.sort_order).all()

    result: Dict[str, List[str]] = {}
    for word_id, name in rows:
        result.setdefault(word_id, []).append(name)
    return result


def load_audio_items_for_words(
    db: Session, tribe_id: Optional[str] = None, word_ids: Optional[List[str]] = None
) -> Dict[str, List[dict]]:
    """回傳 {word_id: [{id, fileId, audioClass}, ...]}（單字本身的發音音檔）"""
    query = db.query(WordAudio)
    if _needs_word_join(tribe_id, word_ids):
        query = _apply_word_filter(query.join(Word, Word.id == WordAudio.word_id), tribe_id, word_ids)
    rows = query.order_by(WordAudio.word_id, WordAudio.sort_order).all()

    result: Dict[str, List[dict]] = {}
    for row in rows:
        result.setdefault(row.word_id, []).append({
            "id": row.external_id,
            "fileId": row.file_id,
            "audioClass": row.audio_class,
        })
    return result


def load_explanation_items_for_words(
    db: Session, tribe_id: Optional[str] = None, word_ids: Optional[List[str]] = None
) -> Dict[str, List[dict]]:
    """回傳 {word_id: [ExplanationItem-shape dict, ...]}，結構跟原本
    json.loads(word.explanation_items) 完全相同：
    [{id, chineseExplanation, englishExplanation, category, partOfSpeech,
      focus, imageUrl, sentenceItems: [{id, originalSentence, chineseSentence,
      englishSentence, audioItems: [...], anaphoraSentence: [{anaphoraItems: [...],
      isHighlight, isSymbol}]}]}]
    """
    exp_query = db.query(WordExplanation)
    if _needs_word_join(tribe_id, word_ids):
        exp_query = _apply_word_filter(
            exp_query.join(Word, Word.id == WordExplanation.word_id), tribe_id, word_ids
        )
    explanations = exp_query.order_by(WordExplanation.word_id, WordExplanation.sort_order).all()

    exp_by_id: Dict[int, dict] = {}
    exp_ids_by_word: Dict[str, List[int]] = {}
    for exp in explanations:
        payload = {
            "id": exp.external_id,
            "chineseExplanation": exp.chinese_explanation,
            "englishExplanation": exp.english_explanation,
            "category": [],
            "partOfSpeech": [],
            "focus": [],
            "imageUrl": [],
            "sentenceItems": [],
        }
        exp_by_id[exp.id] = payload
        exp_ids_by_word.setdefault(exp.word_id, []).append(exp.id)

    def _base_query(model):
        q = db.query(model)
        if _needs_word_join(tribe_id, word_ids):
            q = _apply_word_filter(
                q.join(WordExplanation, WordExplanation.id == model.explanation_id)
                 .join(Word, Word.id == WordExplanation.word_id),
                tribe_id, word_ids,
            )
        return q

    for explanation_id, name in _base_query(WordExplanationCategory).join(
        Category, Category.id == WordExplanationCategory.category_id
    ).with_entities(WordExplanationCategory.explanation_id, Category.name).all():
        if explanation_id in exp_by_id:
            exp_by_id[explanation_id]["category"].append(name)

    for explanation_id, name in _base_query(WordExplanationPos).join(
        PartOfSpeech, PartOfSpeech.id == WordExplanationPos.pos_id
    ).with_entities(WordExplanationPos.explanation_id, PartOfSpeech.name).all():
        if explanation_id in exp_by_id:
            exp_by_id[explanation_id]["partOfSpeech"].append(name)

    for explanation_id, name in _base_query(WordExplanationFocus).join(
        Focus, Focus.id == WordExplanationFocus.focus_id
    ).with_entities(WordExplanationFocus.explanation_id, Focus.name).all():
        if explanation_id in exp_by_id:
            exp_by_id[explanation_id]["focus"].append(name)

    # P5 辭典媒體自主化：outerjoin MediaAsset，media_asset_id 有值時一定是
    # verified（migrate_dictionary_media.py 的設計就是只在驗證通過後才回填
    # 這個 FK，見該檔案 _claim_or_link_asset 的說明），可以直接信任、不用
    # 再檢查一次 status。查無 media_asset（還沒遷移到）就照舊回傳原始
    # image_url（ILRDF／承包商官方網址），前端完全不用改。
    img_query = _base_query(WordExplanationImage).outerjoin(
        MediaAsset, MediaAsset.id == WordExplanationImage.media_asset_id
    ).with_entities(WordExplanationImage, MediaAsset.public_url)
    for img, public_url in img_query.order_by(WordExplanationImage.sort_order).all():
        if img.explanation_id in exp_by_id:
            exp_by_id[img.explanation_id]["imageUrl"].append(public_url or img.image_url)

    # ---- sentences ----
    sent_query = db.query(WordExplanationSentence)
    if _needs_word_join(tribe_id, word_ids):
        sent_query = _apply_word_filter(
            sent_query.join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
                      .join(Word, Word.id == WordExplanation.word_id),
            tribe_id, word_ids,
        )
    sentences = sent_query.order_by(WordExplanationSentence.explanation_id, WordExplanationSentence.sort_order).all()

    sent_by_id: Dict[int, dict] = {}
    for sent in sentences:
        payload = {
            "id": sent.external_id,
            "originalSentence": sent.original_sentence,
            "chineseSentence": sent.chinese_sentence,
            "englishSentence": sent.english_sentence,
            "audioItems": [],
            "anaphoraSentence": [],
        }
        sent_by_id[sent.id] = payload
        if sent.explanation_id in exp_by_id:
            exp_by_id[sent.explanation_id]["sentenceItems"].append(payload)

    def _sentence_scoped_query(model, join_col):
        q = db.query(model)
        if _needs_word_join(tribe_id, word_ids):
            q = _apply_word_filter(
                q.join(WordExplanationSentence, WordExplanationSentence.id == join_col)
                 .join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
                 .join(Word, Word.id == WordExplanation.word_id),
                tribe_id, word_ids,
            )
        return q

    for audio in _sentence_scoped_query(
        WordExplanationSentenceAudio, WordExplanationSentenceAudio.sentence_id
    ).order_by(WordExplanationSentenceAudio.sort_order).all():
        if audio.sentence_id in sent_by_id:
            sent_by_id[audio.sentence_id]["audioItems"].append({
                "id": audio.external_id,
                "fileId": audio.file_id,
                "audioClass": audio.audio_class,
            })

    anaphoras = _sentence_scoped_query(
        WordExplanationAnaphora, WordExplanationAnaphora.sentence_id
    ).order_by(WordExplanationAnaphora.sentence_id, WordExplanationAnaphora.sort_order).all()

    ana_by_id: Dict[int, dict] = {}
    for ana in anaphoras:
        payload = {
            "anaphoraItems": [],
            "isHighlight": ana.is_highlight,
            "isSymbol": ana.is_symbol,
        }
        ana_by_id[ana.id] = payload
        if ana.sentence_id in sent_by_id:
            sent_by_id[ana.sentence_id]["anaphoraSentence"].append(payload)

    item_query = db.query(WordExplanationAnaphoraItem)
    if _needs_word_join(tribe_id, word_ids):
        item_query = _apply_word_filter(
            item_query.join(WordExplanationAnaphora, WordExplanationAnaphora.id == WordExplanationAnaphoraItem.anaphora_id)
                      .join(WordExplanationSentence, WordExplanationSentence.id == WordExplanationAnaphora.sentence_id)
                      .join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
                      .join(Word, Word.id == WordExplanation.word_id),
            tribe_id, word_ids,
        )
    for item in item_query.order_by(WordExplanationAnaphoraItem.anaphora_id, WordExplanationAnaphoraItem.sort_order).all():
        if item.anaphora_id in ana_by_id:
            ana_by_id[item.anaphora_id]["anaphoraItems"].append({
                "id": item.word_id,
                "name": item.name,
            })

    result: Dict[str, List[dict]] = {}
    for word_id, ids in exp_ids_by_word.items():
        result[word_id] = [exp_by_id[i] for i in ids]
    return result
