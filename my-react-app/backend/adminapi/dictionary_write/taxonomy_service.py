"""主檔管理（P4.2）：source／category／part_of_speech／focus／grammar_affix
共用同一套 CRUD＋合併邏輯。tribe（族語本身）刻意不在這裡——見
dictionary_taxonomy_views.py 開頭說明，5 筆的 UUID 寫死在 config/tribes.py，
不是後台可以新增/刪除/合併的東西。
"""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from dictionary_db import model as m

from .exceptions import CrossTribeReferenceError, DictionaryWriteError, ReferencedError, TaxonomyNotFoundError


def _taxonomy_model(kind: str):
    return {
        "source": m.Source, "category": m.Category,
        "part_of_speech": m.PartOfSpeech, "focus": m.Focus,
        "grammar_affix": m.GrammarAffix,
    }[kind]


def taxonomy_reference_spec(kind: str):
    """(junction_model, fk_field_name, parent_fk_name)。parent_fk_name 是
    junction 表裡「這筆配對屬於哪個父節點」的欄位，合併時用它判斷父節點
    底下是否已經有指向合併目標的配對，藉此避免合併後產生重複配對
    （見 merge_taxonomy_terms 說明）。"""
    return {
        "source": (m.WordSource, "source_id", "word_id"),
        "category": (m.WordExplanationCategory, "category_id", "explanation_id"),
        "part_of_speech": (m.WordExplanationPos, "pos_id", "explanation_id"),
        "focus": (m.WordExplanationFocus, "focus_id", "explanation_id"),
        "grammar_affix": (m.GrammarRuleAffix, "affix_id", "rule_id"),
    }[kind]


def count_taxonomy_references(db: Session, kind: str, term_id) -> int:
    junction_model, fk_field_name, _parent_fk = taxonomy_reference_spec(kind)
    return db.query(junction_model).filter(getattr(junction_model, fk_field_name) == term_id).count()


def create_taxonomy_term(db: Session, kind: str, fields: dict):
    if kind == "grammar_affix":
        tribe_id = fields.get("tribe_id")
        if not db.query(m.Tribe.id).filter(m.Tribe.id == tribe_id).first():
            raise DictionaryWriteError(f"族語不存在：{tribe_id}")
    row = _taxonomy_model(kind)(**fields)
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:
        raise DictionaryWriteError("名稱重複或違反資料限制") from exc
    return row


def update_taxonomy_term(db: Session, kind: str, term_id, fields: dict):
    """刻意不允許更新 grammar_affix 的 tribe_id——已經連結到某個族語規則的
    詞綴如果事後被悄悄換族語，會破壞「詞綴必須跟規則同族語」這個只在
    應用層檢查、資料庫本身不會擋的不變量；真的要改族語，只能刪除
    （沒有引用時）後重新建立。"""
    model = _taxonomy_model(kind)
    row = db.query(model).filter(model.id == term_id).with_for_update().one_or_none()
    if row is None:
        raise TaxonomyNotFoundError(f"主檔項目不存在：{kind}:{term_id}")
    for field, value in fields.items():
        setattr(row, field, value)
    try:
        db.flush()
    except IntegrityError as exc:
        raise DictionaryWriteError("名稱重複或違反資料限制") from exc
    return row


def delete_taxonomy_term(db: Session, kind: str, term_id) -> dict:
    """引用數 > 0 一律擋下，不依賴資料庫的 FK 行為——grammar_affix 底下的
    grammar_rule_affix 是 ondelete=CASCADE（直接刪除會悄悄砍光規則跟這個
    詞綴的關聯），其餘 4 張沒設 ondelete（會讓 Postgres 直接丟錯），兩種
    行為都不是後台該依賴的，一律自己先查再決定（見規劃文件 P4 §4）。"""
    model = _taxonomy_model(kind)
    row = db.query(model).filter(model.id == term_id).with_for_update().one_or_none()
    if row is None:
        raise TaxonomyNotFoundError(f"主檔項目不存在：{kind}:{term_id}")
    ref_count = count_taxonomy_references(db, kind, term_id)
    if ref_count > 0:
        raise ReferencedError(
            f"這筆主檔仍被 {ref_count} 處引用，無法刪除，請改用合併",
            {"references": ref_count},
        )
    snapshot = (
        {"id": row.id, "tribe_id": row.tribe_id, "affix": row.affix, "affix_type": row.affix_type}
        if kind == "grammar_affix" else {"id": row.id, "name": row.name}
    )
    db.delete(row)
    db.flush()
    return snapshot


def merge_taxonomy_terms(db: Session, kind: str, source_id, target_id) -> dict:
    """把 source_id 併入 target_id：來源底下每一筆引用改指向目標，若目標
    在同一個父節點下已經有一筆一樣的配對就直接丟棄來源那筆（避免合併後
    出現「動物、動物」這種重複配對），最後刪掉來源主檔本身。

    用「刪除來源配對、視情況在目標尚未有配對時新增一筆」而非原地把 fk
    欄位改成目標值——grammar_rule_affix 是複合主鍵（rule_id, affix_id），
    affix_id 本身是主鍵的一部分，改用刪除＋新增，代理 id 版（word_source
    等）與複合主鍵版（grammar_rule_affix）junction 表可以共用同一段邏輯，
    不用分兩支寫，也完全不涉及原地修改主鍵欄位。"""
    if source_id == target_id:
        raise DictionaryWriteError("來源與目標不能是同一筆")

    model = _taxonomy_model(kind)
    rows = {
        row.id: row for row in
        db.query(model).filter(model.id.in_([source_id, target_id])).with_for_update().all()
    }
    source_row = rows.get(source_id)
    target_row = rows.get(target_id)
    if source_row is None or target_row is None:
        raise TaxonomyNotFoundError("來源或目標主檔不存在")

    if kind == "grammar_affix" and source_row.tribe_id != target_row.tribe_id:
        raise CrossTribeReferenceError("只能合併同族語的詞綴", [source_id])

    junction_model, fk_field_name, parent_fk_name = taxonomy_reference_spec(kind)
    source_junction_rows = (
        db.query(junction_model).filter(getattr(junction_model, fk_field_name) == source_id).all()
    )
    merged_count = len(source_junction_rows)
    for row in source_junction_rows:
        parent_id = getattr(row, parent_fk_name)
        sort_order = getattr(row, "sort_order", None)
        already_has_target = (
            db.query(junction_model)
            .filter(getattr(junction_model, parent_fk_name) == parent_id,
                    getattr(junction_model, fk_field_name) == target_id)
            .first()
        )
        db.delete(row)
        db.flush()  # 先讓刪除落地，composite PK 的 grammar_rule_affix 不能同時存在
                    # (parent_id, target_id) 的新舊兩筆，才能安全判斷/新增下面這筆
        if not already_has_target:
            new_row = junction_model()
            setattr(new_row, parent_fk_name, parent_id)
            setattr(new_row, fk_field_name, target_id)
            if sort_order is not None:
                new_row.sort_order = sort_order
            db.add(new_row)
    db.flush()

    db.delete(source_row)
    db.flush()

    return {
        "target_id": target_id,
        "merged_references": merged_count,
        "tribe_id": target_row.tribe_id if kind == "grammar_affix" else None,
    }
