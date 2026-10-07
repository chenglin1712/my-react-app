"""千詞表只增不減更新用的【窄操作】：只新增一筆來源連結或一筆釋義，其他一律不動。

為什麼不用 apply_word_tree：它對 source_ids／audios／explanations 做「整集合對帳」，payload 沒帶到的既有子節點會被刪除，
拿它做 patch 風險太高（見規劃審查）。這裡每個函式都：
  1. 鎖定該詞條的 words 列（PostgreSQL 為真正的列鎖；SQLite 會忽略，見 dictionary_write_session 的說明）；
  2. 重新計算整棵詞條樹的內容雜湊並與 expected_hash 比對，不符就拒絕（防止在檢查之後被別人改過）；
  3. 只 INSERT 一列（或在還原時只 DELETE 自己新增的那一列），不碰其他子節點；
  4. 回傳寫入前後的雜湊，給呼叫端寫操作紀錄。
呼叫端負責交易邊界（dictionary_write_session），這裡只 flush、不 commit。
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from dictionary_db import model as m

from .content_hash import word_content_hash
from .exceptions import ConcurrentModificationError, DictionaryWriteError, WordNotFoundError
from .tree_reader import get_word_tree
from .word_service import count_word_references


def tree_hash(db: Session, word_id: str) -> str:
    return word_content_hash(get_word_tree(db, word_id))


def _lock_and_verify(db: Session, word_id: str, expected_tribe_id: str, expected_hash: str) -> str:
    word = db.query(m.Word).filter(m.Word.id == word_id).with_for_update().one_or_none()
    if word is None:
        raise WordNotFoundError(f"詞條不存在：{word_id}")
    if word.tribe_id != expected_tribe_id:
        raise DictionaryWriteError(f"詞條不屬於預期的族語：{word_id}")
    current = tree_hash(db, word_id)
    if current != expected_hash:
        raise ConcurrentModificationError(f"詞條內容在檢查後已被變更：{word_id}")
    return current


def append_source(db: Session, word_id: str, expected_tribe_id: str, source_id: int, expected_hash: str) -> dict:
    before = _lock_and_verify(db, word_id, expected_tribe_id, expected_hash)
    if db.query(m.Source.id).filter(m.Source.id == source_id).first() is None:
        raise DictionaryWriteError(f"資料來源不存在：{source_id}")
    exists = db.query(m.WordSource.id).filter(m.WordSource.word_id == word_id, m.WordSource.source_id == source_id).first()
    if exists:
        return {"before_hash": before, "after_hash": before, "added": False}
    top = db.query(m.WordSource.sort_order).filter(m.WordSource.word_id == word_id).order_by(m.WordSource.sort_order.desc()).first()
    next_order = (top[0] + 1) if top and top[0] is not None else 0
    row = m.WordSource(word_id=word_id, source_id=source_id, sort_order=next_order)
    db.add(row)
    db.flush()
    return {"before_hash": before, "after_hash": tree_hash(db, word_id), "added": True, "source_row_id": row.id}


def _has_real_explanation(db: Session, word_id: str) -> bool:
    return any(
        text and text.strip()
        for (text,) in db.query(m.WordExplanation.chinese_explanation).filter(m.WordExplanation.word_id == word_id).all()
    )


def append_explanation(db: Session, word_id: str, expected_tribe_id: str, text: str, expected_hash: str) -> dict:
    """只在這個詞條『沒有任何有實質文字的中文釋義』時新增一筆；已有就拒絕（絕不追加到既有釋義旁邊）。"""
    if not text or not text.strip():
        raise DictionaryWriteError("釋義文字不可空白")
    before = _lock_and_verify(db, word_id, expected_tribe_id, expected_hash)
    if _has_real_explanation(db, word_id):
        raise DictionaryWriteError(f"詞條已有中文釋義，不追加：{word_id}")
    top = db.query(m.WordExplanation.sort_order).filter(m.WordExplanation.word_id == word_id).order_by(m.WordExplanation.sort_order.desc()).first()
    next_order = (top[0] + 1) if top and top[0] is not None else 0
    row = m.WordExplanation(word_id=word_id, external_id=None, sort_order=next_order, chinese_explanation=text, english_explanation="")
    db.add(row)
    db.flush()
    return {"before_hash": before, "after_hash": tree_hash(db, word_id), "explanation_id": row.id}


def remove_appended_source(db: Session, word_id: str, expected_tribe_id: str, source_id: int, source_row_id: int,
                           expected_after_hash: str) -> bool:
    """還原：只刪【當初新增的那一列】（以主鍵核對 word／source 都相符），而且只在詞條內容仍等於寫入後雜湊時才做。
    如果那一列已不存在（例如被別人刪掉後又用新主鍵重建同一個連結），不動它，改拋錯讓呼叫端略過並回報。"""
    _lock_and_verify(db, word_id, expected_tribe_id, expected_after_hash)
    row = db.query(m.WordSource).filter(m.WordSource.id == source_row_id).one_or_none()
    if row is None or row.word_id != word_id or row.source_id != source_id:
        raise DictionaryWriteError(f"要還原的來源連結已不是當初新增的那一列：{source_row_id}")
    db.delete(row)
    db.flush()
    return True


def remove_appended_explanation(db: Session, word_id: str, expected_tribe_id: str, explanation_id: int,
                                expected_text: str, expected_after_hash: str) -> bool:
    _lock_and_verify(db, word_id, expected_tribe_id, expected_after_hash)
    row = db.query(m.WordExplanation).filter(m.WordExplanation.id == explanation_id, m.WordExplanation.word_id == word_id).one_or_none()
    if row is None or row.chinese_explanation != expected_text:
        raise DictionaryWriteError(f"要還原的釋義已不存在或內容不同：{explanation_id}")
    db.delete(row)
    db.flush()
    return True


def create_lock_key(tribe_id: str, name: str) -> str:
    """PostgreSQL 的字串參數不能含 NUL（0x00），所以分隔符用 0x1f（單元分隔符）。"""
    return f"{tribe_id}\x1f{name}"


def create_word(db: Session, tribe_id: str, word_id: str, name: str, dialect: str, source_id: int, zh: str) -> dict:
    """新增一個全新的詞條（只 INSERT）：一筆詞條、一個來源連結、一筆中文釋義，其他欄位一律明確寫入預設值。
    拒絕條件：id 已存在、同族語已有完全同名詞條、id 被孤兒引用（anaphora／文法例句）指到、來源或族語不存在。"""
    if not name or name != name.strip() or not zh or not zh.strip():
        raise DictionaryWriteError("詞形與中文釋義不可空白，詞形不可帶前後空白")
    if db.query(m.Tribe.id).filter(m.Tribe.id == tribe_id).first() is None:
        raise DictionaryWriteError(f"族語不存在：{tribe_id}")
    if db.query(m.Source.id).filter(m.Source.id == source_id).first() is None:
        raise DictionaryWriteError(f"資料來源不存在：{source_id}")
    if db.get_bind().dialect.name == "postgresql":
        # 序列化『同族語同詞形』的建立（words 沒有 (tribe_id, name) 唯一約束）。只擋得住同樣走這個函式的建立者；
        # 其他辭典寫入路徑不會取這把鎖，所以正式批次期間仍應避免其他人同時新增詞條。
        db.execute(text("select pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": create_lock_key(tribe_id, name)})
    if db.query(m.Word.id).filter(m.Word.id == word_id).first() is not None:
        raise DictionaryWriteError(f"詞條 id 已存在：{word_id}")
    if db.query(m.Word.id).filter(m.Word.tribe_id == tribe_id, m.Word.name == name).first() is not None:
        raise DictionaryWriteError(f"同族語已有完全同名的詞條：{name}")
    refs = count_word_references(db, word_id)
    if refs["anaphora_items"] or refs["grammar_example_words"]:
        raise DictionaryWriteError(f"已有孤兒引用指向這個詞條 id：{word_id}")
    db.add(m.Word(id=word_id, tribe_id=tribe_id, dialect=dialect, name=name, pinyin="", variant="", formation_word="",
                  derivative_root="", frequency=0, hit=0, dictionary_note="", word_img="",
                  is_derivative_root=False, is_image=False, is_zuzucidian=False, is_other_dialect=False))
    db.flush()
    db.add(m.WordSource(word_id=word_id, source_id=source_id, sort_order=0))
    db.add(m.WordExplanation(word_id=word_id, external_id=None, sort_order=0, chinese_explanation=zh, english_explanation=""))
    db.flush()
    return {"before_hash": "none", "after_hash": tree_hash(db, word_id), "created": True}


def verify_existing(db: Session, word_id: str, expected_tribe_id: str, expected_hash: str) -> dict:
    """同一群的另一個詞形要對到『已經存在』的同一個詞條：只鎖定並驗證，不寫入。"""
    h = _lock_and_verify(db, word_id, expected_tribe_id, expected_hash)
    return {"before_hash": h, "after_hash": h, "created": False}


def delete_created_word(db: Session, word_id: str, expected_tribe_id: str, expected_after_hash: str) -> bool:
    """還原：只刪【我們建立的】詞條。詞條內容必須仍等於寫入後雜湊（沒被人改過）、而且沒有任何外部引用才刪。
    子表（來源連結、釋義）明確逐一刪除，不依賴資料庫的連鎖刪除（各資料庫行為不同）。"""
    _lock_and_verify(db, word_id, expected_tribe_id, expected_after_hash)
    refs = count_word_references(db, word_id)
    if refs["anaphora_items"] or refs["grammar_example_words"]:
        raise DictionaryWriteError(f"詞條已被引用，不刪除：{word_id}")
    db.query(m.WordSource).filter(m.WordSource.word_id == word_id).delete()
    db.query(m.WordExplanation).filter(m.WordExplanation.word_id == word_id).delete()
    db.query(m.Word).filter(m.Word.id == word_id).delete()
    db.flush()
    return True
