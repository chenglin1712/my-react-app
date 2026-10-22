"""各個 AI 功能使用的模型、effort 與輸出上限——單一來源，Django（AIModel）與
FastAPI（翻譯）兩個 process 共用，只靠環境變數與這裡的預設值決定，不依賴資料庫
（FastAPI 沒有 Django ORM，跨服務讀設定的做法見 adminapi/rate_limits.py 的說明，
那是另一種成本；這裡的設定不需要秒級即時生效，部署時調環境變數即可）。

功能（feature）：
  chat       AI 助手聊天（一般對話、學習狀況分析）
  plan       AI 助手的讀書計畫（結構化輸出，只回 JSON）
  review     錯題／句子補充說明
  translate  族語翻譯
  route      意圖路由：先用便宜的模型判斷訊息屬於哪一類，再決定怎麼回（路線圖 #8）
  light      閒聊的簡短回覆（意圖路由判斷為閒聊時使用，不查辭典、不讀學習資料）
  quiz_draft 後台 AI 產生題目草稿（路線圖 #23，一律進人工審核）

預設模型的優先順序：LLM_MODEL_<FEATURE> > 該功能自己的預設（route、light 是 Haiku）> LLM_MODEL > DEFAULT_MODEL。
route、light 刻意不跟著 LLM_MODEL 走：它們存在的目的就是比主模型便宜，全域換成更大的模型時不該連帶變貴。

環境變數（FEATURE 為上面四個名稱的大寫）：
  LLM_MODEL                全部功能預設使用的模型
  LLM_MODEL_<FEATURE>      單一功能的模型，優先於 LLM_MODEL
  LLM_EFFORT_<FEATURE>     單一功能的 effort：low／medium／high／xhigh／max；
                           設為空字串或 default 代表不傳（使用模型預設值）
  LLM_MAX_TOKENS_<FEATURE> 單一功能的 max_tokens（含思考用掉的 token）

不傳 temperature／top_p：新模型多半不接受非預設值，維持之前的行為。
不設定 thinking：Sonnet 5 與 5.5 對「停用思考」的寫法不同（5.5 會直接回 400），
思考深度改由 effort 控制；max_tokens 要把思考用掉的 token 一併算進去。
"""
import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# 意圖路由與閒聊用的輕量模型（價目見 adminapi/ai_usage.py）
LIGHT_MODEL = "claude-haiku-5-5"

# Claude Sonnet 5——此專案的用途是短句翻譯／學生對話回覆，不需要 Opus 5 的
# 最強推理能力；Sonnet 5 品質已足夠，成本約為 Opus 5 的 4 折（經使用者確認）。
DEFAULT_MODEL = "claude-sonnet-5"

VALID_EFFORTS = ("low", "medium", "high", "xhigh", "max")

# max_tokens 的合理範圍：下限防止設成 0 或個位數導致回覆被截斷成空字串；
# 上限是目前模型的單次輸出上限（128K），超過 API 會直接回 400。
_MIN_MAX_TOKENS = 64
_MAX_MAX_TOKENS = 128000


@dataclass(frozen=True)
class _FeatureDefaults:
    # None 代表「不傳 effort」，使用模型的預設值（維持原本行為）。
    effort: Optional[str]
    max_tokens: int
    # None 代表沿用 LLM_MODEL／DEFAULT_MODEL
    model: Optional[str] = None


