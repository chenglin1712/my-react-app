"""把詞條樹轉回匯入 bundle 的格式（跟匯入完全同一份 schema——「匯出 →
手動編輯 → 重新匯入」可以互相驗證，也是測試資料的來源，見規劃文件 P4 §5）。
"""
from sqlalchemy.orm import Session

from dictionary_db import model as m

from .bundle_schema import _TAXONOMY_MODEL_BY_KIND


def _tree_to_bundle_entry(tree: dict, name_by_id: dict) -> dict:
    return {
        "id": tree["id"], "dialect": tree["dialect"], "name": tree["name"], "pinyin": tree["pinyin"],
        "variant": tree["variant"], "formation_word": tree["formation_word"],
        "derivative_root": tree["derivative_root"], "frequency": tree["frequency"],
        "dictionary_note": tree["dictionary_note"], "word_img": tree["word_img"],
        "is_derivative_root": tree["is_derivative_root"], "is_image": tree["is_image"],
        "is_zuzucidian": tree["is_zuzucidian"], "is_other_dialect": tree["is_other_dialect"],
        "source_names": [name_by_id["source"].get(sid, "") for sid in tree["source_ids"]],
        "audios": [
            {"id": a["id"], "external_id": a["external_id"], "file_id": a["file_id"], "audio_class": a["audio_class"]}
            for a in tree["audios"]
        ],
        "explanations": [
            {
                "id": exp["id"], "external_id": exp["external_id"],
                "chinese_explanation": exp["chinese_explanation"], "english_explanation": exp["english_explanation"],
                "category_names": [name_by_id["category"].get(cid, "") for cid in exp["category_ids"]],
                "pos_names": [name_by_id["part_of_speech"].get(pid, "") for pid in exp["pos_ids"]],
                "focus_names": [name_by_id["focus"].get(fid, "") for fid in exp["focus_ids"]],
                "images": [{"id": img["id"], "image_url": img["image_url"]} for img in exp["images"]],
                "sentences": [
                    {
                        "id": sent["id"], "external_id": sent["external_id"],
                        "original_sentence": sent["original_sentence"],
                        "chinese_sentence": sent["chinese_sentence"], "english_sentence": sent["english_sentence"],
                        "audios": [
                            {
                                "id": a["id"], "external_id": a["external_id"],
                                "file_id": a["file_id"], "audio_class": a["audio_class"],
                            }
                            for a in sent["audios"]
                        ],
                        "anaphoras": [
                            {
                                "id": ana["id"], "is_highlight": ana["is_highlight"], "is_symbol": ana["is_symbol"],
                                "items": [
                                    {
                                        "id": item["id"], "word_name": item["word_name"] or "",
                                        "name": item["name"] or "",
                                    }
                                    for item in ana["items"]
                                ],
                            }
                            for ana in sent["anaphoras"]
                        ],
                    }
                    for sent in exp["sentences"]
                ],
            }
            for exp in tree["explanations"]
        ],
    }


def export_tribe_bundle(db: Session, tribe_id: str, tribe_slug: str) -> dict:
    """匯出一個族語目前全部詞條，格式跟匯入完全同一份 schema——「匯出 →
    手動編輯 → 重新匯入」可以互相驗證，也是測試資料的來源（見規劃文件
    P4 §5）。用 dictionary_write.get_word_trees_for_tribe() 整批組裝、
    再把 id 陣列轉回名稱陣列——原本逐筆呼叫 get_word_tree() 對一個大族語
    （例如泰雅語 6,204 筆）實測需要 20 分鐘以上，改成整批查詢後降到數秒。
    """
    from .. import dictionary_write as dw

    word_ids = [row.id for row in db.query(m.Word.id).filter(m.Word.tribe_id == tribe_id).order_by(m.Word.name).all()]

    name_by_id = {}
    for kind, model in _TAXONOMY_MODEL_BY_KIND.items():
        name_by_id[kind] = {row.id: row.name for row in db.query(model.id, model.name).all()}

    trees_by_id = dw.get_word_trees_for_tribe(db, tribe_id)
    words = [_tree_to_bundle_entry(trees_by_id[word_id], name_by_id) for word_id in word_ids]

    return {"schema": "dictionary_word_bundle", "version": 1, "tribe": tribe_slug, "words": words}
