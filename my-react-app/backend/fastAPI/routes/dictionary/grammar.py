import logging
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from dictionary_db.connect import get_db
from config.tribes import TRIBE_MAP

from .keyed_lock import _KeyedLock

router = APIRouter()

logger = logging.getLogger(__name__)


# ------------------------- 文法資料 -------------------------
# 文法資料（章節/規則/例句/詞綴）是固定的參考資料，不會頻繁變動，
# 但 get_grammar 每次都要對 section/rule/example/affix 做好幾輪查詢，
# 沿用 listening.py / sentence.py 的做法：每個 tribe 只在第一次請求時
# 真正查詢一次，之後直接吃記憶體快取，避免重複的多輪 SQL 往返。
_grammar_cache: Dict[str, Optional[dict]] = {}
_grammar_locks = _KeyedLock()
_grammar_affixes_cache: Dict[Tuple[str, str], dict] = {}
_grammar_affixes_locks = _KeyedLock()
_grammar_quiz_cache: Dict[Tuple[str, str], dict] = {}
_grammar_quiz_locks = _KeyedLock()


def _load_grammar(db: Session, tribe_name: str) -> Optional[dict]:
    if tribe_name in _grammar_cache:
        return _grammar_cache[tribe_name]

    with _grammar_locks.get(tribe_name):
        if tribe_name in _grammar_cache:
            return _grammar_cache[tribe_name]

        sections = db.execute(
            text("SELECT id, section_order, section_key, title, description FROM grammar_section WHERE tribe_id = (SELECT id FROM tribe WHERE name = :tribe) ORDER BY section_order"),
            {"tribe": tribe_name}
        ).fetchall()

        if not sections:
            return None

        result = []
        for sec in sections:
            sec_id, s_order, s_key, s_title, s_desc = sec

            rules = db.execute(
                text("SELECT id, rule_order, rule_key, title, structure, function, notes FROM grammar_rule WHERE section_id = :sid ORDER BY rule_order"),
                {"sid": sec_id}
            ).fetchall()

            # 一次取出本 section 所有 rule 對應的詞綴
            rule_ids = [r[0] for r in rules]
            affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
            if rule_ids:
                affix_rows = db.execute(
                    text("SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN :rule_ids")
                    .bindparams(bindparam("rule_ids", expanding=True)),
                    {"rule_ids": rule_ids}
                ).fetchall()
                for r_id, affix in affix_rows:
                    affix_map[r_id].append(affix)

            rules_out = []
            for rule in rules:
                r_id, r_order, r_key, r_title, r_struct, r_func, r_notes = rule

                examples = db.execute(
                    text("SELECT id, example_order, tribe_text, chinese_text, analysis FROM grammar_example WHERE rule_id = :rid ORDER BY example_order"),
                    {"rid": r_id}
                ).fetchall()

                rules_out.append({
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
                })

            result.append({
                "id": sec_id,
                "order": s_order,
                "section_key": s_key,
                "title": s_title,
                "description": s_desc,   # 純文字，直接回傳
                "rules": rules_out,
            })

        payload = {"tribe": tribe_name, "sections": result}
        _grammar_cache[tribe_name] = payload
        return payload


@router.get("/grammar/{tribe}")
def get_grammar(tribe: str, limit: Optional[int] = None, offset: int = 0, db: Session = Depends(get_db)):
    """查詢指定族語的所有文法章節（含規則、例句、詞綴）
    limit/offset 為選填的章節分頁參數，不傳則維持原本回傳全部章節的行為"""
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
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
        tribe_name = TRIBE_MAP.get(tribe, tribe)
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
    if key in _grammar_affixes_cache:
        return _grammar_affixes_cache[key]

    with _grammar_affixes_locks.get(key):
        if key in _grammar_affixes_cache:
            return _grammar_affixes_cache[key]

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

        payload = {
            "tribe": tribe_name,
            "affixes": [
                {"id": r[0], "affix": r[1], "affix_type": r[2],
                 "function": r[3], "example_form": r[4],
                 "rule_ids": [int(x) for x in r[5].split(",")] if r[5] else []}
                for r in rows
            ]
        }
        _grammar_affixes_cache[key] = payload
        return payload


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
        tribe_name = TRIBE_MAP.get(tribe, tribe)
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
    if key in _grammar_quiz_cache:
        return _grammar_quiz_cache[key]

    with _grammar_quiz_locks.get(key):
        if key in _grammar_quiz_cache:
            return _grammar_quiz_cache[key]

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

        payload = {
            "tribe": tribe_name,
            "rules": list(rules_map.values()),
        }
        _grammar_quiz_cache[key] = payload
        return payload


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
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        payload = _load_grammar_quiz_material(db, tribe_name, section_key)
        rules = payload["rules"]
        sliced = rules[offset:offset + limit] if limit is not None else rules[offset:]
        return JSONResponse({**payload, "rules": sliced, "total": len(rules)}, status_code=200)
    except Exception as e:
        # 原始例外訊息只記 log，不回給 client——可能包含內部路徑、SQL、其他
        # 實作細節，Django 端「不外洩內部錯誤」的修正原本沒有搬過來這邊。
        logger.exception(e)
        return JSONResponse({"detail": "伺服器發生錯誤，請稍後再試"}, status_code=500)
