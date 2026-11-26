"""P4.4 批次匯入精靈：把一份 bundle（schema: "dictionary_word_bundle"，見
dictionary_serializers.validate_import_bundle_structure 的說明）解析成
dictionary_write.apply_word_tree() 已經認得的 payload——分類主檔用名稱、
標註連結用 word_name，這裡的核心工作就是「把這些名稱解析成 id」，解析完
之後完全交給既有函式寫入，不重新發明一套寫入邏輯。

這個檔案裡的函式全部是唯讀查詢（`resolve_import_bundle`）或單純的 dict
轉換（`import_report_hash`），只有 `create_missing_taxonomies` 會寫入，
且刻意獨立成一個函式，讓呼叫端自己決定要不要在套用之前先跑一次
（owner-only 選項，見規劃文件 P4 §5）。
"""
import hashlib
import json

from sqlalchemy.orm import Session

from dictionary_db import model as m

from .bundle_schema import _TAXONOMY_MODEL_BY_KIND


def row_structure_errors(words):
    """逐列做結構檢查（稽核 BE2b-01）：上傳時只回報不擋，預檢與核准也必須沿用，否則結構不合法的列
    （例如 explanations 不是陣列）會一路被寫進辭典。回傳 {row_index: [錯誤訊息]}。"""
    from ..dictionary_serializers import validate_word_bundle_entry

    result = {}
    for index, word in enumerate(words):
        if not isinstance(word, dict):
            result[index] = ["這一列不是詞條物件"]
            continue
        _cleaned, errors = validate_word_bundle_entry(word)
        if errors:
            result[index] = [f"{field}：{message}" for field, message in errors.items()]
    return result


def structurally_valid_words(words):
    """只留結構合法的列，給建立缺漏主檔等不需要逐列報告的函式用。"""
    bad = row_structure_errors(words)
    return [word for index, word in enumerate(words) if index not in bad]


def _collect_bundle_names(words):
    """掃過整份 bundle，收集會用到的分類主檔名稱／標註連結詞彙名稱，
    給後面的批次查詢用——一次查完，不要每筆詞條各自查一次。"""
    names = {"source": set(), "category": set(), "part_of_speech": set(), "focus": set()}
    anaphora_word_names = set()
    anaphora_word_ids = set()
    for word in words:
        names["source"].update(word.get("source_names") or [])
        for exp in word.get("explanations") or []:
            names["category"].update(exp.get("category_names") or [])
            names["part_of_speech"].update(exp.get("pos_names") or [])
            names["focus"].update(exp.get("focus_names") or [])
            for sent in exp.get("sentences") or []:
                for ana in sent.get("anaphoras") or []:
                    for item in ana.get("items") or []:
                        word_name = item.get("word_name")
                        if word_name:
                            anaphora_word_names.add(word_name)
                        if isinstance(item.get("word_id"), str) and item["word_id"]:
                            anaphora_word_ids.add(item["word_id"])
    return names, anaphora_word_names, anaphora_word_ids


def _lookup_taxonomy_maps(db: Session, names: dict) -> dict:
    maps = {}
    for kind, name_set in names.items():
        if not name_set:
            maps[kind] = {}
            continue
        model = _TAXONOMY_MODEL_BY_KIND[kind]
        rows = db.query(model.id, model.name).filter(model.name.in_(name_set)).all()
        maps[kind] = {name: id_ for id_, name in rows}
    return maps


def _lookup_anaphora_word_map(db: Session, tribe_id: str, names: set) -> dict:
    """回傳 name -> id，0 筆或多筆比對都給 None（見規劃文件 P4 §5「word_name
    解析到 0 筆或多筆時記成資訊提示、word_id 留 NULL，不是錯誤」——多筆
    命中代表同族語內有同名詞條，匯入工具不猜是哪一筆）。"""
    if not names:
        return {}
    rows = db.query(m.Word.id, m.Word.name).filter(
        m.Word.tribe_id == tribe_id, m.Word.name.in_(names),
    ).all()
    counts, id_by_name = {}, {}
    for word_id, name in rows:
        counts[name] = counts.get(name, 0) + 1
        id_by_name[name] = word_id
    return {name: (id_by_name[name] if counts.get(name) == 1 else None) for name in names}


def _lookup_valid_anaphora_ids(db: Session, tribe_id: str, ids: set) -> set:
    """匯出檔帶的 word_id 中，真的存在且屬於這個族語的那些。"""
    if not ids:
        return set()
    rows = db.query(m.Word.id).filter(m.Word.tribe_id == tribe_id, m.Word.id.in_(ids)).all()
    return {row[0] for row in rows}


