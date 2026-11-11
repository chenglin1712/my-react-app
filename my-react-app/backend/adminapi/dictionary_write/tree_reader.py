"""詞條／文法章節的聚合讀取——純唯讀查詢，把資料庫裡分散在多張表的一棵樹
組成單一巢狀 JSON。跟 word_service.py／grammar_service.py 的寫入邏輯分開，
因為 apply_word_tree() 等函式在比對 expected_hash 時也需要呼叫這裡的
get_word_tree()／get_grammar_section_tree()，放進讀取專用模組避免寫入
邏輯反過來被讀取邏輯 import 造成循環。"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from dictionary_db import model as m

from .content_hash import grammar_section_content_hash, word_content_hash
from .exceptions import GrammarSectionNotFoundError, WordNotFoundError


def get_word_tree(db: Session, word_id: str) -> dict:
    """組出單一詞條的完整巢狀 JSON（見規劃文件 P4 §2 的回應形狀）。給後台
    編輯器 GET 用，也給 expected_hash 比對（word_service／wordlist_append）用。

    內部直接用 get_word_trees_for_tribe() 同一份整批查詢實作（_build_word_trees），
    只是詞條清單只有這一筆：兩條路徑共用同一份排序規則與組裝邏輯，內容雜湊不可能
    因為兩份程式的排序鍵不同而算出不同結果（原本維護兩份，註解還記錄過一次這種
    不一致）；查詢次數也固定，不再隨解釋、例句、標註數量逐層增加（N+1）。
    """
    word = db.query(m.Word).filter(m.Word.id == word_id).one_or_none()
    if word is None:
        raise WordNotFoundError(f"詞條不存在：{word_id}")
    return _build_word_trees(db, [word])[word.id]


def get_word_trees_for_tribe(db: Session, tribe_id: str) -> dict:
    """整個族語一次批次組出全部詞條的完整巢狀 JSON——回傳形狀跟
    `get_word_tree()` 對單一詞條的回傳值完全相同（單筆呼叫可以直接互換），
    差別是內部用「整批查、Python 端分組」而非逐筆詞條各自查詢一輪十幾個
    子查詢。給 `export_tribe_bundle()` 這種「整個族語」的匯出情境用——
    實測 `get_word_tree()` 逐筆呼叫組出泰雅語 6,204 筆詞條需要 20 分鐘以上
    （每筆約 210ms，換算成 N+1 查詢對一個大族語完全不現實），這裡套用
    `dictionary_db/word_data.py` 已經驗證過的同一種 bulk 查詢慣例（該檔案
    是唯讀查詢版本，只回傳給前台顯示用的 external_id；這裡需要保留原始
    資料庫 id 供匯出/對帳使用，所以另外實作，不能直接共用那份輸出）。

    回傳 `{word_id: tree}`；呼叫端如果需要特定排序，自行對 word_id 做
    ORDER BY 查詢後依序從這個字典取值，這裡不預設排序。
    """
    words = db.query(m.Word).filter(m.Word.tribe_id == tribe_id).all()
    return _build_word_trees(db, words)


def _build_word_trees(db: Session, words: list) -> dict:
    """給定詞條列（Word ORM 物件），整批查詢並組出 {word_id: 完整巢狀 JSON}。
    get_word_tree()（單筆）與 get_word_trees_for_tribe()（整個族語）共用這一份。"""
    word_ids = [w.id for w in words]
    if not word_ids:
        return {}

    # 以下每個 .order_by() 都在 sort_order 之後加上 .id 當次要排序鍵——
    # sort_order 相同或為 NULL 時，資料庫不保證原本的順序，沒有次要排序鍵的話
    # 同一棵樹可能在不同的執行計畫下排出不同順序，導致 content_hash 不穩定
    # （獨立審查找到的問題）。.id 是遞增主鍵，順序穩定。
    source_ids_by_word = {}
    for row in (
        db.query(m.WordSource).filter(m.WordSource.word_id.in_(word_ids))
        .order_by(m.WordSource.word_id, m.WordSource.sort_order, m.WordSource.id).all()
    ):
        source_ids_by_word.setdefault(row.word_id, []).append(row.source_id)

    audios_by_word = {}
    for a in (
        db.query(m.WordAudio).filter(m.WordAudio.word_id.in_(word_ids))
        .order_by(m.WordAudio.word_id, m.WordAudio.sort_order, m.WordAudio.id).all()
    ):
        audios_by_word.setdefault(a.word_id, []).append(
            {"id": a.id, "external_id": a.external_id, "file_id": a.file_id, "audio_class": a.audio_class}
        )

    explanation_rows = (
        db.query(m.WordExplanation).filter(m.WordExplanation.word_id.in_(word_ids))
        .order_by(m.WordExplanation.word_id, m.WordExplanation.sort_order, m.WordExplanation.id).all()
    )
    exp_ids = [e.id for e in explanation_rows]
    exp_payload_by_id = {}
    exp_ids_by_word = {}
    for e in explanation_rows:
        exp_payload_by_id[e.id] = {
            "id": e.id, "external_id": e.external_id,
            "chinese_explanation": e.chinese_explanation, "english_explanation": e.english_explanation,
            "category_ids": [], "pos_ids": [], "focus_ids": [], "images": [], "sentences": [],
        }
        exp_ids_by_word.setdefault(e.word_id, []).append(e.id)

    sentence_rows = []
    if exp_ids:
        for row in (
            db.query(m.WordExplanationCategory).filter(m.WordExplanationCategory.explanation_id.in_(exp_ids))
            .order_by(m.WordExplanationCategory.explanation_id, m.WordExplanationCategory.id).all()
        ):
            exp_payload_by_id[row.explanation_id]["category_ids"].append(row.category_id)
        for row in (
            db.query(m.WordExplanationPos).filter(m.WordExplanationPos.explanation_id.in_(exp_ids))
            .order_by(m.WordExplanationPos.explanation_id, m.WordExplanationPos.id).all()
        ):
            exp_payload_by_id[row.explanation_id]["pos_ids"].append(row.pos_id)
        for row in (
            db.query(m.WordExplanationFocus).filter(m.WordExplanationFocus.explanation_id.in_(exp_ids))
            .order_by(m.WordExplanationFocus.explanation_id, m.WordExplanationFocus.id).all()
        ):
            exp_payload_by_id[row.explanation_id]["focus_ids"].append(row.focus_id)
        for img in (
            db.query(m.WordExplanationImage).filter(m.WordExplanationImage.explanation_id.in_(exp_ids))
            .order_by(m.WordExplanationImage.explanation_id, m.WordExplanationImage.sort_order, m.WordExplanationImage.id).all()
        ):
            exp_payload_by_id[img.explanation_id]["images"].append({"id": img.id, "image_url": img.image_url})

        sentence_rows = (
            db.query(m.WordExplanationSentence).filter(m.WordExplanationSentence.explanation_id.in_(exp_ids))
            .order_by(m.WordExplanationSentence.explanation_id, m.WordExplanationSentence.sort_order, m.WordExplanationSentence.id).all()
        )

    sent_ids = [s.id for s in sentence_rows]
    sent_payload_by_id = {}
    for s in sentence_rows:
        payload = {
            "id": s.id, "external_id": s.external_id,
            "original_sentence": s.original_sentence,
            "chinese_sentence": s.chinese_sentence, "english_sentence": s.english_sentence,
            "audios": [], "anaphoras": [],
        }
        sent_payload_by_id[s.id] = payload
        exp_payload_by_id[s.explanation_id]["sentences"].append(payload)

    anaphora_rows = []
    if sent_ids:
        for a in (
            db.query(m.WordExplanationSentenceAudio).filter(m.WordExplanationSentenceAudio.sentence_id.in_(sent_ids))
            .order_by(
                m.WordExplanationSentenceAudio.sentence_id,
                m.WordExplanationSentenceAudio.sort_order,
                m.WordExplanationSentenceAudio.id,
            ).all()
        ):
            sent_payload_by_id[a.sentence_id]["audios"].append(
                {"id": a.id, "external_id": a.external_id, "file_id": a.file_id, "audio_class": a.audio_class}
            )

        anaphora_rows = (
            db.query(m.WordExplanationAnaphora).filter(m.WordExplanationAnaphora.sentence_id.in_(sent_ids))
            .order_by(
                m.WordExplanationAnaphora.sentence_id,
                m.WordExplanationAnaphora.sort_order,
                m.WordExplanationAnaphora.id,
            ).all()
        )

    ana_ids = [a.id for a in anaphora_rows]
    ana_payload_by_id = {}
    for ana in anaphora_rows:
        payload = {
            "id": ana.id, "is_highlight": bool(ana.is_highlight), "is_symbol": bool(ana.is_symbol),
            "items": [],
        }
        ana_payload_by_id[ana.id] = payload
        sent_payload_by_id[ana.sentence_id]["anaphoras"].append(payload)

    item_rows = []
    if ana_ids:
        item_rows = (
            db.query(m.WordExplanationAnaphoraItem).filter(m.WordExplanationAnaphoraItem.anaphora_id.in_(ana_ids))
            .order_by(
                m.WordExplanationAnaphoraItem.anaphora_id,
                m.WordExplanationAnaphoraItem.sort_order,
                m.WordExplanationAnaphoraItem.id,
            ).all()
        )

    linked_word_ids = list({i.word_id for i in item_rows if i.word_id})
    name_map = {}
    if linked_word_ids:
        name_map = {
            w.id: w.name for w in db.query(m.Word.id, m.Word.name).filter(m.Word.id.in_(linked_word_ids)).all()
        }
    for item in item_rows:
        ana_payload_by_id[item.anaphora_id]["items"].append({
            "id": item.id, "word_id": item.word_id, "name": item.name,
            "word_name": name_map.get(item.word_id) if item.word_id else None,
        })

    anaphora_item_ref_counts = dict(
        db.query(m.WordExplanationAnaphoraItem.word_id, func.count(m.WordExplanationAnaphoraItem.id))
        .filter(m.WordExplanationAnaphoraItem.word_id.in_(word_ids))
        .group_by(m.WordExplanationAnaphoraItem.word_id).all()
    )
    grammar_example_ref_counts = dict(
        db.query(m.GrammarExampleWord.word_id, func.count(m.GrammarExampleWord.word_id))
        .filter(m.GrammarExampleWord.word_id.in_(word_ids))
        .group_by(m.GrammarExampleWord.word_id).all()
    )

    trees = {}
    for word in words:
        tree = {
            "id": word.id, "tribe_id": word.tribe_id,
            "dialect": word.dialect or "", "name": word.name or "", "pinyin": word.pinyin or "",
            "variant": word.variant or "", "formation_word": word.formation_word or "",
            "derivative_root": word.derivative_root or "",
            "frequency": word.frequency or 0, "hit": word.hit or 0,
            "dictionary_note": word.dictionary_note or "", "word_img": word.word_img or "",
            "is_derivative_root": bool(word.is_derivative_root), "is_image": bool(word.is_image),
            "is_zuzucidian": bool(word.is_zuzucidian), "is_other_dialect": bool(word.is_other_dialect),
            "source_ids": source_ids_by_word.get(word.id, []),
            "audios": audios_by_word.get(word.id, []),
            "explanations": [exp_payload_by_id[eid] for eid in exp_ids_by_word.get(word.id, [])],
        }
        tree["content_hash"] = word_content_hash(tree)
        tree["meta"] = {
            "referenced_by_anaphora_items": anaphora_item_ref_counts.get(word.id, 0),
            "referenced_by_grammar_examples": grammar_example_ref_counts.get(word.id, 0),
        }
        trees[word.id] = tree

    return trees


_IN_CHUNK = 500   # SQLite 舊版單一查詢的參數上限是 999，IN 清單分批查


def _chunks(values, size=_IN_CHUNK):
    values = list(values)
    for i in range(0, len(values), size):
        yield values[i:i + size]


def get_grammar_section_tree(db: Session, section_id) -> dict:
    section = db.query(m.GrammarSection).filter(m.GrammarSection.id == section_id).one_or_none()
    if section is None:
        raise GrammarSectionNotFoundError(f"文法章節不存在：{section_id}")

    rules = []
    rule_rows = (
        db.query(m.GrammarRule)
        .filter(m.GrammarRule.section_id == section_id)
        .order_by(m.GrammarRule.rule_order)
        .all()
    )
    # 規則的詞綴、例句、例句連結的詞、詞名各一次查詢（再依規則／例句分組），
    # 原本每個規則、每個例句都各查一次（1 + 規則數 + 例句數 × 2 次往返）。
    rule_ids = [rule.id for rule in rule_rows]
    affix_ids_by_rule = {}
    example_rows_by_rule = {}
    word_ids_by_example = {}
    name_map = {}
    if rule_ids:
        all_examples = []
        for chunk in _chunks(rule_ids):
            for link in db.query(m.GrammarRuleAffix).filter(m.GrammarRuleAffix.rule_id.in_(chunk)).all():
                affix_ids_by_rule.setdefault(link.rule_id, []).append(link.affix_id)
            all_examples.extend(
                db.query(m.GrammarExample)
                .filter(m.GrammarExample.rule_id.in_(chunk))
                .order_by(m.GrammarExample.example_order, m.GrammarExample.id)
                .all()
            )
        # 分批查回後，依（規則內）例句順序重排，與單一查詢的排序一致
        all_examples.sort(key=lambda ex: (ex.example_order if ex.example_order is not None else -1, ex.id))
        for example in all_examples:
            example_rows_by_rule.setdefault(example.rule_id, []).append(example)
        if all_examples:
            example_ids = [example.id for example in all_examples]
            for chunk in _chunks(example_ids):
                for link in db.query(m.GrammarExampleWord).filter(m.GrammarExampleWord.example_id.in_(chunk)).all():
                    word_ids_by_example.setdefault(link.example_id, []).append(link.word_id)
            every_word_id = {wid for ids in word_ids_by_example.values() for wid in ids}
            for chunk in _chunks(every_word_id):
                name_map.update({
                    w.id: w.name for w in
                    db.query(m.Word.id, m.Word.name).filter(m.Word.id.in_(chunk)).all()
                })

    for rule in rule_rows:
        affix_ids = affix_ids_by_rule.get(rule.id, [])

        examples = []
        for example in example_rows_by_rule.get(rule.id, []):
            word_ids = word_ids_by_example.get(example.id, [])
            examples.append({
                "id": example.id, "tribe_text": example.tribe_text or "",
                "chinese_text": example.chinese_text or "", "analysis": example.analysis or "",
                "linked_words": [
                    {"word_id": wid, "word_name": name_map.get(wid)} for wid in word_ids
                ],
            })

        rules.append({
            "id": rule.id, "rule_key": rule.rule_key or "", "title": rule.title or "",
            "structure": rule.structure or "", "function": rule.function or "", "notes": rule.notes or "",
            "affix_ids": affix_ids, "examples": examples,
        })

    tree = {
        "id": section.id, "tribe_id": section.tribe_id, "section_key": section.section_key or "",
        "title": section.title or "", "description": section.description or "",
        "rules": rules,
    }
    tree["content_hash"] = grammar_section_content_hash(tree)
    tree["meta"] = {"section_order": section.section_order}
    return tree
