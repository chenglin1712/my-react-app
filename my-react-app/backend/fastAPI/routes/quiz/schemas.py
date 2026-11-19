"""適性測驗（IRT）用的 dataclass／Pydantic schema，跟演算法本身（irt.py）、
出題邏輯（generator.py）分開，方便被其他子模組單純當型別依賴匯入，不用
連帶拉進整個出題流程。"""
from dataclasses import dataclass
from typing import Annotated, Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


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

# 稽核 F16：數值欄位原本只檢查型別。ability 給 -1e308 會讓 compute_P_theta 的 math.exp 溢位，
# 次數給負數會讓平滑錯誤率的分母變 0，都是未捕捉的 500。改成在進入 handler 前就擋成 422。
#
# 只擋「會讓運算壞掉、或本來就不可能出現」的值，其餘維持寬鬆，免得擋到合法的舊資料：
# - 浮點數不接受 NaN／無限大，而且大小不超過 MAX_MAGNITUDE。只擋 NaN／無限大還不夠：
#   兩個有限的 1e308 相加就溢位成無限大，平均時間再被放進回應時會因為不是合法 JSON 而變 500。
#   不限正負：裝置時鐘被調整時算出負的作答時間是合法的。上限十億（秒的話約 31 年），遠超過實際用量。
# - 次數（作答數、錯誤數）必須是 0 以上、不超過上限；上限是為了避免超大整數在除法時轉成 float 溢位，
#   實際使用遠遠碰不到（每個單字或題型累積一千萬次）。
MAX_MAGNITUDE = 1_000_000_000
BoundedFloat = Annotated[float, Field(allow_inf_nan=False, ge=-MAX_MAGNITUDE, le=MAX_MAGNITUDE)]
BoundedInt = Annotated[int, Field(ge=-MAX_MAGNITUDE, le=MAX_MAGNITUDE)]
MAX_COUNT = 10_000_000
Count = Annotated[int, Field(ge=0, le=MAX_COUNT)]
# 每個單字只保留最近 5 筆（見 submit_answer_frontend 的 [-5:]），上限放寬到 100 擋掉誇張的大小
MAX_RECENT = 100


class SubmitAnswerReq(BaseModel):
    question_id: str
    question_type: str
    word_name: Optional[str] = None
    correct: bool
    # 這個值會被累進使用者模型的 recent_times，所以現在就擋掉 NaN／無限大，
    # 免得它被存進模型後，之後每個請求都因為 recent_times 不合法而被拒絕。
    time_spent: BoundedFloat
    # 句子填空題才會帶：學習者選的選項，以及出題時伺服器簽發的診斷 token（見 diagnosis.py）。
    selected_option: Optional[str] = Field(default=None, max_length=200)
    question_token: Optional[str] = Field(default=None, max_length=8192)

class SubmitAnswerResp(BaseModel):
    new_theta: float
    updated_user_errors: Dict[str, Any]
    user_model: Dict[str, Any]
    # 詞素診斷結果；旗標關閉、不是句子填空題、或診斷過程出錯時是 None。
    diagnosis: Optional[Dict[str, Any]] = None
    # 這次作答更新了哪一條規則的熟練度：{"rule": ID, "before": p, "after": p, "n": 次數}；沒更新是 None。
    rule_update: Optional[Dict[str, Any]] = None


# generate_quiz_frontend／submit_answer_frontend 原本都用 Body(...): dict 收
# 原始 dict，沒有 Pydantic schema，handler 裡也沒有 try/except，直接對內容做
# 連鎖 .get() 與數學運算（compute_P_theta 的 math.exp() 等）。user_data 來自
# 使用者自己帳號可寫入的 Firestore 文件（quiz_model），內容毀損或欄位型別被
# 竄改（例如 ability 傳成字串）就會一路傳進運算式才炸成未捕捉的 500。
# 這裡改用 Pydantic model：型別不對的請求在進入 handler 前就被擋成 422，
# 跟同一輪稽核的 dictionary/search.py（KeywordRequest 等）同一套做法。
class UserErrorStat(BaseModel):
    """user_errors 內單一單字的統計；缺欄位視為全新單字，補預設值。"""
    attempts: Count = 0
    errors: Count = 0
    recent_results: List[BoundedInt] = Field(default_factory=list, max_length=MAX_RECENT)
    recent_times: List[BoundedFloat] = Field(default_factory=list, max_length=MAX_RECENT)
    avg_time: BoundedFloat = 0.0

    @model_validator(mode="after")
    def _errors_cannot_exceed_attempts(self):
        if self.errors > self.attempts:
            raise ValueError("errors 不可大於 attempts")
        return self

class TypeStat(BaseModel):
    e: Count = 0
    n: Count = 0

    @model_validator(mode="after")
    def _errors_cannot_exceed_attempts(self):
        if self.e > self.n:
            raise ValueError("e 不可大於 n")
        return self

class UserModelReq(BaseModel):
    """使用者的 IRT 學習模型，對應 _build_user_model 需要用到的欄位。"""
    # ability 是學習者能力值，update_theta 一律夾在 0 到 1 之間
    ability: float = Field(default=0.5, ge=0, le=1, allow_inf_nan=False)
    user_errors: Dict[str, UserErrorStat] = Field(default_factory=dict)
    favorites: Dict[str, bool] = Field(default_factory=dict)
    explorations: Dict[str, BoundedFloat] = Field(default_factory=dict)
    type_stats: Dict[str, TypeStat] = Field(default_factory=dict)


class SubmitAnswerFrontendReq(BaseModel):
    # answer 沿用上面既有的 SubmitAnswerReq（欄位本來就對應前端
    # quiz_recommon_question.jsx 送出的 answer 物件形狀）。
    user_data: UserModelReq = Field(default_factory=UserModelReq)
    answer: SubmitAnswerReq
