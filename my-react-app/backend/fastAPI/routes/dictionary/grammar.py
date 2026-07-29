import logging
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from dictionary_db.connect import get_db
from config.tribes import resolve_tribe_name

from ..keyed_cache import KeyedCache

router = APIRouter()

logger = logging.getLogger(__name__)


# ------------------------- 文法資料 -------------------------
# 文法資料（章節/規則/例句/詞綴）是固定的參考資料，不會頻繁變動，
# 但 get_grammar 每次都要對 section/rule/example/affix 做好幾輪查詢，
# 沿用 listening.py / sentence.py 的做法：每個 tribe 只在第一次請求時
# 真正查詢一次，之後直接吃記憶體快取，避免重複的多輪 SQL 往返。
_grammar_cache: KeyedCache[str, dict] = KeyedCache()
_grammar_affixes_cache: KeyedCache[Tuple[str, str], dict] = KeyedCache()
_grammar_quiz_cache: KeyedCache[Tuple[str, str], dict] = KeyedCache()


# _load_grammar 原本查詢與組裝混在同一個函式：4 層巢狀迴圈裡，每撈一批 row
# 就地組進回應 dict，想確認「這條 SQL 對不對」或「這欄位怎麼組出來的」都得
# 整個函式一起讀。拆成 _fetch_*（只呼叫 db.execute，回傳原始 row，不組任何
# dict）與 _format_*（純資料轉換，不碰 db）兩類函式，查詢的次數/順序/範圍
# 跟原本完全一致（例如詞綴仍是「每個 section 各查一次、只查該 section 內
# 的 rule_ids」，不是合併成一次全 tribe 查詢）。

def _fetch_grammar_sections(db: Session, tribe_name: str):
    return db.execute(
        text("SELECT id, section_order, section_key, title, description FROM grammar_section WHERE tribe_id = (SELECT id FROM tribe WHERE name = :tribe) ORDER BY section_order"),
        {"tribe": tribe_name}
    ).fetchall()


def _fetch_section_rules(db: Session, section_id) -> list:
    return db.execute(
        text("SELECT id, rule_order, rule_key, title, structure, function, notes FROM grammar_rule WHERE section_id = :sid ORDER BY rule_order"),
        {"sid": section_id}
    ).fetchall()


def _fetch_rule_affix_map(db: Session, rule_ids: list) -> Dict[int, list]:
    affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
    if rule_ids:
        affix_rows = db.execute(
            text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
            .bindparams(bindparam("rule_ids", expanding=True)),
            {"rule_ids": rule_ids}
        ).fetchall()
        for r_id, affix in affix_rows:
            affix_map[r_id].append(affix)
    return affix_map


def _fetch_rule_examples(db: Session, rule_id) -> list:
    return db.execute(
        text("SELECT id, example_order, tribe_text, chinese_text, analysis FROM grammar_example WHERE rule_id = :rid ORDER BY example_order"),
        {"rid": rule_id}
    ).fetchall()


def _format_rule(rule_row, affix_map: Dict[int, list], examples: list) -> dict:
    r_id, r_order, r_key, r_title, r_struct, r_func, r_notes = rule_row
    return {
        "id": r_id,
        "order": r_order,
        "rule_key": r_key,
        "title": r_title,
        "structure": r_struct,
        "function": r_func,
        "notes": r_notes,
        "affix_tags": affix_map.get(r_id, []),
        "examples": [
            {
                "id": ex[0],
                "tribe_text": ex[2],
                "chinese_text": ex[3],
                "analysis": ex[4],
                "linked_word_ids": [],
            }
            for ex in examples
        ],
    }


def _format_section(section_row, rules_out: list) -> dict:
    sec_id, s_order, s_key, s_title, s_desc = section_row
    return {
        "id": sec_id,
        "order": s_order,
        "section_key": s_key,
        "title": s_title,
        "description": s_desc,   # 純文字，直接回傳
        "rules": rules_out,
    }


def _load_grammar(db: Session, tribe_name: str) -> Optional[dict]:
    def _compute():
        sections = _fetch_grammar_sections(db, tribe_name)
        if not sections:
            return None

        result = []
        for sec in sections:
            rules = _fetch_section_rules(db, sec[0])
            affix_map = _fetch_rule_affix_map(db, [r[0] for r in rules])
            rules_out = [
                _format_rule(rule, affix_map, _fetch_rule_examples(db, rule[0]))
                for rule in rules
            ]
            result.append(_format_section(sec, rules_out))

        return {"tribe": tribe_name, "sections": result}

    return _grammar_cache.get_or_compute(tribe_name, _compute)


