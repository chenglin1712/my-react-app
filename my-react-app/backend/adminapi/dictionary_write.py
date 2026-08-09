"""P4 辭典管理：對 dictionary_db（SQLAlchemy 直連）的實際讀寫邏輯。

跟 Announcement／題庫類內容完全不同的地方：辭典資料不是 Django ORM model，
沒有 transaction.atomic()／select_for_update()／full_clean() 可用。這裡的
函式全部吃一個已經在 dictionary_write_session()（見 dictionary_db/connect.py）
context 裡的 SQLAlchemy Session，呼叫端負責交易邊界。

核心設計是「整個詞條當一個聚合單位讀寫」（見規劃文件 P4 §2）：一次 GET
回傳整棵樹（詞條→解釋→例句→音檔/圖片/標註），一次寫入用「對帳」而非
「先刪全部再整個重建」的方式套用整棵樹——對帳保留沒變動的子節點的
資料庫 id，讓 AuditLog 的 before/after diff 有意義，也讓前端存檔後不需要
整個重新拉一次才能繼續編輯。

`sort_order` 永遠不接受前端送來的值——一律用陣列位置覆寫。這是刻意的
設計（呼應 QuizBank.jsx `blanks` 物件用字串 key 兼職順序/身分/內容標記
三種角色、刪除中間項會產生 key 衝突的已知脆弱點）：把「順序」跟「身分」
兩件事徹底分開，順序永遠是陣列位置的單一事實來源。
"""
import hashlib
import json
import uuid

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from dictionary_db import model as m


class DictionaryWriteError(Exception):
    """呼叫端可以攔截的、跟業務邏輯有關的錯誤（word 不存在、跨族語參照等），
    區別於未預期的例外——views.py 攔截這個型別轉成 400/404/409，其餘例外
    讓 dictionary_write_session() 的 rollback 接手、往外拋成 500。"""


class WordNotFoundError(DictionaryWriteError):
    pass


class CrossTribeReferenceError(DictionaryWriteError):
    def __init__(self, message, invalid_ids):
        super().__init__(message)
        self.invalid_ids = invalid_ids


class ReferencedError(DictionaryWriteError):
    """刪除操作被引用計數擋下——呼叫端轉成 409 附上引用數與樣本。"""

    def __init__(self, message, counts):
        super().__init__(message)
        self.counts = counts


class TaxonomyNotFoundError(DictionaryWriteError):
    pass


class GrammarSectionNotFoundError(DictionaryWriteError):
    pass


class ConcurrentModificationError(DictionaryWriteError):
    """expected_hash 在拿到列鎖之後重新比對仍然不一致——呼叫端（核准流程）
    轉成 409，見 apply_word_tree()/apply_grammar_section() 的說明。"""


# ---------------------------------------------------------------------------
# 對帳共用工具
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# 詞條聚合讀取
# ---------------------------------------------------------------------------

_WORD_SCALAR_FIELDS = (
    "dialect", "name", "pinyin", "variant", "formation_word", "derivative_root",
    "frequency", "dictionary_note", "word_img",
    "is_derivative_root", "is_image", "is_zuzucidian", "is_other_dialect",
)


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


def _tree_content_hash(tree: dict) -> str:
    """整棵樹的內容雜湊，忽略 content_hash／meta 這兩個「衍生欄位」本身，
    避免雜湊值影響雜湊值。用 sha256 而非 Python 內建 hash()——後者每次
    process 重啟 seed 都不同，不能拿來跨請求比對。詞條樹跟文法章節樹共用
    同一支雜湊函式，形狀（dict 去掉衍生欄位後序列化）完全一樣。"""
    payload = {k: v for k, v in tree.items() if k not in ("content_hash", "meta")}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def word_content_hash(tree: dict) -> str:
    return _tree_content_hash(tree)


def grammar_section_content_hash(tree: dict) -> str:
    return _tree_content_hash(tree)


