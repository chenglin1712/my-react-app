"""服務對服務的內部端點——目前只有一個：P4 辭典管理寫入辭典資料庫後，
Django 通知 FastAPI 清除已經算好的辭典/文法快取。

刻意獨立成一個檔案、掛在 /internal 前綴（不是 /api/v1），跟公開 API
明確分開；也刻意不掛 verify_firebase_token 依賴——Django 這邊呼叫端沒有
使用者的 Firebase ID Token 可以附，硬簽一個只會把 Firebase 憑證塞進不需要
它的服務對服務路徑，改用共用密鑰（見 _check_internal_secret）。

跟 quiz.py 的 IRT 參數輪詢是相反方向、不同形狀的兩件事：那邊是「FastAPI
定期拉 Django 的公開設定值」（config polling），這裡是「Django 主動推播
通知 FastAPI 清快取」（write-triggered invalidation）——因為辭典寫入是
不定期發生的動作，用輪詢會讓管理者改完內容後要等到下一個 TTL 週期才生效，
不如讓 Django 寫完直接通知。
"""
import hmac
import logging
import os
import threading

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config.tribes import TRIBES, resolve_tribe_name
from dictionary_db.connect import SessionLocal

from . import listening, sentence
from .dictionary import grammar, search
from .quiz import repository as quiz

router = APIRouter()
logger = logging.getLogger(__name__)

_VALID_SCOPES = frozenset({"words", "grammar", "grammar_affixes", "grammar_quiz", "all"})

# listening._valid_words_cache／sentence._unique_sentences_cache／
# quiz._words_cache 這三個模組級快取原本完全不受這支端點管轄，寫入辭典資料
# 後只清了 search._tribe_words_cache，這三個要等 FastAPI 重啟才會反映新內容
# （P5 辭典媒體自主化：遷移腳本跑完後這三個端點的音檔連結也要跟著更新，
# 才會一起補上）。這三個快取都是用 tribe_id（UUID）當 key，不是 tribe_name，
# 這裡建一份對照表做轉換。
_TRIBE_ID_BY_NAME = {t.full_name: t.id for t in TRIBES}


class InvalidateRequest(BaseModel):
    scopes: list[str] = Field(default_factory=lambda: ["all"])
    tribes: list[str] | None = None


def _check_internal_secret(x_internal_secret: str | None) -> None:
    """跟 auth.py 的 verify_firebase_token 對「服務未設定」同一種 fail-closed
    態度：INTERNAL_API_SECRET 沒設定時一律 503，不是靜默放行讓端點形同無驗證。
    比對用 hmac.compare_digest 而非 ==，避免時序攻擊洩漏密鑰長度/內容
    （這個端點雖然是內部端點，但一樣暴露在網路上，沒有理由用較弱的比對）。
    """
    secret = os.getenv("INTERNAL_API_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="internal secret 未設定")
    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, secret):
        raise HTTPException(status_code=401, detail="unauthorized")


def _resolve_tribe_names(tribes: list[str] | None) -> list[str]:
    """接受 slug／簡稱／全名（沿用 resolve_tribe_name），未指定時代表全部族語。"""
    if not tribes:
        return [t.full_name for t in TRIBES]
    resolved = []
    for tribe in tribes:
        try:
            resolved.append(resolve_tribe_name(tribe))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return resolved