@router.get("/grammar/{tribe}")
def get_grammar(tribe: str, limit: Optional[int] = None, offset: int = 0, db: Session = Depends(get_db)):
    """查詢指定族語的所有文法章節（含規則、例句、詞綴）
    limit/offset 為選填的章節分頁參數，不傳則維持原本回傳全部章節的行為"""
    try:
        try:
            tribe_name = resolve_tribe_name(tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        payload = _load_grammar(db, tribe_name)
        if payload is None:
            return JSONResponse({"detail": f"找不到 {tribe_name} 的文法資料"}, status_code=404)
        sections = payload["sections"]
        sliced = sections[offset:offset + limit] if limit is not None else sections[offset:]
        return JSONResponse({**payload, "sections": sliced, "total": len(sections)}, status_code=200)
    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)


@router.get("/grammar/{tribe}/search")
def search_grammar(tribe: str, q: str, db: Session = Depends(get_db)):
    """搜尋文法規則或例句
    q: 關鍵字，可搜尋規則標題、功能說明、例句原文、中文翻譯
    """
    try:
        try:
            tribe_name = resolve_tribe_name(tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        kw = f"%{q}%"

        # 透過 JOIN grammar_section 取得 tribe，不再依賴 grammar_rule.tribe
        rule_rows = db.execute(
            text("""
                SELECT r.id, r.rule_key, r.title, r.structure, r.function, r.notes
                FROM grammar_rule r
                JOIN grammar_section s ON r.section_id = s.id
                WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                  AND (r.title LIKE :kw OR r.function LIKE :kw OR r.notes LIKE :kw OR r.structure LIKE :kw)
                ORDER BY r.rule_order
            """),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        # 取各 rule 的詞綴
        rule_ids = [r[0] for r in rule_rows]
        affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
        if rule_ids:
            for r_id, affix in db.execute(
                text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
                .bindparams(bindparam("rule_ids", expanding=True)),
                {"rule_ids": rule_ids}
            ).fetchall():
                affix_map[r_id].append(affix)

        example_rows = db.execute(
            text("""
                SELECT e.id, e.rule_id, e.tribe_text, e.chinese_text, e.analysis
                FROM grammar_example e
                JOIN grammar_rule r  ON e.rule_id   = r.id
                JOIN grammar_section s ON r.section_id = s.id
                WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                  AND (e.tribe_text LIKE :kw OR e.chinese_text LIKE :kw OR e.analysis LIKE :kw)
            """),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        affix_rows = db.execute(
            text("SELECT id, affix, affix_type, function, example_form FROM grammar_affix WHERE tribe_id = (SELECT id FROM tribe WHERE name = :tribe) AND (affix LIKE :kw OR function LIKE :kw)"),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        return JSONResponse({
            "tribe": tribe_name,
            "query": q,
            "rules": [
                {"id": r[0], "rule_key": r[1], "title": r[2],
                 "structure": r[3], "function": r[4], "notes": r[5],
                 "affix_tags": affix_map.get(r[0], [])}
                for r in rule_rows
            ],
            "examples": [
                {"id": r[0], "rule_id": r[1], "tribe_text": r[2],
                 "chinese_text": r[3], "analysis": r[4]}
                for r in example_rows
            ],
            "affixes": [
                {"id": r[0], "affix": r[1], "affix_type": r[2],
                 "function": r[3], "example_form": r[4]}
                for r in affix_rows
            ],
        }, status_code=200)
    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)


def _load_grammar_affixes(db: Session, tribe_name: str, affix_type: Optional[str]) -> dict:
    key = (tribe_name, affix_type or "")

    def _compute():
        if affix_type:
            rows = db.execute(
                text("""
                    SELECT a.id, a.affix, a.affix_type, a.function, a.example_form,
                           GROUP_CONCAT(ra.rule_id) AS rule_ids
                    FROM grammar_affix a
                    LEFT JOIN grammar_rule_affix ra ON ra.affix_id = a.id
                    WHERE a.tribe_id = (SELECT id FROM tribe WHERE name = :tribe) AND a.affix_type = :at
                    GROUP BY a.id
                    ORDER BY a.affix
                """),
                {"tribe": tribe_name, "at": affix_type}
            ).fetchall()
        else:
            rows = db.execute(
                text("""
                    SELECT a.id, a.affix, a.affix_type, a.function, a.example_form,
                           GROUP_CONCAT(ra.rule_id) AS rule_ids
                    FROM grammar_affix a
                    LEFT JOIN grammar_rule_affix ra ON ra.affix_id = a.id
                    WHERE a.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                    GROUP BY a.id
                    ORDER BY a.affix_type, a.affix
                """),
                {"tribe": tribe_name}
            ).fetchall()

        return {
            "tribe": tribe_name,
            "affixes": [
                {"id": r[0], "affix": r[1], "affix_type": r[2],
                 "function": r[3], "example_form": r[4],
                 "rule_ids": [int(x) for x in r[5].split(",")] if r[5] else []}
                for r in rows
            ]
        }

    return _grammar_affixes_cache.get_or_compute(key, _compute)


@router.get("/grammar/{tribe}/affixes")
def get_grammar_affixes(
    tribe: str,
    affix_type: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """取得詞綴清單
    affix_type: prefix / suffix / infix / circumfix / reduplication / auxiliary（不傳則回傳全部）
    limit/offset 為選填的分頁參數，不傳則維持原本回傳全部詞綴的行為
    """
    try:
        try:
            tribe_name = resolve_tribe_name(tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        payload = _load_grammar_affixes(db, tribe_name, affix_type)
        affixes = payload["affixes"]
        sliced = affixes[offset:offset + limit] if limit is not None else affixes[offset:]
        return JSONResponse({**payload, "affixes": sliced, "total": len(affixes)}, status_code=200)
    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)


def _load_grammar_quiz_material(db: Session, tribe_name: str, section_key: Optional[str]) -> dict:
    key = (tribe_name, section_key or "")

    def _compute():
        if section_key:
            rows = db.execute(
                text("""
                    SELECT r.id, r.rule_key, r.title, r.structure, r.function,
                           e.id, e.tribe_text, e.chinese_text, e.analysis
                    FROM grammar_rule r
                    JOIN grammar_section s ON r.section_id = s.id
                    JOIN grammar_example e ON e.rule_id = r.id
                    WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe) AND s.section_key LIKE :sk
                      AND e.tribe_text IS NOT NULL AND e.tribe_text != ''
                    ORDER BY r.rule_order, e.example_order
                """),
                {"tribe": tribe_name, "sk": f"%{section_key}%"}
            ).fetchall()
        else:
            rows = db.execute(
                text("""
                    SELECT r.id, r.rule_key, r.title, r.structure, r.function,
                           e.id, e.tribe_text, e.chinese_text, e.analysis
                    FROM grammar_rule r
                    JOIN grammar_section s ON r.section_id = s.id
                    JOIN grammar_example e ON e.rule_id = r.id
                    WHERE s.tribe_id = (SELECT id FROM tribe WHERE name = :tribe)
                      AND e.tribe_text IS NOT NULL AND e.tribe_text != ''
                    ORDER BY r.rule_order, e.example_order
                """),
                {"tribe": tribe_name}
            ).fetchall()

        # 取詞綴資料
        rule_ids = list({row[0] for row in rows})
        affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
        if rule_ids:
            for r_id, affix in db.execute(
                text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
                .bindparams(bindparam("rule_ids", expanding=True)),
                {"rule_ids": rule_ids}
            ).fetchall():
                affix_map[r_id].append(affix)

        # 將例句聚合到各規則下
        rules_map: Dict[int, dict] = {}
        for row in rows:
            r_id = row[0]
            if r_id not in rules_map:
                rules_map[r_id] = {
                    "id": r_id,
                    "rule_key": row[1],
                    "title": row[2],
                    "structure": row[3],
                    "function": row[4],
                    "affix_tags": affix_map.get(r_id, []),
                    "examples": [],
                }
            rules_map[r_id]["examples"].append({
                "id": row[5],
                "tribe_text": row[6],
                "chinese_text": row[7],
                "analysis": row[8],
                "linked_word_ids": [],
            })

        return {
            "tribe": tribe_name,
            "rules": list(rules_map.values()),
        }

    return _grammar_quiz_cache.get_or_compute(key, _compute)


@router.get("/grammar/{tribe}/quiz")
def get_grammar_quiz_material(
    tribe: str,
    section_key: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """取得有例句的規則清單（用於自動生成測驗題）
    section_key: 指定章節 key（不傳則回傳全部有例句的規則）
    limit/offset 為選填的分頁參數，不傳則維持原本回傳全部規則的行為
    """
    try:
        try:
            tribe_name = resolve_tribe_name(tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        payload = _load_grammar_quiz_material(db, tribe_name, section_key)
        rules = payload["rules"]
        sliced = rules[offset:offset + limit] if limit is not None else rules[offset:]
        return JSONResponse({**payload, "rules": sliced, "total": len(rules)}, status_code=200)
    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)
