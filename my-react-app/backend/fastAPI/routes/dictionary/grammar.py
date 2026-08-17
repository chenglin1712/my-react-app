import logging
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from dictionary_db.connect import get_db
from config.grammar_affixes import VALID_AFFIX_TYPES as _VALID_AFFIX_TYPES
from config.tribes import resolve_tribe_name
from fastAPI import rate_limit_config
from fastAPI.rate_limit import limiter

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
# section_key 是自由文字模糊搜尋（見 _load_grammar_quiz_material 的 LIKE
# 查詢），不像 affix_type 能收斂成固定白名單，key 只用 tribe_name（見
# _load_grammar_quiz_material 的說明：帶 section_key 的查詢一律略過快取）。
_grammar_quiz_cache: KeyedCache[str, dict] = KeyedCache()

# get_grammar_affixes 的 affix_type 原本是完全沒有白名單限制的自由字串，
# 直接拿來當 _grammar_affixes_cache 的 key 一部分：KeyedCache 沒有
# eviction／TTL，任何已登入使用者只要每次帶不同字串發請求，就能讓伺服器
# 記憶體無上限成長。改成收斂到 config/grammar_affixes.py 的固定白名單
# （P4.2 後台新增詞綴的表單也要驗證同一份清單，兩邊共用同一個資料來源），
# 額外帶來的好處是不支援的值會直接 400，而不是靜默回傳空清單。


# _load_grammar 原本查詢與組裝混在同一個函式：4 層巢狀迴圈裡，每撈一批 row
# 就地組進回應 dict，想確認「這條 SQL 對不對」或「這欄位怎麼組出來的」都得
# 整個函式一起讀。拆成 _fetch_*（只呼叫 db.execute，回傳原始 row，不組任何
# dict）與 _format_*（純資料轉換，不碰 db）兩類函式。
#
# 這批 _fetch_* 原本是「逐 section 查 rule、逐 rule 查 example」，查詢次數
# 隨章節數/規則數線性成長，是典型的 N+1（P4 review BE-19：資料量還小時被
# _grammar_cache 蓋過去，但冷啟動／快取失效那一次仍要真的付出這個成本）。
# 現在改成批次查詢：sections、rules_for_sections、affix_map、
# examples_for_rules、word_map 固定 5 次查詢，不論這個族語有幾個章節/
# 規則/例句都不會再變多，在 Python 記憶體裡用 dict 分組後組回原本的樹狀
# 結構，回應形狀與 _format_rule()／_format_section() 的介面完全不變。

def _fetch_grammar_sections(db: Session, tribe_name: str):
    return db.execute(
        text("SELECT id, section_order, section_key, title, description FROM grammar_section WHERE tribe_id = (SELECT id FROM tribe WHERE name = :tribe) ORDER BY section_order"),
        {"tribe": tribe_name}
    ).fetchall()


def _fetch_rules_for_sections(db: Session, section_ids: list) -> Dict[int, list]:
    """批次載入多個 section 底下的全部 rule，一次查詢、依 section_id 分組
    （P4 review BE-19）。取代原本 _load_grammar() 逐個 section 各查一次
    rule 的寫法——族語資料量成長後，章節數就是查詢次數，是典型的 N+1。
    分組後每個 section 底下的 rule row 形狀（id, rule_order, rule_key,
    title, structure, function, notes）跟原本單一 section 查詢完全一致
    （這裡多查的 section_id 只用來分組，回傳前會去掉），呼叫端
    _format_rule() 不用跟著改 unpacking。"""
    rules_by_section: Dict[int, list] = {sid: [] for sid in section_ids}
    if section_ids:
        rows = db.execute(
            text(
                "SELECT section_id, id, rule_order, rule_key, title, structure, function, notes "
                "FROM grammar_rule WHERE section_id IN :section_ids ORDER BY section_id, rule_order"
            ).bindparams(bindparam("section_ids", expanding=True)),
            {"section_ids": section_ids}
        ).fetchall()
        for row in rows:
            row = tuple(row)
            rules_by_section[row[0]].append(row[1:])
    return rules_by_section


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


def _fetch_examples_for_rules(db: Session, rule_ids: list) -> Dict[int, list]:
    """批次載入多個 rule 底下的全部 example，一次查詢、依 rule_id 分組
    （P4 review BE-19）。取代原本 _load_grammar() 逐個 rule 各查一次
    example 的寫法——這是巢狀在「逐 section 查 rule」裡面的第二層 N+1，
    章節數 x 每章節規則數才是原本的查詢次數。分組後每個 rule 底下的
    example row 形狀（id, example_order, tribe_text, chinese_text,
    analysis）跟原本單一 rule 查詢完全一致，_format_rule() 不用跟著改。"""
    examples_by_rule: Dict[int, list] = {rid: [] for rid in rule_ids}
    if rule_ids:
        rows = db.execute(
            text(
                "SELECT rule_id, id, example_order, tribe_text, chinese_text, analysis "
                "FROM grammar_example WHERE rule_id IN :rule_ids ORDER BY rule_id, example_order"
            ).bindparams(bindparam("rule_ids", expanding=True)),
            {"rule_ids": rule_ids}
        ).fetchall()
        for row in rows:
            row = tuple(row)
            examples_by_rule[row[0]].append(row[1:])
    return examples_by_rule


