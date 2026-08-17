"""詞條／文法章節聚合寫入共用的對帳工具——兩邊的 apply_*() 都靠這兩支
函式把「送來的巢狀陣列」跟「資料庫既有子節點」對帳成新增/更新/刪除，
不重新發明一套邏輯。也放 _validate_same_tribe_word_ids()：詞條標註
（word_explanation_anaphora_item.word_id）跟文法例句詞彙連結
（grammar_example_word.word_id）都是「連到 words.id 但沒有 FK 約束、
必須跟父節點同族語」的同一種形狀驗證，word_service.py／grammar_service.py
兩邊都要用，放在這裡讓兩邊共用同一份實作，不重複維護。"""
from sqlalchemy.orm import Session

from dictionary_db import model as m

from .exceptions import CrossTribeReferenceError, DictionaryWriteError


def _reconcile_children(db: Session, model, parent_fk_name, parent_id, incoming_items, scalar_fields,
                         order_field="sort_order"):
    """對帳既有子節點跟前端送來的陣列：帶 id 且該 id 存在於資料庫的更新，
    沒帶 id（或帶的 id 不存在）視為新增，資料庫裡有但沒出現在送來的陣列裡
    的刪除（子節點自己的 ondelete=CASCADE 會負責清掉它自己底下更深一層的
    子樹）。順序欄位一律用陣列位置覆寫，不讀 item 裡的值——大多數表這個
    欄位叫 sort_order，但 grammar_rule／grammar_example 各自叫
    rule_order／example_order，用 order_field 參數化，不強迫改欄位名對齊。

    回傳 [(row, item), ...]，讓呼叫端可以繼續處理每個子節點底下更深一層的
    巢狀內容（此時 row.id 已經確定，因為每處理完一個節點就 flush 一次）。
    """
    existing = {
        row.id: row
        for row in db.query(model).filter(getattr(model, parent_fk_name) == parent_id).all()
    }
    seen_ids = set()
    result = []
    for index, item in enumerate(incoming_items):
        row = existing.get(item.get("id"))
        if row is None:
            row = model()
            setattr(row, parent_fk_name, parent_id)
            db.add(row)
        for field in scalar_fields:
            if field in item:
                setattr(row, field, item.get(field))
        setattr(row, order_field, index)
        db.flush()
        seen_ids.add(row.id)
        result.append((row, item))

    for existing_id, row in existing.items():
        if existing_id not in seen_ids:
            db.delete(row)
    if existing:
        db.flush()

    return result


def _sync_id_junction(db: Session, model, parent_fk_name, parent_id, fk_field_name, incoming_ids, set_sort_order=False):
    """純 id 集合的多對多 junction 表對帳（沒有自己的內容，只有「存在與否」，
    跟 _reconcile_children 分開是因為這種表沒有代理 id 可以拿來對帳，只能
    直接拿 fk 值本身當識別）。"""
    ordered_ids = list(dict.fromkeys(incoming_ids or []))  # 去重、保留順序
    incoming_set = set(ordered_ids)
    existing_rows = db.query(model).filter(getattr(model, parent_fk_name) == parent_id).all()
    existing_by_fk = {getattr(row, fk_field_name): row for row in existing_rows}

    for fk_id, row in existing_by_fk.items():
        if fk_id not in incoming_set:
            db.delete(row)

    for index, fk_id in enumerate(ordered_ids):
        row = existing_by_fk.get(fk_id)
        if row is None:
            row = model()
            setattr(row, parent_fk_name, parent_id)
            setattr(row, fk_field_name, fk_id)
            db.add(row)
        if set_sort_order:
            row.sort_order = index


def _validate_same_tribe_word_ids(db: Session, tribe_id, word_ids, label="連結的詞條"):
    """給任何「連到 words.id 但沒有 FK 約束、必須跟父節點同族語」的欄位
    共用——詞條標註（word_explanation_anaphora_item.word_id）跟文法例句
    詞彙連結（grammar_example_word.word_id）都是同一種形狀的驗證。"""
    word_ids = {w for w in word_ids if w}
    if not word_ids:
        return
    rows = db.query(m.Word.id, m.Word.tribe_id).filter(m.Word.id.in_(word_ids)).all()
    found = {row.id: row.tribe_id for row in rows}
    missing = word_ids - set(found)
    if missing:
        raise DictionaryWriteError(f"{label}不存在：{sorted(missing)}")
    wrong_tribe = [wid for wid, tid in found.items() if tid != tribe_id]
    if wrong_tribe:
        raise CrossTribeReferenceError(f"{label}連到其他族語：{sorted(wrong_tribe)}", wrong_tribe)
