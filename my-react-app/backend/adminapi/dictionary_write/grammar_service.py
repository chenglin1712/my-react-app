"""文法章節聚合讀寫（P4.3）：跟詞條同一套「整個節點當一個聚合單位」設計
（見規劃文件 P4 §3），聚合單位是「一個 grammar_section」，不是整個族語的
全部章節——章節數量本身（每族語約 9 個）用另一支扁平列表端點查詢。
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from dictionary_db import model as m

from .content_hash import grammar_section_content_hash
from .exceptions import ConcurrentModificationError, CrossTribeReferenceError, DictionaryWriteError, GrammarSectionNotFoundError
from .tree_reader import get_grammar_section_tree
from .tree_reconcile import _reconcile_children, _sync_id_junction, _validate_same_tribe_word_ids

_GRAMMAR_SECTION_SCALAR_FIELDS = ("section_key", "title", "description")


def _validate_same_tribe_affix_ids(db: Session, tribe_id, affix_ids):
    """文法規則連結的詞綴（grammar_rule_affix.affix_id）必須跟規則所屬的
    章節同族語——資料庫本身不會擋這件事（見規劃文件 P4 §3），只能在應用層查。"""
    affix_ids = {a for a in affix_ids if a}
    if not affix_ids:
        return
    rows = db.query(m.GrammarAffix.id, m.GrammarAffix.tribe_id).filter(m.GrammarAffix.id.in_(affix_ids)).all()
    found = {row.id: row.tribe_id for row in rows}
    missing = affix_ids - set(found)
    if missing:
        raise DictionaryWriteError(f"詞綴不存在：{sorted(missing)}")
    wrong_tribe = [aid for aid, tid in found.items() if tid != tribe_id]
    if wrong_tribe:
        raise CrossTribeReferenceError(f"詞綴跨族語連結：{sorted(wrong_tribe)}", wrong_tribe)


def apply_grammar_section(db: Session, payload: dict, section_id=None, expected_hash: str | None = None) -> int:
    """建立或更新一整棵文法章節樹。section_id=None 代表新建——新章節排在
    該族語目前章節的最後面（`section_order` 不接受 payload 帶值，章節本身
    的排序只能透過 reorder_grammar_sections() 直接調整，見規劃文件 P4 §3
    「拖曳排序章節本身是直接寫入不經送審」）。回傳套用後的 section id。

    expected_hash：跟 word_service.apply_word_tree() 同一種「拿到列鎖之後
    重新比對」的併發保護，見該函式的說明。"""
    tribe_id = payload.get("tribe_id")
    if not tribe_id:
        raise DictionaryWriteError("tribe_id 為必填")
    if not db.query(m.Tribe.id).filter(m.Tribe.id == tribe_id).first():
        raise DictionaryWriteError(f"族語不存在：{tribe_id}")

    if section_id is None:
        max_order = (
            db.query(func.max(m.GrammarSection.section_order))
            .filter(m.GrammarSection.tribe_id == tribe_id).scalar()
        )
        section = m.GrammarSection(tribe_id=tribe_id, section_order=(max_order or 0) + 1)
        db.add(section)
    else:
        section = (
            db.query(m.GrammarSection).filter(m.GrammarSection.id == section_id)
            .with_for_update().one_or_none()
        )
        if section is None:
            raise GrammarSectionNotFoundError(f"文法章節不存在：{section_id}")
        if expected_hash:
            current_hash = grammar_section_content_hash(get_grammar_section_tree(db, section_id))
            if current_hash != expected_hash:
                raise ConcurrentModificationError(f"文法章節內容在鎖定前已經被其他人變更：{section_id}")
        section.tribe_id = tribe_id

    for field in _GRAMMAR_SECTION_SCALAR_FIELDS:
        if field in payload:
            setattr(section, field, payload.get(field))
    db.flush()  # 確保新建時 section.id 已確定，後面的子表才能引用

    rule_pairs = _reconcile_children(
        db, m.GrammarRule, "section_id", section.id, payload.get("rules", []),
        scalar_fields=("rule_key", "title", "structure", "function", "notes"),
        order_field="rule_order",
    )
    for rule_row, rule_item in rule_pairs:
        affix_ids = rule_item.get("affix_ids", [])
        _validate_same_tribe_affix_ids(db, tribe_id, affix_ids)
        _sync_id_junction(db, m.GrammarRuleAffix, "rule_id", rule_row.id, "affix_id", affix_ids)

        example_pairs = _reconcile_children(
            db, m.GrammarExample, "rule_id", rule_row.id, rule_item.get("examples", []),
            scalar_fields=("tribe_text", "chinese_text", "analysis"),
            order_field="example_order",
        )
        for example_row, example_item in example_pairs:
            word_ids = [
                link.get("word_id") for link in example_item.get("linked_words", []) if link.get("word_id")
            ]
            _validate_same_tribe_word_ids(db, tribe_id, word_ids, label="例句連結的詞彙")
            _sync_id_junction(db, m.GrammarExampleWord, "example_id", example_row.id, "word_id", word_ids)

    db.flush()
    return section.id


def delete_grammar_section(db: Session, section_id, expected_hash: str | None = None) -> dict:
    """刪除一整棵文法章節樹。沒有其他資源會參照一個章節本身（規則/例句底下
    連結的詞綴/詞彙是章節「引用別人」，不是「被別人引用」），不需要像詞條
    刪除那樣先查引用數擋下。

    expected_hash：跟 word_service.apply_word_tree() 同一種「拿到列鎖之後
    重新比對」的併發保護，見該函式的說明。"""
    section = (
        db.query(m.GrammarSection).filter(m.GrammarSection.id == section_id)
        .with_for_update().one_or_none()
    )
    if section is None:
        raise GrammarSectionNotFoundError(f"文法章節不存在：{section_id}")
    if expected_hash:
        current_hash = grammar_section_content_hash(get_grammar_section_tree(db, section_id))
        if current_hash != expected_hash:
            raise ConcurrentModificationError(f"文法章節內容在鎖定前已經被其他人變更：{section_id}")
    db.delete(section)  # 其餘子樹（grammar_rule→grammar_example→...）靠 ondelete=CASCADE
    db.flush()
    return {"id": section_id}


def reorder_grammar_sections(db: Session, tribe_id: str, ordered_ids: list) -> None:
    """章節排序直接寫入、不經送審（見規劃文件 P4 §3）——調整順序不改變
    任何規則/例句內容，繞送審流程沒有安全效益，比照 IrtConfig 直接寫入的
    先例。ordered_ids 必須恰好等於該族語目前的章節集合，不接受部分排序
    （半套用一份不完整的排序會讓沒被提到的章節 section_order 維持舊值，
    可能跟新排序的其他章節撞號）。"""
    sections = (
        db.query(m.GrammarSection).filter(m.GrammarSection.tribe_id == tribe_id)
        .with_for_update().all()
    )
    by_id = {s.id: s for s in sections}
    # 同時檢查「集合相同」與「長度相同」——只檢查集合相同的話，一份帶重複
    # id 的清單只要湊巧覆蓋到全部既有 id，set() 去重後仍會判斷成「相同」，
    # 讓後面用陣列位置覆寫 section_order 的迴圈裡，重複出現的 id 用最後一次
    # 出現的位置覆蓋掉前面的結果，其餘章節的順序也會被打散，卻完全不會回報
    # 任何錯誤。
    if len(ordered_ids) != len(by_id) or set(ordered_ids) != set(by_id):
        raise DictionaryWriteError("排序清單跟目前的章節集合不一致")
    for index, sid in enumerate(ordered_ids):
        by_id[sid].section_order = index
    db.flush()