def _lookup_existing_words_by_name(db: Session, tribe_id: str, names: set):
    """回傳 (counts, id_by_name)。詞形在同族語內本來就可能重複（既有資料
    就是這樣，見規劃文件 P4 §2），比對到多筆時無法安全判定要更新哪一筆，
    留給該筆詞條自己在檔案裡明確帶 id，匯入工具不猜。"""
    if not names:
        return {}, {}
    rows = db.query(m.Word.id, m.Word.name).filter(
        m.Word.tribe_id == tribe_id, m.Word.name.in_(names),
    ).all()
    counts, id_by_name = {}, {}
    for word_id, name in rows:
        counts[name] = counts.get(name, 0) + 1
        id_by_name[name] = word_id
    return counts, id_by_name


def create_missing_taxonomies(db: Session, words: list) -> dict:
    """套用之前先把整批 bundle 用到、但資料庫裡還沒有的分類/詞類/焦點/
    來源名稱建起來（owner-only 選項，見規劃文件 P4 §5：預設不自動新增，
    避免打錯字讓 149 筆的分類表悄悄長到 400 筆）。回傳實際建立的名稱清單
    給稽核紀錄用；呼叫端負責交易邊界，建立完之後必須重新呼叫
    resolve_import_bundle()——沿用建立之前算出來的結果，這些名稱在那份
    結果裡仍然是「找不到」。"""
    names, _anaphora_names, _anaphora_ids = _collect_bundle_names(structurally_valid_words(words))
    created = {"source": [], "category": [], "part_of_speech": [], "focus": []}
    for kind, name_set in names.items():
        if not name_set:
            continue
        model = _TAXONOMY_MODEL_BY_KIND[kind]
        existing = {row.name for row in db.query(model.name).filter(model.name.in_(name_set)).all()}
        for name in sorted(name_set - existing):
            db.add(model(name=name))
            created[kind].append(name)
    if any(created.values()):
        db.flush()
    return created