def _rewarm(tribe_names: list[str]) -> None:
    """失效之後不背景重新預熱的話，下一個真人請求要承擔全表掃描的代價
    （泰雅語 6,202 筆詞條實測約 11.7 秒）——比照 main.py 的 _warm_caches()
    同一種「背景執行緒 + 個別 try/except」寫法，只是這裡只重新暖指定的
    幾個族語，不是全部。文法快取（_grammar_cache／_grammar_quiz_cache）
    本來就不在啟動時預熱（dictionary.warm_cache 只暖 search 這邊），這裡
    同樣不主動重新查——留給下一次真人請求時 lazy 補上即可，沒有 11.7 秒
    那種扎眼的延遲代價。
    """
    db: Session = SessionLocal()
    try:
        for tribe_name in tribe_names:
            try:
                search._load_tribe_words(db, tribe_name)
            except Exception:
                logger.exception("辭典快取重新預熱失敗：%s", tribe_name)

            tribe_id = _TRIBE_ID_BY_NAME.get(tribe_name)
            if not tribe_id:
                continue
            try:
                listening._load_valid_words(db, tribe_id)
            except Exception:
                logger.exception("listening 快取重新預熱失敗：%s", tribe_name)
            try:
                sentence._load_unique_sentences(db, tribe_id)
            except Exception:
                logger.exception("sentence 快取重新預熱失敗：%s", tribe_name)
            try:
                quiz.load_all_words(db, tribe_id)
            except Exception:
                logger.exception("quiz 快取重新預熱失敗：%s", tribe_name)
    finally:
        db.close()


@router.post("/cache/invalidate")
def invalidate_cache(
    body: InvalidateRequest,
    request: Request,
    x_internal_secret: str | None = Header(default=None),
):
    _check_internal_secret(x_internal_secret)

    scopes = set(body.scopes) or {"all"}
    unknown = scopes - _VALID_SCOPES
    if unknown:
        raise HTTPException(status_code=400, detail=f"不支援的 scope：{'、'.join(sorted(unknown))}")
    if "all" in scopes:
        scopes = _VALID_SCOPES - {"all"}

    tribe_names = _resolve_tribe_names(body.tribes)

    invalidated = {"words": 0, "grammar": 0, "grammar_affixes": 0, "grammar_quiz": 0}

    if "words" in scopes:
        for name in tribe_names:
            if search._tribe_words_cache.invalidate(name):
                invalidated["words"] += 1

            tribe_id = _TRIBE_ID_BY_NAME.get(name)
            if tribe_id:
                listening._valid_words_cache.invalidate(tribe_id)
                sentence._unique_sentences_cache.invalidate(tribe_id)
                quiz._words_cache.invalidate(tribe_id)

        # _word_explanations_cache／_word_audios_cache 是用 word_id 當 key 的
        # 全域字典，不是照族語分開存，沒辦法只清特定族語的部分——乾脆整個清掉，
        # 下次 quiz.load_all_words() 被呼叫（含上面的背景重新預熱）時會自然
        # 重新填值，成本遠低於讓內容改完之後繼續回傳舊音檔連結。
        quiz._word_explanations_cache.clear()
        quiz._word_audios_cache.clear()

    if "grammar" in scopes:
        for name in tribe_names:
            if grammar._grammar_cache.invalidate(name):
                invalidated["grammar"] += 1

    if "grammar_quiz" in scopes:
        for name in tribe_names:
            if grammar._grammar_quiz_cache.invalidate(name):
                invalidated["grammar_quiz"] += 1

    if "grammar_affixes" in scopes:
        # key 是 (tribe_name, affix_type) 複合值，affix_type 還包含代表
        # 「沒帶 affix_type」的空字串——用 keys() 找出屬於這幾個族語的全部
        # key 逐一清除，而不是自己重新組一份「全部 affix_type + 空字串」
        # 的清單（那份清單得跟 grammar.py 的 _VALID_AFFIX_TYPES 手動同步，
        # 容易兩邊對不上）。
        target_tribes = set(tribe_names)
        for key in grammar._grammar_affixes_cache.keys():
            tribe_name, _affix_type = key
            if tribe_name in target_tribes and grammar._grammar_affixes_cache.invalidate(key):
                invalidated["grammar_affixes"] += 1

    if invalidated["words"] > 0:
        threading.Thread(target=_rewarm, args=(tribe_names,), daemon=True).start()
        rewarm_status = "scheduled"
    else:
        rewarm_status = "skipped"

    logger.info(
        "辭典快取已失效：scopes=%s tribes=%s invalidated=%s",
        sorted(scopes), tribe_names, invalidated,
    )
    return {"invalidated": invalidated, "rewarm": rewarm_status}
