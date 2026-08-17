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
    編輯器 GET 用；資料量以「單一詞條」為界，本機最極端的詞條（9 解釋／
    129 例句／1,265 標註項目）仍在合理範圍內，不需要另外分頁或延遲載入。
    """
    word = db.query(m.Word).filter(m.Word.id == word_id).one_or_none()
    if word is None:
        raise WordNotFoundError(f"詞條不存在：{word_id}")

    # 以下每個 .order_by() 都在 sort_order 之後加上 .id 當次要排序鍵——
    # sort_order 相同或為 NULL 時，資料庫不保證原本的順序，單筆查詢跟批次
    # 查詢（get_word_trees_for_tribe）可能因為執行計畫不同而排出不同順序，
    # 導致同一棵樹在兩個查詢路徑算出不同的 content_hash（獨立審查找到的
    # 問題）。.id 是遞增主鍵，順序穩定且跟兩個函式共用同一份排序規則。
    source_ids = [
        row.source_id for row in
        db.query(m.WordSource).filter(m.WordSource.word_id == word_id)
        .order_by(m.WordSource.sort_order, m.WordSource.id).all()
    ]
    audios = [
        {"id": a.id, "external_id": a.external_id, "file_id": a.file_id, "audio_class": a.audio_class}
        for a in db.query(m.WordAudio).filter(m.WordAudio.word_id == word_id)
        .order_by(m.WordAudio.sort_order, m.WordAudio.id).all()
    ]

    explanations = []
    explanation_rows = (
        db.query(m.WordExplanation)
        .filter(m.WordExplanation.word_id == word_id)
        .order_by(m.WordExplanation.sort_order, m.WordExplanation.id)
        .all()
    )
    for exp in explanation_rows:
        category_ids = [r.category_id for r in db.query(m.WordExplanationCategory)
                         .filter(m.WordExplanationCategory.explanation_id == exp.id)
                         .order_by(m.WordExplanationCategory.id).all()]
        pos_ids = [r.pos_id for r in db.query(m.WordExplanationPos)
                   .filter(m.WordExplanationPos.explanation_id == exp.id)
                   .order_by(m.WordExplanationPos.id).all()]
        focus_ids = [r.focus_id for r in db.query(m.WordExplanationFocus)
                     .filter(m.WordExplanationFocus.explanation_id == exp.id)
                     .order_by(m.WordExplanationFocus.id).all()]
        images = [
            {"id": img.id, "image_url": img.image_url}
            for img in db.query(m.WordExplanationImage)
            .filter(m.WordExplanationImage.explanation_id == exp.id)
            .order_by(m.WordExplanationImage.sort_order, m.WordExplanationImage.id).all()
        ]

        sentences = []
        sentence_rows = (
            db.query(m.WordExplanationSentence)
            .filter(m.WordExplanationSentence.explanation_id == exp.id)
            .order_by(m.WordExplanationSentence.sort_order, m.WordExplanationSentence.id)
            .all()
        )
        for sent in sentence_rows:
            sent_audios = [
                {"id": a.id, "external_id": a.external_id, "file_id": a.file_id, "audio_class": a.audio_class}
                for a in db.query(m.WordExplanationSentenceAudio)
                .filter(m.WordExplanationSentenceAudio.sentence_id == sent.id)
                .order_by(m.WordExplanationSentenceAudio.sort_order, m.WordExplanationSentenceAudio.id).all()
            ]

            anaphoras = []
            anaphora_rows = (
                db.query(m.WordExplanationAnaphora)
                .filter(m.WordExplanationAnaphora.sentence_id == sent.id)
                .order_by(m.WordExplanationAnaphora.sort_order, m.WordExplanationAnaphora.id)
                .all()
            )
            for ana in anaphora_rows:
                item_rows = (
                    db.query(m.WordExplanationAnaphoraItem)
                    .filter(m.WordExplanationAnaphoraItem.anaphora_id == ana.id)
                    .order_by(m.WordExplanationAnaphoraItem.sort_order, m.WordExplanationAnaphoraItem.id)
                    .all()
                )
                linked_ids = [i.word_id for i in item_rows if i.word_id]
                name_map = {}
                if linked_ids:
                    name_map = {
                        w.id: w.name for w in
                        db.query(m.Word.id, m.Word.name).filter(m.Word.id.in_(linked_ids)).all()
                    }
                anaphoras.append({
                    "id": ana.id, "is_highlight": bool(ana.is_highlight), "is_symbol": bool(ana.is_symbol),
                    "items": [
                        {
                            "id": item.id, "word_id": item.word_id, "name": item.name,
                            "word_name": name_map.get(item.word_id) if item.word_id else None,
                        }
                        for item in item_rows
                    ],
                })

            sentences.append({
                "id": sent.id, "external_id": sent.external_id,
                "original_sentence": sent.original_sentence,
                "chinese_sentence": sent.chinese_sentence, "english_sentence": sent.english_sentence,
                "audios": sent_audios, "anaphoras": anaphoras,
            })

        explanations.append({
            "id": exp.id, "external_id": exp.external_id,
            "chinese_explanation": exp.chinese_explanation, "english_explanation": exp.english_explanation,
            "category_ids": category_ids, "pos_ids": pos_ids, "focus_ids": focus_ids,
            "images": images, "sentences": sentences,
        })

    anaphora_item_refs = (
        db.query(m.WordExplanationAnaphoraItem)
        .filter(m.WordExplanationAnaphoraItem.word_id == word_id).count()
    )
    grammar_example_refs = (
        db.query(m.GrammarExampleWord)
        .filter(m.GrammarExampleWord.word_id == word_id).count()
    )

    tree = {
        "id": word.id, "tribe_id": word.tribe_id,
        "dialect": word.dialect or "", "name": word.name or "", "pinyin": word.pinyin or "",
        "variant": word.variant or "", "formation_word": word.formation_word or "",
        "derivative_root": word.derivative_root or "",
        "frequency": word.frequency or 0, "hit": word.hit or 0,
        "dictionary_note": word.dictionary_note or "", "word_img": word.word_img or "",
        "is_derivative_root": bool(word.is_derivative_root), "is_image": bool(word.is_image),
        "is_zuzucidian": bool(word.is_zuzucidian), "is_other_dialect": bool(word.is_other_dialect),
        "source_ids": source_ids, "audios": audios, "explanations": explanations,
    }
    tree["content_hash"] = word_content_hash(tree)
    tree["meta"] = {
        "referenced_by_anaphora_items": anaphora_item_refs,
        "referenced_by_grammar_examples": grammar_example_refs,
    }
    return tree


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
    word_ids = [w.id for w in words]
    if not word_ids:
        return {}

    # 跟 get_word_tree()（單筆版本）用同一份「sort_order 之後加 .id」排序
    # 規則——理由見該函式對應段落的說明。
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
    for rule in rule_rows:
        affix_ids = [
            r.affix_id for r in
            db.query(m.GrammarRuleAffix).filter(m.GrammarRuleAffix.rule_id == rule.id).all()
        ]

        examples = []
        example_rows = (
            db.query(m.GrammarExample)
            .filter(m.GrammarExample.rule_id == rule.id)
            .order_by(m.GrammarExample.example_order)
            .all()
        )
        for example in example_rows:
            word_ids = [
                w.word_id for w in
                db.query(m.GrammarExampleWord).filter(m.GrammarExampleWord.example_id == example.id).all()
            ]
            name_map = {}
            if word_ids:
                name_map = {
                    w.id: w.name for w in
                    db.query(m.Word.id, m.Word.name).filter(m.Word.id.in_(word_ids)).all()
                }
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