def resolve_import_bundle(db: Session, tribe_id: str, words: list) -> dict:
    """把整份 bundle 的每一筆詞條解析成 dictionary_write.apply_word_tree()
    已經認得的 payload（分類名稱→id、標註 word_name→word_id、依詞形或
    明確帶的 id 判斷新建/更新），回傳報告：
    {
      "items": [{"row", "name", "action": "create"|"update"|"error",
                 "word_id", "errors": [...], "payload": {...} 或 None}, ...],
      "new_count", "update_count", "error_count",
    }
    純唯讀查詢，不寫入任何東西——預檢（步驟 3）跟核准套用前的重新驗證
    都呼叫這支函式，形狀完全一致才能拿雜湊互相比對（見 import_report_hash）。
    """
    structure_errors = row_structure_errors(words)
    # 結構不合法的列不參與名稱收集與解析（避免畸形資料讓解析本身丟例外），直接在迴圈裡標成錯誤
    safe_words = [({} if index in structure_errors else word) for index, word in enumerate(words)]
    names, anaphora_word_names, anaphora_word_ids = _collect_bundle_names(safe_words)
    taxonomy_maps = _lookup_taxonomy_maps(db, names)
    anaphora_word_map = _lookup_anaphora_word_map(db, tribe_id, anaphora_word_names)
    valid_anaphora_ids = _lookup_valid_anaphora_ids(db, tribe_id, anaphora_word_ids)

    bundle_names = [w.get("name") for w in safe_words if isinstance(w.get("name"), str) and w.get("name").strip()]
    name_counts_in_bundle = {}
    for bundle_name in bundle_names:
        name_counts_in_bundle[bundle_name] = name_counts_in_bundle.get(bundle_name, 0) + 1
    existing_counts, existing_id_by_name = _lookup_existing_words_by_name(db, tribe_id, set(bundle_names))

    explicit_ids = {w.get("id") for w in safe_words if w.get("id")}
    existing_tribe_by_id = {}
    if explicit_ids:
        rows = db.query(m.Word.id, m.Word.tribe_id).filter(m.Word.id.in_(explicit_ids)).all()
        existing_tribe_by_id = dict(rows)

    items = []
    for index, word in enumerate(words):
        if index in structure_errors:
            raw_name = word.get("name") if isinstance(word, dict) else ""
            items.append({
                "row": index, "name": raw_name if isinstance(raw_name, str) else "", "action": "error",
                "word_id": None, "errors": structure_errors[index], "payload": None, "warnings": [],
            })
            continue
        row_errors = []
        row_warnings = []
        name = word.get("name")

        if name and name_counts_in_bundle.get(name, 0) > 1 and not word.get("id"):
            row_errors.append(
                f"這份檔案裡有 {name_counts_in_bundle[name]} 筆詞條同名「{name}」且都沒有指定 id，"
                "無法判斷各自對應哪一筆",
            )

        word_id = None
        explicit_id = word.get("id")
        if explicit_id:
            target_tribe = existing_tribe_by_id.get(explicit_id)
            if target_tribe is None:
                row_errors.append(f"id 不存在：{explicit_id}")
            elif target_tribe != tribe_id:
                row_errors.append(f"id {explicit_id} 屬於其他族語，無法在這次匯入中更新")
            else:
                word_id = explicit_id
        elif name and existing_counts.get(name) == 1:
            word_id = existing_id_by_name[name]
        elif name and existing_counts.get(name, 0) > 1:
            row_errors.append(
                f"詞形「{name}」在既有資料裡已經有 {existing_counts[name]} 筆同名詞條，"
                "無法自動判斷要更新哪一筆，請在檔案裡明確指定 id",
            )

        resolved_source_ids = []
        for source_name in (word.get("source_names") or []):
            source_id = taxonomy_maps["source"].get(source_name)
            if source_id is None:
                row_errors.append(f"來源不存在：{source_name}")
            else:
                resolved_source_ids.append(source_id)

        resolved_explanations = []
        for exp in (word.get("explanations") or []):
            category_ids = []
            for category_name in (exp.get("category_names") or []):
                category_id = taxonomy_maps["category"].get(category_name)
                if category_id is None:
                    row_errors.append(f"分類不存在：{category_name}")
                else:
                    category_ids.append(category_id)
            pos_ids = []
            for pos_name in (exp.get("pos_names") or []):
                pos_id = taxonomy_maps["part_of_speech"].get(pos_name)
                if pos_id is None:
                    row_errors.append(f"詞類不存在：{pos_name}")
                else:
                    pos_ids.append(pos_id)
            focus_ids = []
            for focus_name in (exp.get("focus_names") or []):
                focus_id = taxonomy_maps["focus"].get(focus_name)
                if focus_id is None:
                    row_errors.append(f"焦點不存在：{focus_name}")
                else:
                    focus_ids.append(focus_id)

            resolved_sentences = []
            for sent in (exp.get("sentences") or []):
                resolved_anaphoras = []
                for ana in (sent.get("anaphoras") or []):
                    resolved_items = []
                    for item in (ana.get("items") or []):
                        word_name = item.get("word_name")
                        explicit_word_id = item.get("word_id")
                        resolved_word_id = None
                        # 稽核 BE2b-02：優先用匯出檔帶的 word_id（驗證存在且同族語），詞形只當備援
                        if isinstance(explicit_word_id, str) and explicit_word_id:
                            if explicit_word_id in valid_anaphora_ids:
                                resolved_word_id = explicit_word_id
                            else:
                                row_warnings.append(f"標註連結的 word_id 不存在或不屬於這個族語：{explicit_word_id}")
                        if resolved_word_id is None and word_name:
                            resolved_word_id = anaphora_word_map.get(word_name)
                            if resolved_word_id is None:
                                row_warnings.append(f"標註連結「{word_name}」找不到唯一對應的詞條，連結會留空")
                        resolved_items.append({
                            "id": item.get("id"), "word_id": resolved_word_id, "name": item.get("name", ""),
                        })
                    resolved_anaphoras.append({
                        "id": ana.get("id"), "is_highlight": ana.get("is_highlight", False),
                        "is_symbol": ana.get("is_symbol", False), "items": resolved_items,
                    })
                resolved_sentences.append({
                    "id": sent.get("id"), "external_id": sent.get("external_id", ""),
                    "original_sentence": sent.get("original_sentence", ""),
                    "chinese_sentence": sent.get("chinese_sentence", ""),
                    "english_sentence": sent.get("english_sentence", ""),
                    "audios": sent.get("audios") or [],
                    "anaphoras": resolved_anaphoras,
                })

            resolved_explanations.append({
                "id": exp.get("id"), "external_id": exp.get("external_id", ""),
                "chinese_explanation": exp.get("chinese_explanation", ""),
                "english_explanation": exp.get("english_explanation", ""),
                "category_ids": category_ids, "pos_ids": pos_ids, "focus_ids": focus_ids,
                "images": exp.get("images") or [],
                "sentences": resolved_sentences,
            })

        if row_errors:
            items.append({
                "row": index, "name": name or "", "action": "error",
                "word_id": word_id, "errors": row_errors, "payload": None, "warnings": row_warnings,
            })
            continue

        resolved_payload = {
            "tribe_id": tribe_id,
            "dialect": word.get("dialect", ""), "name": name, "pinyin": word.get("pinyin", ""),
            "variant": word.get("variant", ""), "formation_word": word.get("formation_word", ""),
            "derivative_root": word.get("derivative_root", ""),
            "frequency": word.get("frequency", 0),
            "dictionary_note": word.get("dictionary_note", ""), "word_img": word.get("word_img", ""),
            "is_derivative_root": word.get("is_derivative_root", False),
            "is_image": word.get("is_image", False),
            "is_zuzucidian": word.get("is_zuzucidian", False),
            "is_other_dialect": word.get("is_other_dialect", False),
            "source_ids": resolved_source_ids,
            "audios": word.get("audios") or [],
            "explanations": resolved_explanations,
        }
        items.append({
            "row": index, "name": name or "", "action": ("update" if word_id else "create"),
            "word_id": word_id, "errors": [], "payload": resolved_payload, "warnings": row_warnings,
        })

    _reject_duplicate_targets(items)
    _attach_current_hashes(db, items)

    return {
        "items": items,
        "new_count": sum(1 for it in items if it["action"] == "create"),
        "update_count": sum(1 for it in items if it["action"] == "update"),
        "error_count": sum(1 for it in items if it["action"] == "error"),
        "warning_count": sum(len(it.get("warnings") or []) for it in items),
    }


