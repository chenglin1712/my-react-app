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
    '泰雅': '泰雅語',
    '阿美': '阿美語',
    '布農': '布農語',
    '葛瑪蘭': '葛瑪蘭語',
    '排灣': '排灣語',
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

def search_all(db: Session, tribe: str = '泰雅語') -> Dict[str, List[WordResult]]:
    """回傳所有詞條"""
    words = db.query(Word).filter(Word.tribe == tribe).all()
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
    """查詢所有詞條"""
    try:
        try:
            body = await request.json()
            tribe = body.get('tribe', '泰雅') or '泰雅'
        except Exception:
            tribe = '泰雅'
        tribe_name = TRIBE_MAP.get(tribe, '泰雅語')
        results = search_all(db, tribe=tribe_name)
        return JSONResponse({"all_results": {k: [r.dict() for r in v] for k, v in results.items()}}, status_code=200)
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
    """查詢指定族語的文法章節"""
    try:
        tribe_name = TRIBE_MAP.get(tribe, tribe)
        rows = db.execute(
            text("SELECT section_order, section_key, title, content FROM grammar WHERE tribe = :tribe ORDER BY section_order"),
            {"tribe": tribe_name}
        ).fetchall()
        if not rows:
            return JSONResponse({"error": f"找不到 {tribe_name} 的文法資料"}, status_code=404)
        sections = [
            {
                "order": row[0],
                "section_key": row[1],
                "title": row[2],
                "content": json.loads(row[3]),
            }
            for row in rows
        ]
        return JSONResponse({"tribe": tribe_name, "sections": sections}, status_code=200)
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
