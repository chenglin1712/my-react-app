"""詞形分析端點的 request/response schema。欄位命名比照 translation/schemas.py：
直接宣告成前端要的 camelCase，不用 alias_generator。"""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    tribe: str = Field(max_length=20)       # slug：tayal/amis/bunun/kavalan/paiwan
    word: str = Field(min_length=1, max_length=40)


class SegmentOut(BaseModel):
    text: str
    kind: Literal["root", "affix", "redup"]


class RuleOut(BaseModel):
    marker: str                              # 例如 "ma-"、"-em-"、"ma-…-ay"、"重疊2"
    kind: Literal["P", "S", "I", "C", "R"]
    function: Optional[str] = None           # 詞綴功能說明；查不到就是 None，不編造


class ExampleOut(BaseModel):
    original: str
    chinese: str
    audioFileId: Optional[str] = None
    isTokenSource: bool = False              # True＝這個詞形本身就出現在這個例句裡


class CandidateOut(BaseModel):
    # dictionary：辭典本身標註的詞根；rule：從辭典歸納出的詞綴規則推得；
    # similar：只是拼寫相近的詞（編輯距離），不是形態分析，僅供「你是不是想找」。
    source: Literal["dictionary", "rule", "similar"]
    # dictionary：辭典標註；high：通過獨立測試校準的規則；medium：從辭典歸納但未通過
    # 校準的規則；low：只是拼寫相近。
    confidence: Literal["dictionary", "high", "medium", "low"]
    root: str
    rootWordIds: list[str] = []
    gloss: Optional[str] = None
    audioFileId: Optional[str] = None
    segments: Optional[list[SegmentOut]] = None
    rule: Optional[RuleOut] = None
    distance: Optional[int] = None
    examples: list[ExampleOut] = []


class TokenInfoOut(BaseModel):
    status: Literal["headword", "attested", "unknown"]
    lemma: Optional[str] = None
    gloss: Optional[str] = None
    audioFileId: Optional[str] = None
    wordIds: list[str] = []
    attestedSentence: Optional[ExampleOut] = None


class AnalyzeResponse(BaseModel):
    tribe: str
    tribeSlug: str
    input: str
    normalized: str
    token: TokenInfoOut
    candidates: list[CandidateOut]
    rulesAvailable: bool                     # 這個族語的衍生詞資料夠不夠歸納詞綴規則
    admittedRuleCount: int                   # 通過獨立測試校準的規則數（0＝該族沒有可高信心使用的規則）
    notes: list[str] = []