def _reject_duplicate_targets(items: list) -> None:
    """同一筆既有詞條被這份 bundle 裡不只一列指定為更新對象——可能是兩列
    都明確帶了同一個 id，也可能是一列帶 id、另一列靠詞形比對巧合命中同一筆。
    無論哪種情況，套用時後面那列會整個覆蓋掉前面那列剛寫入的內容，卻只有
    最後寫入的結果會反映在報告裡；把所有共用同一個 word_id 的列都標成
    錯誤，而不是靜默讓其中一列的異動消失。"""
    counts = {}
    for item in items:
        if item["action"] != "error" and item["word_id"]:
            counts[item["word_id"]] = counts.get(item["word_id"], 0) + 1
    duplicated = {word_id for word_id, count in counts.items() if count > 1}
    if not duplicated:
        return
    for item in items:
        if item["action"] != "error" and item["word_id"] in duplicated:
            item["action"] = "error"
            item["errors"].append(f"這份檔案裡有其他列也指定更新同一筆既有詞條：{item['word_id']}")
            item["payload"] = None


def _attach_current_hashes(db: Session, items: list) -> None:
    """更新列附上目標詞條「現在」的內容雜湊——核准套用前重新 resolve 一次、
    重新附上當下的雜湊再跟預檢當下存的版本比對，是偵測「預檢之後、核准
    之前，這筆詞條被其他人（另一筆一般提案、甚至更早核准的同一批匯入裡
    的另一列）改過」的關鍵，不能只比對這份 bundle 自己的內容有沒有變
    （見 import_report_hash 的說明——bundle 內容本來就沒變，是資料庫端的
    現況變了）。"""
    from dictionary_db import model as m

    from .. import dictionary_write as dw
    from ..dictionary_write.tree_reader import _build_word_trees

    # 稽核 BE2b-04：原本每個更新列各讀一整棵詞條樹（每棵十幾個查詢）；改成整批查、依 id 取。
    # 組樹與雜湊用的是同一份 _build_word_trees，雜湊與 get_word_tree 單筆結果一致。
    update_ids = sorted({item["word_id"] for item in items if item["action"] == "update" and item["word_id"]})
    trees = {}
    for start in range(0, len(update_ids), 500):
        chunk = update_ids[start:start + 500]
        words = db.query(m.Word).filter(m.Word.id.in_(chunk)).all()
        trees.update(_build_word_trees(db, words))

    for item in items:
        item["current_hash"] = None
        if item["action"] == "update" and item["word_id"]:
            tree = trees.get(item["word_id"])
            if tree is None:
                item["action"] = "error"
                item["errors"].append(f"目標詞條在解析過程中已經不存在：{item['word_id']}")
                item["payload"] = None
            else:
                item["current_hash"] = dw.word_content_hash(tree)


def import_report_hash(report: dict) -> str:
    """報告裡「會影響套用結果」的部分（逐筆的 action/word_id/payload/errors）
    的內容雜湊。核准套用前重新 resolve 一次、重算這個雜湊比對，見規劃文件
    P4 §5「重算 hash 跟預檢當下不一致就 409」——預檢到核准中間要走完整趟
    送審流程，資料庫狀態可能已經變了（有人改名了某個分類、新建了同名詞條…），
    不能盲目沿用預檢當下算出來的 id。"""
    slim = [
        {
            "row": item["row"], "action": item["action"], "word_id": item["word_id"],
            "errors": item["errors"], "payload": item["payload"],
            "current_hash": item.get("current_hash"),
        }
        for item in report["items"]
    ]
    canonical = json.dumps(slim, sort_keys=True, ensure_ascii=True, separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
