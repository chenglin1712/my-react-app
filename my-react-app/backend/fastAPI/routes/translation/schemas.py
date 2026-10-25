"""族語翻譯功能的 API request/response schema。欄位命名比照
backend/fastAPI/routes/dictionary/schemas.py 的既有慣例：直接宣告成前端
要的 camelCase，不用 alias_generator。"""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    tribe: str = Field(max_length=20)   # slug：tayal/amis/bunun/kavalan/paiwan（跟 AI/quiz/game 端點同慣例）
    direction: Literal["zh2tribe", "tribe2zh"]


class TokenOut(BaseModel):
    surface: str
    status: Literal["headword", "attested", "derived", "unsupported", "punct"]
    wordId: Optional[str] = None
    lemma: Optional[str] = None
    gloss: Optional[str] = None
    audioFileId: Optional[str] = None
    note: Optional[str] = None
    sentenceRef: Optional[int] = None


class CoverageOut(BaseModel):
    total: int
    headword: int
    attested: int
    derived: int
    unsupported: int
    corroboratedRatio: float


class EvidenceSentenceOut(BaseModel):
    id: int
    original: str
    chinese: str
    audioFileId: Optional[str] = None
    score: float


class EvidenceWordOut(BaseModel):
    id: str
    name: str
    gloss: Optional[str] = None
    audioFileId: Optional[str] = None


class EvidenceOut(BaseModel):
    sentences: list[EvidenceSentenceOut] = []
    words: list[EvidenceWordOut] = []


class GuestQuotaOut(BaseModel):
    limit: int
    remaining: int
    resetsAt: str       # 下一個台灣午夜，ISO 8601（含 +08:00）


class GuestTokenOut(BaseModel):
    token: str
    expiresAt: str      # ISO 8601，憑證到期時間


class GuestQuotaStatusResponse(BaseModel):
    isGuest: bool
    limit: Optional[int] = None
    remaining: Optional[int] = None
    resetsAt: Optional[str] = None


class TranslateResponse(BaseModel):
    direction: Literal["zh2tribe", "tribe2zh"]
    tribe: str          # 族語全名，例如「泰雅語」
    tribeSlug: str
    sourceText: str
    translation: str
    matchType: Literal["exact_corpus", "grounded", "generated"]
    confidence: Literal["high", "medium", "low"]
    tokenSide: Literal["target", "source"]
    tokens: list[TokenOut]
    coverage: CoverageOut
    warning: Optional[str] = None
    evidence: EvidenceOut
    notes: str
    modelUsed: Optional[str] = None
    elapsedMs: int
    # 只有訪客才有：本次之後今天還剩幾次
    guestQuota: Optional[GuestQuotaOut] = None


class TribeCapabilityOut(BaseModel):
    tribeSlug: str
    tribeName: str
    pairCount: int
    headwordCount: int
    hasSentenceAudio: bool


class CapabilitiesResponse(BaseModel):
    tribes: list[TribeCapabilityOut]