# ---------------------------------------------------------------------------
# 詞條聚合寫入
# ---------------------------------------------------------------------------

def _validate_taxonomy_ids(db: Session, model, ids, label):
    if not ids:
        return
    found = {row.id for row in db.query(model.id).filter(model.id.in_(set(ids))).all()}
    missing = set(ids) - found
    if missing:
        raise DictionaryWriteError(f"{label} 不存在：{sorted(missing)}")


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


def apply_word_tree(db: Session, payload: dict, word_id: str | None = None, expected_hash: str | None = None) -> str:
    """建立或更新一整棵詞條樹。word_id=None 代表新建（忽略 payload 裡任何
    id 值，一律指派新 UUID）；否則對既有詞條做對帳式更新。呼叫端負責交易
    邊界（見 dictionary_write_session()）——這個函式只呼叫 db.add/flush/
    delete，不 commit。

    expected_hash：核准流程在拿到列鎖（`with_for_update()`）之後，於同一個
    寫入交易內重新算一次目前內容的雜湊並比對——單靠核准端點在交易外先讀一次
    雜湊、關閉那個讀取 session、之後才另外開交易寫入，中間有一段沒有任何
    鎖保護的空窗：另一筆提案或批次匯入的套用可能剛好夾在這段空窗內把同一筆
    詞條改掉，先讀到的雜湊早就過期了卻不會被發現（見規劃文件 P4 §1 codex
    獨立審查發現的併發缺口）。呼叫端在交易外的比對只是「省一次不必要的
    鎖定寫入」的快速路徑，這裡拿到鎖之後的重新比對才是真正的正確性保證。

    回傳套用後的 word_id，讓呼叫端（尤其是核准新建提案時）知道剛剛寫入的
    是哪一筆。
    """
    tribe_id = payload.get("tribe_id")
    if not tribe_id:
        raise DictionaryWriteError("tribe_id 為必填")
    if not db.query(m.Tribe.id).filter(m.Tribe.id == tribe_id).first():
        raise DictionaryWriteError(f"族語不存在：{tribe_id}")

    if word_id is None:
        word = m.Word(id=str(uuid.uuid4()), tribe_id=tribe_id)
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


# ---------------------------------------------------------------------------
# 文法章節聚合讀寫（P4.3）：跟詞條同一套「整個節點當一個聚合單位」設計
# （見規劃文件 P4 §3），聚合單位是「一個 grammar_section」，不是整個族語的
# 全部章節——章節數量本身（每族語約 9 個）用另一支扁平列表端點查詢。
# ---------------------------------------------------------------------------

_GRAMMAR_SECTION_SCALAR_FIELDS = ("section_key", "title", "description")


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


def apply_grammar_section(db: Session, payload: dict, section_id=None, expected_hash: str | None = None) -> int:
    """建立或更新一整棵文法章節樹。section_id=None 代表新建——新章節排在
    該族語目前章節的最後面（`section_order` 不接受 payload 帶值，章節本身
    的排序只能透過 reorder_grammar_sections() 直接調整，見規劃文件 P4 §3
    「拖曳排序章節本身是直接寫入不經送審」）。回傳套用後的 section id。

    expected_hash：跟 apply_word_tree() 同一種「拿到列鎖之後重新比對」的
    併發保護，見該函式的說明。"""
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

    expected_hash：跟 apply_word_tree() 同一種「拿到列鎖之後重新比對」的
    併發保護，見該函式的說明。"""
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


# ---------------------------------------------------------------------------
# 主檔管理（P4.2）：source／category／part_of_speech／focus／grammar_affix
# 共用同一套 CRUD＋合併邏輯。tribe（族語本身）刻意不在這裡——見
# dictionary_taxonomy_views.py 開頭說明，5 筆的 UUID 寫死在 config/tribes.py，
# 不是後台可以新增/刪除/合併的東西。
# ---------------------------------------------------------------------------

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
