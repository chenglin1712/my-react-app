"""適性測驗（IRT）用的 dataclass／Pydantic schema，跟演算法本身（irt.py）、
出題邏輯（generator.py）分開，方便被其他子模組單純當型別依賴匯入，不用
連帶拉進整個出題流程。"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class WordDTO:
    """出題快取用的最小快照，只帶這支檔案實際會用到的欄位。原本快取直接存
    SQLAlchemy ORM 物件（db.query(Word).all()），這些物件跟建立當下的 db
    session 綁在一起；session 關閉後物件雖然還留在記憶體快取裡，若之後有程式碼
    去讀取沒有預先載入的欄位或關聯（例如 Word.tribe_ref，lazy-loaded 關聯），
    會觸發 SQLAlchemy 嘗試用已關閉的 session 重新查詢，丟 DetachedInstanceError。
    快照成獨立的 DTO 後，快取內容完全跟 session 生命週期脫鉤，也不可能不小心
    誤用到 ORM 物件上其他沒被快取到的欄位／關聯。"""
    id: str
    name: str
    frequency: Optional[int]


class QuizQuestion(BaseModel):
    id: str
    type: str
    payload: Dict[str, Any]
    difficulty: Optional[float] = None
    meta: Optional[Dict[str, Any]] = None

class GenerateQuizResponse(BaseModel):
    questions: List[QuizQuestion]

class SubmitAnswerReq(BaseModel):
    question_id: str
    question_type: str
    word_name: Optional[str] = None
    correct: bool
    time_spent: float

class SubmitAnswerResp(BaseModel):
    new_theta: float
    updated_user_errors: Dict[str, Any]
    user_model: Dict[str, Any]


# generate_quiz_frontend／submit_answer_frontend 原本都用 Body(...): dict 收
# 原始 dict，沒有 Pydantic schema，handler 裡也沒有 try/except，直接對內容做
# 連鎖 .get() 與數學運算（compute_P_theta 的 math.exp() 等）。user_data 來自
# 使用者自己帳號可寫入的 Firestore 文件（quiz_model），內容毀損或欄位型別被
# 竄改（例如 ability 傳成字串）就會一路傳進運算式才炸成未捕捉的 500。
# 這裡改用 Pydantic model：型別不對的請求在進入 handler 前就被擋成 422，
# 跟同一輪稽核的 dictionary/search.py（KeywordRequest 等）同一套做法。
class UserErrorStat(BaseModel):
    """user_errors 內單一單字的統計；缺欄位視為全新單字，補預設值。"""
    attempts: int = 0
    errors: int = 0
    recent_results: List[int] = Field(default_factory=list)
    recent_times: List[float] = Field(default_factory=list)
    avg_time: float = 0.0

class TypeStat(BaseModel):
    e: int = 0
    n: int = 0

class UserModelReq(BaseModel):
    """使用者的 IRT 學習模型，對應 _build_user_model 需要用到的欄位。"""
    ability: float = 0.5
    user_errors: Dict[str, UserErrorStat] = Field(default_factory=dict)
    favorites: Dict[str, bool] = Field(default_factory=dict)
    explorations: Dict[str, float] = Field(default_factory=dict)
    type_stats: Dict[str, TypeStat] = Field(default_factory=dict)


class SubmitAnswerFrontendReq(BaseModel):
    # answer 沿用上面既有的 SubmitAnswerReq（欄位本來就對應前端
    # quiz_recommon_question.jsx 送出的 answer 物件形狀）。
    user_data: UserModelReq = Field(default_factory=UserModelReq)
    answer: SubmitAnswerReq
