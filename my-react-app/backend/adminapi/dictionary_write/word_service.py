"""詞條聚合寫入／刪除（P4 §2）。跟 grammar_service.py 是同一套「整個節點
當一個聚合單位」設計，這裡是最後才拆出來的一支——apply_word_tree() 的
row lock＋base_hash 併發檢查是這批稽核修正裡改動最頻繁、風險最集中的
邏輯，故意留到 content_hash／tree_reader／tree_reconcile／grammar_service／
taxonomy_service 都先拆完、行為都用完整測試套件驗證過之後才動這支，
把「動到最敏感邏輯」的風險窗口盡量縮短。
"""
import uuid

from sqlalchemy.orm import Session

from dictionary_db import model as m

from .content_hash import word_content_hash
from .exceptions import ConcurrentModificationError, DictionaryWriteError, ReferencedError, WordNotFoundError
from .tree_reader import get_word_tree
from .tree_reconcile import _reconcile_children, _sync_id_junction, _validate_same_tribe_word_ids

_WORD_SCALAR_FIELDS = (
    "dialect", "name", "pinyin", "variant", "formation_word", "derivative_root",
    "frequency", "dictionary_note", "word_img",
    "is_derivative_root", "is_image", "is_zuzucidian", "is_other_dialect",
)


def _validate_taxonomy_ids(db: Session, model, ids, label):
    if not ids:
        return
    found = {row.id for row in db.query(model.id).filter(model.id.in_(set(ids))).all()}
    missing = set(ids) - found
    if missing:
        raise DictionaryWriteError(f"{label} 不存在：{sorted(missing)}")


def apply_word_tree(db: Session, payload: dict, word_id: str | None = None, expected_hash: str | None = None,
                     create_id: str | None = None) -> str:
    """建立或更新一整棵詞條樹。word_id=None 代表新建（忽略 payload 裡任何
    id 值，一律指派新 id）；否則對既有詞條做對帳式更新。呼叫端負責交易
    邊界（見 dictionary_write_session()）——這個函式只呼叫 db.add/flush/
    delete，不 commit。

    expected_hash：核准流程在拿到列鎖（`with_for_update()`）之後，於同一個
    寫入交易內重新算一次目前內容的雜湊並比對——單靠核准端點在交易外先讀一次
    雜湊、關閉那個讀取 session、之後才另外開交易寫入，中間有一段沒有任何
    鎖保護的空窗：另一筆提案或批次匯入的套用可能剛好夾在這段空窗內把同一筆
    詞條改掉，先讀到的雜湊早就過期了卻不會被發現（見規劃文件 P4 §1 codex
    獨立審查發現的併發缺口）。呼叫端在交易外的比對只是「省一次不必要的
    鎖定寫入」的快速路徑，這裡拿到鎖之後的重新比對才是真正的正確性保證。

    create_id：新建時預先指定 id，取代預設的隨機 UUID。給批次匯入的逐列
    checkpoint／續跑用（見 dictionary_import/import_apply.py）——同一列如果
    需要重跑，每次都用同一個由 (job_id, row) 推導出的 deterministic id，
    重跑才能對回同一筆詞條而不是每次都建一筆新的。單筆提案
    （dictionary_views.py）不需要這個保證，不傳就維持原本的隨機 UUID 行為。

    回傳套用後的 word_id，讓呼叫端（尤其是核准新建提案時）知道剛剛寫入的
    是哪一筆。
    """
    tribe_id = payload.get("tribe_id")
    if not tribe_id:
        raise DictionaryWriteError("tribe_id 為必填")
    if not db.query(m.Tribe.id).filter(m.Tribe.id == tribe_id).first():
        raise DictionaryWriteError(f"族語不存在：{tribe_id}")

    if word_id is None:
        word = m.Word(id=create_id or str(uuid.uuid4()), tribe_id=tribe_id)
        db.add(word)
    else:
        word = db.query(m.Word).filter(m.Word.id == word_id).with_for_update().one_or_none()
        if word is None:
            raise WordNotFoundError(f"詞條不存在：{word_id}")
        if expected_hash:
            current_hash = word_content_hash(get_word_tree(db, word_id))
            if current_hash != expected_hash:
                raise ConcurrentModificationError(f"詞條內容在鎖定前已經被其他人變更：{word_id}")
        word.tribe_id = tribe_id

    for field in _WORD_SCALAR_FIELDS:
        if field in payload:
            setattr(word, field, payload.get(field))
    db.flush()  # 確保新建時 word.id 已確定，後面的子表才能引用

    _validate_taxonomy_ids(db, m.Source, payload.get("source_ids"), "資料來源")
    _sync_id_junction(
        db, m.WordSource, "word_id", word.id, "source_id",
        payload.get("source_ids", []), set_sort_order=True,
    )

    _reconcile_children(
        db, m.WordAudio, "word_id", word.id, payload.get("audios", []),
        scalar_fields=("external_id", "file_id", "audio_class"),
    )

    explanation_pairs = _reconcile_children(
        db, m.WordExplanation, "word_id", word.id, payload.get("explanations", []),
        scalar_fields=("external_id", "chinese_explanation", "english_explanation"),
    )
    for exp_row, exp_item in explanation_pairs:
        _validate_taxonomy_ids(db, m.Category, exp_item.get("category_ids"), "釋義分類")
        _validate_taxonomy_ids(db, m.PartOfSpeech, exp_item.get("pos_ids"), "詞類")
        _validate_taxonomy_ids(db, m.Focus, exp_item.get("focus_ids"), "焦點")
        _sync_id_junction(db, m.WordExplanationCategory, "explanation_id", exp_row.id,
                           "category_id", exp_item.get("category_ids", []))
        _sync_id_junction(db, m.WordExplanationPos, "explanation_id", exp_row.id,
                           "pos_id", exp_item.get("pos_ids", []))
        _sync_id_junction(db, m.WordExplanationFocus, "explanation_id", exp_row.id,
                           "focus_id", exp_item.get("focus_ids", []))
        _reconcile_children(
            db, m.WordExplanationImage, "explanation_id", exp_row.id, exp_item.get("images", []),
            scalar_fields=("image_url",),
        )

        sentence_pairs = _reconcile_children(
            db, m.WordExplanationSentence, "explanation_id", exp_row.id, exp_item.get("sentences", []),
            scalar_fields=("external_id", "original_sentence", "chinese_sentence", "english_sentence"),
        )
        for sent_row, sent_item in sentence_pairs:
            _reconcile_children(
                db, m.WordExplanationSentenceAudio, "sentence_id", sent_row.id, sent_item.get("audios", []),
                scalar_fields=("external_id", "file_id", "audio_class"),
            )

            anaphora_pairs = _reconcile_children(
                db, m.WordExplanationAnaphora, "sentence_id", sent_row.id, sent_item.get("anaphoras", []),
                scalar_fields=("is_highlight", "is_symbol"),
            )
            for ana_row, ana_item in anaphora_pairs:
                items = ana_item.get("items", [])
                _validate_same_tribe_word_ids(
                    db, tribe_id, [it.get("word_id") for it in items], label="標註連結的詞條",
                )
                _reconcile_children(
                    db, m.WordExplanationAnaphoraItem, "anaphora_id", ana_row.id, items,
                    scalar_fields=("word_id", "name"),
                )

    db.flush()
    return word.id