# 讀書計畫已拆成專用的結構化輸出呼叫（plan，路線圖 #10），chat 只剩短回覆，
# 之後有評測資料（#29）再決定是否把 chat 降到 low；目前維持 medium 不擅自改品質。
# review 是 50 字內的補充說明，low 即可。translate 的輸出是帶證據的 JSON 且
# 翻譯品質是核心，維持模型預設，不擅自降低。
# max_tokens 都留了思考所需的空間（思考用掉的 token 也算在 max_tokens 內）。
_FEATURE_DEFAULTS = {
    "chat": _FeatureDefaults(effort="medium", max_tokens=4096),
    "plan": _FeatureDefaults(effort="medium", max_tokens=4096),
    # 結構化輸出（四個分欄的 JSON）比純文字長，思考也算在 max_tokens 內
    "review": _FeatureDefaults(effort="low", max_tokens=2048),
    "translate": _FeatureDefaults(effort=None, max_tokens=4096),
    # 分類輸出只有一小段 JSON；effort 不傳（Haiku 是否接受 effort 參數未經實測，傳錯會整個 400），
    # 之後實測可以用 LLM_EFFORT_ROUTE 打開。
    "route": _FeatureDefaults(effort=None, max_tokens=256, model=LIGHT_MODEL),
    "light": _FeatureDefaults(effort=None, max_tokens=512, model=LIGHT_MODEL),
    # 後台「AI 產生題目草稿」（路線圖 #23）：結構化輸出的情境題，產生後一律進人工審核；
    # 要換更強的模型用 LLM_MODEL_QUIZ_DRAFT（例如 claude-opus-5-5）。
    "quiz_draft": _FeatureDefaults(effort="medium", max_tokens=6144),
    # 評測的模型評審（路線圖 #29）：用比被評測對象更強的模型打分數，只在離線評測指令裡使用，不在學生流程裡。
    # 評審刻意固定用 Opus 5.5（LLM_MODEL_EVAL_JUDGE 可覆寫）；被評測的模型換了，評審不應該跟著換，分數才可比較。
    "eval_judge": _FeatureDefaults(effort="medium", max_tokens=1024, model="claude-opus-5-5"),
}

FEATURES = tuple(_FEATURE_DEFAULTS)


@dataclass(frozen=True)
class LLMSettings:
    feature: str
    model: str
    effort: Optional[str]
    max_tokens: int


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


def _resolve_model(feature: str, feature_default: Optional[str]) -> str:
    return (
        _clean(os.getenv(f"LLM_MODEL_{feature.upper()}"))
        or feature_default
        or _clean(os.getenv("LLM_MODEL"))
        or DEFAULT_MODEL
    )


def _resolve_effort(feature: str, default: Optional[str]) -> Optional[str]:
    name = f"LLM_EFFORT_{feature.upper()}"
    raw = os.getenv(name)
    if raw is None:
        return default
    value = _clean(raw).lower()
    if value in ("", "default"):
        return None
    if value in VALID_EFFORTS:
        return value
    logger.warning("[config.llm_settings] %s=%r 不是合法的 effort（%s），改用預設值", name, raw, "/".join(VALID_EFFORTS))
    return default


def _resolve_max_tokens(feature: str, default: int) -> int:
    name = f"LLM_MAX_TOKENS_{feature.upper()}"
    raw = os.getenv(name)
    if raw is None or _clean(raw) == "":
        return default
    try:
        value = int(_clean(raw))
    except ValueError:
        value = None
    if value is None or not (_MIN_MAX_TOKENS <= value <= _MAX_MAX_TOKENS):
        logger.warning(
            "[config.llm_settings] %s=%r 不是 %d~%d 之間的整數，改用預設值 %d",
            name, raw, _MIN_MAX_TOKENS, _MAX_MAX_TOKENS, default,
        )
        return default
    return value


def get_settings(feature: str) -> LLMSettings:
    """回傳該功能目前生效的設定。每次呼叫都重新讀環境變數（成本可忽略），
    測試用 patch.dict("os.environ") 即可切換，不需要清快取。"""
    defaults = _FEATURE_DEFAULTS.get(feature)
    if defaults is None:
        raise ValueError(f"未知的 LLM 功能名稱：{feature!r}（可用：{', '.join(FEATURES)}）")
    return LLMSettings(
        feature=feature,
        model=_resolve_model(feature, defaults.model),
        effort=_resolve_effort(feature, defaults.effort),
        max_tokens=_resolve_max_tokens(feature, defaults.max_tokens),
    )