def _fetch_example_word_map(db: Session, example_ids: list) -> Dict[int, list]:
    """例句連結的詞彙（grammar_example_word，P4.3 後台編輯器才會真的寫入
    這張表）——這裡原本一直是寫死的空陣列（見下方 _format_rule 呼叫端的
    修正前歷史），後台辛苦連結的詞彙關聯，學生端一直看不到；補上跟
    _fetch_rule_affix_map 同一種「批次查、per-rule 一次」的寫法。"""
    word_map: Dict[int, list] = {eid: [] for eid in example_ids}
    if example_ids:
        rows = db.execute(
            text("SELECT example_id, word_id FROM grammar_example_word WHERE example_id IN :example_ids")
            .bindparams(bindparam("example_ids", expanding=True)),
            {"example_ids": example_ids}
        ).fetchall()
        for e_id, w_id in rows:
            word_map[e_id].append(w_id)
    return word_map


def _format_rule(rule_row, affix_map: Dict[int, list], examples: list, word_map: Dict[int, list]) -> dict:
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
                "linked_word_ids": word_map.get(ex[0], []),
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

        section_ids = [sec[0] for sec in sections]
        rules_by_section = _fetch_rules_for_sections(db, section_ids)

        all_rule_ids = [rule[0] for rules in rules_by_section.values() for rule in rules]
        affix_map = _fetch_rule_affix_map(db, all_rule_ids)
        examples_by_rule = _fetch_examples_for_rules(db, all_rule_ids)

        all_example_ids = [ex[0] for examples in examples_by_rule.values() for ex in examples]
        word_map = _fetch_example_word_map(db, all_example_ids)

        result = []
        for sec in sections:
            rules_out = [
                _format_rule(rule, affix_map, examples_by_rule.get(rule[0], []), word_map)
                for rule in rules_by_section.get(sec[0], [])
            ]
            result.append(_format_section(sec, rules_out))

        return {"tribe": tribe_name, "sections": result}

    return _grammar_cache.get_or_compute(tribe_name, _compute)


@router.get("/grammar/{tribe}")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("dictionary_grammar_get_grammar", "60/minute"))  # 走 _grammar_cache（每個 tribe 第一次呼叫才真正查詢），比照 search.py 同樣是快取後端點的限流
def get_grammar(
    request: Request,
    tribe: str,
    limit: Optional[int] = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """查詢指定族語的所有文法章節（含規則、例句、詞綴）
    limit/offset 為選填的章節分頁參數，不傳則維持原本回傳全部章節的行為

    limit/offset 原本是裸的 int，沒有下限驗證：sections[offset:offset+limit]
    在 offset 或 limit 為負值時會命中 Python 的負索引切片，不會報錯，而是
    安靜地從陣列尾端切一段回來（total 卻仍回報正確總筆數，變成「總數正確、
    內容對不上頁碼」的資料）。比照 dictionary/schemas.py 的
    AllWordsRequest.offset/limit 加上 ge 下限，交給 FastAPI 在進 handler 前
    就擋成 422。"""
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
@limiter.limit(lambda: rate_limit_config.get_configured_rate("dictionary_grammar_search_grammar", "20/minute"))  # 沒有走快取，每次呼叫都是 3 次前導萬用字元 LIKE 全表掃描，比其他 3 支端點限制更嚴
def search_grammar(request: Request, tribe: str, q: str, db: Session = Depends(get_db)):
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
@limiter.limit(lambda: rate_limit_config.get_configured_rate("dictionary_grammar_get_grammar_affixes", "60/minute"))  # 走 _grammar_affixes_cache，比照 search.py 同樣是快取後端點的限流
def get_grammar_affixes(
    request: Request,
    tribe: str,
    affix_type: Optional[str] = None,
    limit: Optional[int] = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """取得詞綴清單
    affix_type: prefix / suffix / infix / circumfix / reduplication / auxiliary（不傳則回傳全部）
    limit/offset 為選填的分頁參數，不傳則維持原本回傳全部詞綴的行為（下限驗證見 get_grammar 說明）
    """
    try:
        try:
            tribe_name = resolve_tribe_name(tribe)
        except ValueError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)
        if affix_type is not None and affix_type not in _VALID_AFFIX_TYPES:
            return JSONResponse({"detail": f"不支援的詞綴類型：{affix_type}"}, status_code=400)
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

    if section_key:
        # section_key 是自由文字模糊搜尋（上面 LIKE 查詢），不像 affix_type
        # 能收斂成固定白名單。如果比照 affix_type 直接拿使用者輸入當 key 快取，
        # KeyedCache 沒有 eviction／TTL，等於任何已登入使用者只要每次帶不同
        # 字串發請求，就能讓 _grammar_quiz_cache 無上限成長（見稽核報告：帶 5
        # 個隨機字串就留下 5 筆永久快取）。改成有 section_key 時一律略過快取、
        # 直接查 DB；只有「查全部規則」（section_key 為 None，呼叫端固定只會
        # 用到 tribe_name 這個有限的 key）才會走快取，回到跟其他呼叫端一樣
        # 「key 空間有限」的安全狀態。
        return _compute()
    return _grammar_quiz_cache.get_or_compute(tribe_name, _compute)


@router.get("/grammar/{tribe}/quiz")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("dictionary_grammar_get_grammar_quiz_material", "60/minute"))  # 不帶 section_key 時走 _grammar_quiz_cache，比照 search.py 同樣是快取後端點的限流
def get_grammar_quiz_material(
    request: Request,
    tribe: str,
    section_key: Optional[str] = None,
    limit: Optional[int] = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """取得有例句的規則清單（用於自動生成測驗題）
    section_key: 指定章節 key（不傳則回傳全部有例句的規則）
    limit/offset 為選填的分頁參數，不傳則維持原本回傳全部規則的行為（下限驗證見 get_grammar 說明）
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
