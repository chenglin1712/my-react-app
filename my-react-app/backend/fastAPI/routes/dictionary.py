import json, re, logging, httpx
from typing import List, Dict, Tuple, Optional

from fastapi import APIRouter, Request, Depends, Response, Body
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from dotenv import load_dotenv
import os

from fastAPI.routes.connect import get_db
from fastAPI.routes.model import Word

router = APIRouter()


logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)


class AnaphoraItem(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None

class AnaphoraSentence(BaseModel):
    anaphoraItems: Optional[List[AnaphoraItem]] = None
    isHighlight: Optional[bool] = None
    isSymbol: Optional[bool] = None

class AudioItem(BaseModel):
    id: Optional[str] = None
    fileId: Optional[str] = None
    audioClass: Optional[str] = None

class SentenceItem(BaseModel):
    id: Optional[str] = None
    originalSentence: Optional[str] = None
    anaphoraSentence: Optional[list[AnaphoraSentence]] = None
    chineseSentence: Optional[str] = None
    englishSentence: Optional[str] = None
    audioItems: Optional[list[AudioItem]] = None

class ExplanationItem(BaseModel):
    id: Optional[str] = None
    chineseExplanation: Optional[str] = None
    englishExplanation: Optional[str] = None
    category: Optional[list] = None
    partOfSpeech: Optional[list] = None
    focus: Optional[list] = None
    imageUrl: Optional[list] = None
    sentenceItems: Optional[List[SentenceItem]] = None

class WordResult(BaseModel):
    id: Optional[str] = None
    tribeId: Optional[str] = None
    tribe: Optional[str] = None
    dialect: Optional[str] = None
    name: Optional[str] = None
    pinyin: Optional[str] = None
    variant: Optional[str] = None
    formationWord: Optional[str] = None
    derivativeRoot: Optional[str] = None
    frequency: Optional[int] = None
    hit: Optional[int] = None 
    dictionaryNote: Optional[str] = None
    sources: Optional[list] = None
    explanationItems: Optional[List[ExplanationItem]] = None
    audioItems: Optional[list[AudioItem]] = None
    word_img: Optional[str] = None
    isDerivativeRoot: Optional[bool] = None
    isImage: Optional[bool] = None
    isZuzucidian: Optional[bool] = None
    isOtherDialect: Optional[bool] = None


TRIBE_MAP = {
    '泰雅': '泰雅語', 'tayal': '泰雅語',
    '阿美': '阿美語', 'amis': '阿美語',
    '布農': '布農語', 'bunun': '布農語',
    '葛瑪蘭': '葛瑪蘭語', 'kavalan': '葛瑪蘭語',
    '排灣': '排灣語', 'paiwan': '排灣語',
}

class KeywordRequest(BaseModel):
    keyword: Optional[str] = ''
    tribe: Optional[str] = '泰雅'


# ------------------------- Utilities -------------------------
def simplify_tayal(word: str) -> str:
    """忽略數字結尾（例：maku3 → maku）"""
    return re.sub(r'\d+$', '', word or "")

def is_chinese(text: str) -> bool:
    return any('\u4e00' <= ch <= '\u9fff' for ch in text)


def parse_explanations(value) -> List[ExplanationItem]:
    """解析 explanationItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            ExplanationItem(
                id=item.get("id"),
                chineseExplanation=item.get("chineseExplanation"),
                englishExplanation=item.get("englishExplanation"),
                category=item.get("category", []),
                partOfSpeech=item.get("partOfSpeech", []),
                focus=item.get("focus", []),
                imageUrl=item.get("imageUrl", []),
                sentenceItems=parse_sentences(item.get("sentenceItems", [])),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 explanationItems 時錯誤: {e}")
        return []
    
def parse_sentences(value) -> List[SentenceItem]:
    """解析 sentenceItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            SentenceItem(
                id=item.get("id"),
                originalSentence=item.get("originalSentence"),
                anaphoraSentence=parse_anaphoraSentences(item.get("anaphoraSentence",[])),
                chineseSentence=item.get("chineseSentence"),
                englishSentence=item.get("englishSentence"),
                audioItems=parse_audios(item.get("audioItems", [])),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 sentenceItems 時錯誤: {e}")
        return []

def parse_anaphoraSentences(value) -> List[AnaphoraSentence]:
    """解析 anaphoraSentences 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            AnaphoraSentence(
                anaphoraItems=parse_anaphoras(item.get("anaphoraItems",[])),
                isHighlight=item.get("isHighlight"),
                isSymbol=item.get("isSymbol"),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 anaphoraSentences 時錯誤: {e}")
        return []

def parse_anaphoras(value) -> List[AnaphoraItem]:
    """解析 anaphoraItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            AnaphoraItem(
                id=item.get("id"),
                name=item.get("name"),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 anaphoraItems 時錯誤: {e}")
        return []
    
def parse_audios(value) -> List[AudioItem]:
    """解析 audioItems 欄位"""
    try:
        data = json.loads(value) if isinstance(value, str) else value
        if not isinstance(data, list):
            return []
        return [
            AudioItem(
                id=item.get("id"),
                fileId=item.get("fileId"),
                audioClass=item.get("audioClass"),
            )
            for item in data
        ]
    except Exception as e:
        logger.error(f"解析 audioItems 時錯誤: {e}")
        return []




# ------------------------- 搜尋邏輯 -------------------------
def search_by_chinese(db: Session, keyword: str, tribe: str = '泰雅語') -> Tuple[List[WordResult], List[str]]:
    """完全比對中文解釋"""
    from sqlalchemy import func
    words = db.query(Word).filter(Word.tribe == tribe).order_by(func.lower(Word.name)).all()

    results = []
    matched_names = []

    for word in words:
        explanations = parse_explanations(word.explanation_items)
        for defin in explanations:
            if defin.chineseExplanation == keyword:
                matched_names.append(simplify_tayal(word.name))
                results.append(
                    WordResult(
                        id=word.id,
                        tribeId=word.tribe_id,
                        tribe=word.tribe,
                        dialect=word.dialect,
                        name=word.name,
                        pinyin=word.pinyin,
                        variant=word.variant,
                        formationWord=word.formation_word,
                        derivativeRoot=word.derivative_root,
                        frequency=word.frequency,
                        hit=word.hit,
                        dictionaryNote=word.dictionary_note,
                        sources=json.loads(word.sources or "[]"),
                        explanationItems=explanations,
                        audioItems=parse_audios(word.audio_items or "[]"),
                        word_img=word.word_img,
                        isDerivativeRoot=word.is_derivative_root,
                        isImage=word.is_image, 
                        isZuzucidian=word.is_zuzucidian,
                        isOtherDialect=word.is_other_dialect,
                    )
                )
                break

    return results, matched_names




def fuzzy_search_by_chinese(db: Session, keyword: str, exclude_names: List[str], tribe: str = '泰雅語') -> Dict[str, List[WordResult]]:
    """模糊搜尋中文解釋"""
    words = db.query(Word).filter(Word.tribe == tribe).all()
    fuzzy_content = {}

    for word in words:
        name_simple = simplify_tayal(word.name)
        if name_simple in exclude_names:
            continue

        explanations = parse_explanations(word.explanation_items)
        for defin in explanations:
            if keyword in (defin.chineseExplanation or ""):
                if defin.chineseExplanation not in fuzzy_content:
                    fuzzy_content[defin.chineseExplanation] = []

                fuzzy_content[defin.chineseExplanation].append(
                    WordResult(
                        id=word.id,
                        tribeId=word.tribe_id,
                        tribe=word.tribe,
                        dialect=word.dialect,
                        name=word.name,
                        pinyin=word.pinyin,
                        variant=word.variant,
                        formationWord=word.formation_word,
                        derivativeRoot=word.derivative_root,
                        frequency=word.frequency,
                        hit=word.hit,
                        dictionaryNote=word.dictionary_note,
                        sources=json.loads(word.sources or "[]"),
                        explanationItems=explanations,
                        audioItems=parse_audios(word.audio_items or "[]"),
                        word_img=word.word_img,
                        isDerivativeRoot=word.is_derivative_root,
                        isImage=word.is_image, 
                        isZuzucidian=word.is_zuzucidian,
                        isOtherDialect=word.is_other_dialect,
                    )
                )

    return fuzzy_content

def search(db: Session, keyword: str, tribe: str = '泰雅語') -> Tuple[List[WordResult], List[str]]:
    """完全比對族語"""
    words = db.query(Word).filter(Word.tribe == tribe, Word.name.like(f"%{keyword}%")).all()

    results = []
    matched_names = []

    for word in words:
       
            if word.name == keyword:
                matched_names.append(simplify_tayal(word.name))
                results.append(
                    WordResult(
                        id=word.id,
                        tribeId=word.tribe_id,
                        tribe=word.tribe,
                        dialect=word.dialect,
                        name=word.name,
                        pinyin=word.pinyin,
                        variant=word.variant,
                        formationWord=word.formation_word,
                        derivativeRoot=word.derivative_root,
                        frequency=word.frequency,
                        hit=word.hit,
                        dictionaryNote=word.dictionary_note,
                        sources=json.loads(word.sources or "[]"),
                        explanationItems=parse_explanations(word.explanation_items),
                        audioItems=parse_audios(word.audio_items or "[]"),
                        word_img=word.word_img,
                        isDerivativeRoot=word.is_derivative_root,
                        isImage=word.is_image, 
                        isZuzucidian=word.is_zuzucidian,
                        isOtherDialect=word.is_other_dialect,
                    )
                )
                break

    return results, matched_names




def fuzzy_search(db: Session, keyword: str, exclude_names: List[str], tribe: str = '泰雅語') -> Dict[str, List[WordResult]]:
    """模糊搜尋族語"""
    words = db.query(Word).filter(Word.tribe == tribe, Word.name.like(f"%{keyword}%")).all()
    fuzzy_content = {}

    for word in words:
        name_simple = simplify_tayal(word.name)
        if name_simple in exclude_names:
            continue

       
        
        if keyword in (word.name or ""):
                if word.name not in fuzzy_content:
                    fuzzy_content[word.name] = []

                fuzzy_content[word.name].append(
                    WordResult(
                        id=word.id,
                        tribeId=word.tribe_id,
                        tribe=word.tribe,
                        dialect=word.dialect,
                        name=word.name,
                        pinyin=word.pinyin,
                        variant=word.variant,
                        formationWord=word.formation_word,
                        derivativeRoot=word.derivative_root,
                        frequency=word.frequency,
                        hit=word.hit,
                        dictionaryNote=word.dictionary_note,
                        sources=json.loads(word.sources or "[]"),
                        explanationItems=parse_explanations(word.explanation_items),
                        audioItems=parse_audios(word.audio_items or "[]"),
                        word_img=word.word_img,
                        isDerivativeRoot=word.is_derivative_root,
                        isImage=word.is_image, 
                        isZuzucidian=word.is_zuzucidian,
                        isOtherDialect=word.is_other_dialect,
                    )
                )

    return fuzzy_content

def search_all(db: Session, tribe: str = '泰雅語', limit: Optional[int] = None, offset: int = 0) -> Dict[str, List[WordResult]]:
    """回傳所有詞條。limit/offset 為選填的 SQL 層分頁參數，不傳則維持原本回傳全部的行為
    （目前前端一次拿全部資料後在畫面上分批顯示，尚未改成向後端逐頁請求）。"""
    query = db.query(Word).filter(Word.tribe == tribe).order_by(Word.name)
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    words = query.all()
    content = {}

    for word in words:
        explanations = parse_explanations(word.explanation_items)
        if not explanations:
            continue

        key = explanations[0].chineseExplanation or word.name
        if key not in content:
            content[key] = []

        content[key].append(
            WordResult(
                id=word.id,
                        tribeId=word.tribe_id,
                        tribe=word.tribe,
                        dialect=word.dialect,
                        name=word.name,
                        pinyin=word.pinyin,
                        variant=word.variant,
                        formationWord=word.formation_word,
                        derivativeRoot=word.derivative_root,
                        frequency=word.frequency,
                        hit=word.hit,
                        dictionaryNote=word.dictionary_note,
                        sources=json.loads(word.sources or "[]"),
                        explanationItems=explanations,
                        audioItems=parse_audios(word.audio_items or "[]"),
                        word_img=word.word_img,
                        isDerivativeRoot=word.is_derivative_root,
                        isImage=word.is_image, 
                        isZuzucidian=word.is_zuzucidian,
                        isOtherDialect=word.is_other_dialect,
            )
        )

    return content


# ------------------------- API 路由 -------------------------
@router.post("/keys/")
async def search_tayal_dictionary(request: Request, db: Session = Depends(get_db)):
    """多關鍵字搜尋"""
    try:
        data = await request.json()
        words = data.get("words", [])
        tribe_name = TRIBE_MAP.get(data.get("tribe", "泰雅"), '泰雅語')
        if not words:
            return JSONResponse({"error": "查詢字詞不可為空"}, status_code=400)

        exact_match_results = {}
        fuzzy_match_results = {}

        for word in words:
            if is_chinese(word):
                results, matched_names = search_by_chinese(db, word, tribe=tribe_name)
                exact_match_results[word] = [r.dict() for r in results]

                fuzzy = fuzzy_search_by_chinese(db, word, exclude_names=matched_names, tribe=tribe_name)
                fuzzy_match_results[word] = {k: [r.dict() for r in v] for k, v in fuzzy.items()}
            else:
                results, matched_names = search(db, word, tribe=tribe_name)
                exact_match_results[word] = [r.dict() for r in results]

                fuzzy = fuzzy_search(db, word, exclude_names=matched_names, tribe=tribe_name)
                fuzzy_match_results[word] = {k: [r.dict() for r in v] for k, v in fuzzy.items()}

        return JSONResponse(
            {"exact_match_results": exact_match_results, "fuzzy_match_results": fuzzy_match_results},
            status_code=200
        )

    except Exception as e:
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/all/")
async def all_tayal_dictionary(request: Request, db: Session = Depends(get_db)):
    """查詢所有詞條。可選傳入 limit / offset 做分頁；不傳則回傳全部（維持原本行為）。"""
    try:
        try:
            body = await request.json()
            tribe = body.get('tribe', '泰雅') or '泰雅'
            limit = body.get('limit')
            offset = body.get('offset') or 0
        except Exception:
            tribe = '泰雅'
            limit = None
            offset = 0
        tribe_name = TRIBE_MAP.get(tribe, '泰雅語')
        total = db.query(Word).filter(Word.tribe == tribe_name).count()
        results = search_all(db, tribe=tribe_name, limit=limit, offset=offset)
        return JSONResponse(
            {
                "all_results": {k: [r.dict() for r in v] for k, v in results.items()},
                "total": total,
            },
            status_code=200
        )
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/key/")
async def allsearch_tayal_dictionary(request: KeywordRequest, db: Session = Depends(get_db)):
    """單一字搜尋"""
    try:
        keyword = request.keyword.strip().replace("　", "")
        if not keyword:
            return JSONResponse({"error": "查詢字詞不可為空"}, status_code=400)
        tribe_name = TRIBE_MAP.get(request.tribe or '泰雅', '泰雅語')

        if is_chinese(keyword):
            exact, matched_names = search_by_chinese(db, keyword, tribe=tribe_name)
            fuzzy = fuzzy_search_by_chinese(db, keyword, exclude_names=matched_names, tribe=tribe_name)
        else:
            exact, matched_names = search(db, keyword, tribe=tribe_name)
            fuzzy = fuzzy_search(db, keyword, exclude_names=matched_names, tribe=tribe_name)

        return JSONResponse(
            {
                "exact_match_results": {keyword: [r.dict() for r in exact]},
                "fuzzy_match_results": {keyword: {k: [r.dict() for r in v] for k, v in fuzzy.items()}},
            },
            status_code=200
        )

    except Exception as e:
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


# ------------------------- 文法資料 -------------------------

@router.get("/grammar/{tribe}")
def get_grammar(tribe: str, db: Session = Depends(get_db)):
    """查詢指定族語的所有文法章節（含規則、例句、詞綴）"""
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)

        sections = db.execute(
            text("SELECT id, section_order, section_key, title, description FROM grammar_section WHERE tribe = :tribe ORDER BY section_order"),
            {"tribe": tribe_name}
        ).fetchall()

        if not sections:
            return JSONResponse({"error": f"找不到 {tribe_name} 的文法資料"}, status_code=404)

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
                id_list = ",".join(str(i) for i in rule_ids)
                affix_rows = db.execute(
                    text(f"SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN ({id_list})")
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

        return JSONResponse({"tribe": tribe_name, "sections": result}, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


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
                WHERE s.tribe = :tribe
                  AND (r.title LIKE :kw OR r.function LIKE :kw OR r.notes LIKE :kw OR r.structure LIKE :kw)
                ORDER BY r.rule_order
            """),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        # 取各 rule 的詞綴
        rule_ids = [r[0] for r in rule_rows]
        affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
        if rule_ids:
            id_list = ",".join(str(i) for i in rule_ids)
            for r_id, affix in db.execute(
                text(f"SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN ({id_list})")
            ).fetchall():
                affix_map[r_id].append(affix)

        example_rows = db.execute(
            text("""
                SELECT e.id, e.rule_id, e.tribe_text, e.chinese_text, e.analysis
                FROM grammar_example e
                JOIN grammar_rule r  ON e.rule_id   = r.id
                JOIN grammar_section s ON r.section_id = s.id
                WHERE s.tribe = :tribe
                  AND (e.tribe_text LIKE :kw OR e.chinese_text LIKE :kw OR e.analysis LIKE :kw)
            """),
            {"tribe": tribe_name, "kw": kw}
        ).fetchall()

        affix_rows = db.execute(
            text("SELECT id, affix, affix_type, function, example_form FROM grammar_affix WHERE tribe = :tribe AND (affix LIKE :kw OR function LIKE :kw)"),
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
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/grammar/{tribe}/affixes")
def get_grammar_affixes(tribe: str, affix_type: Optional[str] = None, db: Session = Depends(get_db)):
    """取得詞綴清單
    affix_type: prefix / suffix / infix / circumfix / reduplication / auxiliary（不傳則回傳全部）
    """
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        if affix_type:
            rows = db.execute(
                text("""
                    SELECT a.id, a.affix, a.affix_type, a.function, a.example_form,
                           GROUP_CONCAT(ra.rule_id) AS rule_ids
                    FROM grammar_affix a
                    LEFT JOIN grammar_rule_affix ra ON ra.affix_id = a.id
                    WHERE a.tribe = :tribe AND a.affix_type = :at
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
                    WHERE a.tribe = :tribe
                    GROUP BY a.id
                    ORDER BY a.affix_type, a.affix
                """),
                {"tribe": tribe_name}
            ).fetchall()

        return JSONResponse({
            "tribe": tribe_name,
            "affixes": [
                {"id": r[0], "affix": r[1], "affix_type": r[2],
                 "function": r[3], "example_form": r[4],
                 "rule_ids": [int(x) for x in r[5].split(",")] if r[5] else []}
                for r in rows
            ]
        }, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/grammar/{tribe}/quiz")
def get_grammar_quiz_material(tribe: str, section_key: Optional[str] = None, db: Session = Depends(get_db)):
    """取得有例句的規則清單（用於自動生成測驗題）
    section_key: 指定章節 key（不傳則回傳全部有例句的規則）
    """
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)

        if section_key:
            rows = db.execute(
                text("""
                    SELECT r.id, r.rule_key, r.title, r.structure, r.function,
                           e.id, e.tribe_text, e.chinese_text, e.analysis
                    FROM grammar_rule r
                    JOIN grammar_section s ON r.section_id = s.id
                    JOIN grammar_example e ON e.rule_id = r.id
                    WHERE s.tribe = :tribe AND s.section_key LIKE :sk
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
                    WHERE s.tribe = :tribe
                      AND e.tribe_text IS NOT NULL AND e.tribe_text != ''
                    ORDER BY r.rule_order, e.example_order
                """),
                {"tribe": tribe_name}
            ).fetchall()

        # 取詞綴資料
        rule_ids = list({row[0] for row in rows})
        affix_map: Dict[int, list] = {rid: [] for rid in rule_ids}
        if rule_ids:
            id_list = ",".join(str(i) for i in rule_ids)
            for r_id, affix in db.execute(
                text(f"SELECT ra.rule_id, a.affix FROM grammar_rule_affix ra JOIN grammar_affix a ON a.id = ra.affix_id WHERE ra.rule_id IN ({id_list})")
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

        return JSONResponse({
            "tribe": tribe_name,
            "rules": list(rules_map.values()),
        }, status_code=200)
    except Exception as e:
        logger.exception(e)
        return JSONResponse({"error": str(e)}, status_code=500)


ILRDF_AUDIO_API = "https://e-dictionary.ilrdf.org.tw/api/app/file/download-file/"

@router.get("/audio/{file_id:path}")
async def proxy_audio(file_id: str):
    try:
        first_url = ILRDF_AUDIO_API + file_id

        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            res = await client.get(first_url)

            if res.status_code in [301, 302, 303, 307, 308]:
                final_url = res.headers.get("Location", "")
            else:
                final_url = res.text.strip()

            if not final_url or "http" not in final_url:
                return Response(content="Unable to resolve audio URL", media_type="text/plain", status_code=404)

            async with httpx.AsyncClient(timeout=15) as c2:
                audio_res = await c2.get(final_url)
                if audio_res.status_code != 200:
                    return Response(content="Audio file not found", media_type="text/plain", status_code=404)
                content_type = audio_res.headers.get("content-type", "audio/mpeg")
                return Response(content=audio_res.content, media_type=content_type)

    except httpx.ConnectError:
        return Response(content="Audio API unreachable", media_type="text/plain", status_code=503)
    except Exception as e:
        return Response(content=str(e), media_type="text/plain", status_code=500)
    

@router.get("/debug_audio/{audio_id}")
async def debug_audio(audio_id: str):

    try:
        # 使用你原本的邏輯抓音檔
        load_dotenv()
        VITE_AUDIO_FILE_URL = os.getenv("VITE_AUDIO_FILE_URL")
        first_url = VITE_AUDIO_FILE_URL + audio_id

        async with httpx.AsyncClient(follow_redirects=False) as client:
            res = await client.get(first_url)

            # 判斷是否 redirect
            if res.status_code in [301, 302, 303, 307, 308]:
                final_url = res.headers.get("Location")
            else:
                final_url = res.text.strip()

            if not final_url or "http" not in final_url:
                return {
                    "success": False,
                    "step": "resolve_redirect",
                    "raw_text": res.text
                }

        # 第二次請求真正的音檔
        async with httpx.AsyncClient() as c2:
            audio_res = await c2.get(final_url)

            target_bytes = audio_res.content

            # 回傳訊息（避免太大，只回前 50 bytes）
            return {
                "success": True,
                "download_url": final_url,
                "status_code": audio_res.status_code,
                "content_type": audio_res.headers.get("Content-Type"),
                "bytes_length": len(target_bytes),
                "bytes_preview": list(target_bytes[:50])
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/sentence-audio/")
async def get_sentence_audio(request: Request, db: Session = Depends(get_db)):
    """
    將句子拆成詞，依序查詢各詞在字典中的音檔 fileId，
    回傳有音檔的詞清單（依句子順序），供前端逐詞串接播放。
    """
    from sqlalchemy import func as sa_func
    body = await request.json()
    sentence: str = body.get("sentence", "")
    tribe: str = body.get("tribe", "布農")
    tribe_name = TRIBE_MAP.get(tribe, tribe)

    # 以空白與標點切詞，保留字母、撇號、連字號
    tokens = re.findall(r"[a-zA-ZʼʻΩ'\-]+", sentence)

    audio_tokens = []
    seen_file_ids: set = set()

    for token in tokens:
        token_lower = token.lower()
        word = db.query(Word).filter(
            Word.tribe == tribe_name,
            sa_func.lower(Word.name) == token_lower
        ).first()

        if not word:
            continue

        audios = json.loads(word.audio_items or "[]")
        if not audios:
            continue

        file_id = audios[0].get("fileId")
        if not file_id or file_id in seen_file_ids:
            continue

        seen_file_ids.add(file_id)
        audio_tokens.append({"word": token, "fileId": file_id})

    return JSONResponse({"audioTokens": audio_tokens})