def count_word_references(db: Session, word_id: str) -> dict:
    """給刪除詞條前的引用檢查用。word_explanation_anaphora_item.word_id
    沒有 ondelete=CASCADE（見 model.py 的說明：約 3 成本來就是 NULL），
    grammar_example_word.word_id 更是完全沒有 FK 約束——兩者都不能依賴
    資料庫自動處理，一律自己先查。"""
    anaphora_items = (
        db.query(m.WordExplanationAnaphoraItem)
        .filter(m.WordExplanationAnaphoraItem.word_id == word_id).count()
    )
    grammar_examples = (
        db.query(m.GrammarExampleWord)
        .filter(m.GrammarExampleWord.word_id == word_id).count()
    )
    return {"anaphora_items": anaphora_items, "grammar_example_words": grammar_examples}


def sample_word_references(db: Session, word_id: str, limit: int = 5) -> list[dict]:
    """引用樣本，給 409 回應附上讓管理者判斷用——不只是回一個數字，要看得到
    是哪些詞條的哪些例句引用了它。"""
    rows = (
        db.query(m.WordExplanationAnaphoraItem, m.WordExplanationSentence, m.Word)
        .join(m.WordExplanationAnaphora, m.WordExplanationAnaphoraItem.anaphora_id == m.WordExplanationAnaphora.id)
        .join(m.WordExplanationSentence, m.WordExplanationAnaphora.sentence_id == m.WordExplanationSentence.id)
        .join(m.WordExplanation, m.WordExplanationSentence.explanation_id == m.WordExplanation.id)
        .join(m.Word, m.WordExplanation.word_id == m.Word.id)
        .filter(m.WordExplanationAnaphoraItem.word_id == word_id)
        .limit(limit)
        .all()
    )
    return [
        {"word_id": word.id, "word_name": word.name, "sentence": sentence.original_sentence}
        for _item, sentence, word in rows
    ]


def delete_word_tree(
    db: Session, word_id: str, unlink_references: bool = False, expected_hash: str | None = None,
) -> dict:
    """刪除一整棵詞條樹。有引用（見 count_word_references）且沒有明確帶
    unlink_references 時擋下來，比照主檔管理的「擋下來、講清楚，讓管理者
    自己決定」哲學，不悄悄清空其他詞條裡的連結。

    expected_hash：跟 apply_word_tree() 同一種「拿到列鎖之後重新比對」的
    併發保護——刪除提案核准時，內容如果在送審期間被別人改過，一樣要擋下來
    重新確認，不能悄悄刪掉使用者沒看過的最新版本。"""
    word = db.query(m.Word).filter(m.Word.id == word_id).with_for_update().one_or_none()
    if word is None:
        raise WordNotFoundError(f"詞條不存在：{word_id}")
    if expected_hash:
        current_hash = word_content_hash(get_word_tree(db, word_id))
        if current_hash != expected_hash:
            raise ConcurrentModificationError(f"詞條內容在鎖定前已經被其他人變更：{word_id}")

    counts = count_word_references(db, word_id)
    total_refs = counts["anaphora_items"] + counts["grammar_example_words"]
    if total_refs > 0 and not unlink_references:
        raise ReferencedError(
            f"這個詞條仍被 {total_refs} 處引用，無法刪除，請改用 unlink_references 或先移除引用",
            counts,
        )

    if unlink_references:
        if counts["anaphora_items"] > 0:
            (db.query(m.WordExplanationAnaphoraItem)
             .filter(m.WordExplanationAnaphoraItem.word_id == word_id)
             .update({m.WordExplanationAnaphoraItem.word_id: None}))
        if counts["grammar_example_words"] > 0:
            # grammar_example_word.word_id 是複合主鍵的一部分，不能是 NULL，
            # 「解除引用」在這裡的意思只能是刪除這筆連結（拿掉這個例句跟這個
            # 詞條的關聯），不是把值清空。
            (db.query(m.GrammarExampleWord)
             .filter(m.GrammarExampleWord.word_id == word_id)
             .delete())

    db.delete(word)  # 其餘子樹（word_source/word_audio/word_explanation→...）靠 ondelete=CASCADE
    db.flush()
    return counts
