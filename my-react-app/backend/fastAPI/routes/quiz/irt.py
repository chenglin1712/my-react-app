"""適性測驗的 IRT 超參數（可由後台 adminapi 的 IrtConfig 調整）與計算公式。

超參數是模組層級的可變全域變數，由 _refresh_irt_config_if_stale() 定期從
Django 刷新——刻意不拆成「純參數」跟「刷新機制」兩個檔案：刷新函式用
`global ALPHA0, ...` 直接重新賦值這幾個模組全域，這個寫法只有在跟參數
定義同一個模組時才會生效（換成拆到別的模組用 setattr 在正確的模組上，
反而增加一種容易忘記改的隱性耦合）；其餘子模組（generator.py／api.py）
需要讀「當下最新值」的地方一律用 `from . import irt` 再寫
`irt.DEFAULT_GUESS` 這種具名存取，不能用 `from .irt import DEFAULT_GUESS`
——後者是匯入當下就複製一份值，之後這裡刷新了也不會反映過去，等於讓
後台調整參數的功能悄悄失效。
"""
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, List

import requests

import logging as _logging

from .schemas import WordDTO

# ----------------------------
# 超參數（可由後台 adminapi 的 IrtConfig 調整，見下方 _refresh_irt_config_if_stale）
# ----------------------------
# 這裡的預設值是「後台從未設定過、或後台暫時連不上時」的退回值，刻意跟
# IrtConfig model 的欄位預設值完全一致——確保後台功能還沒接上或掛掉時，
# 算分行為維持原本這幾行數字寫死時的樣子，不會突然跳成別的數字。
ALPHA0 = 1.0
BETA0 = 1.0
DEFAULT_GUESS = 0.25
TYPE_AQ = {
    "word-translate": 1.2,
    "word-match": 1.0,
    "sentence-fill": 0.9,
    "sentence-order": 1.1,
}
LEARNING_RATE = 0.08
DQ_ALPHA = 0.45
DQ_BETA  = 0.35
DQ_GAMMA = 0.20
BETA1 = 0.2
BETA2 = 0.2
BETA3 = 0.2
BETA4 = 0.2
BETA5 = 0.2
TOTAL_QUESTIONS = 10

# Django adminapi 的公開唯讀端點（見 backend/adminapi/quizbank_views.py 的
# public_irt_config），本機開發兩個服務都跑在同一台機器上，預設值可以
# 直接指到 Django 的本機 port；正式環境兩個服務網址不同，用環境變數覆寫。
_IRT_CONFIG_URL = os.getenv("DJANGO_INTERNAL_BASE_URL", "http://127.0.0.1:8000") + "/adminapi/public/irt-config/"
# 5 分鐘——調整 IRT 參數不是秒等的即時性需求，不需要每個請求都打一次 Django；
# 跟 crawler/views.py 的 NEWS_CACHE_TTL 這類「外部資料，容忍幾分鐘內的舊值」
# 是同一種取捨。
_IRT_CONFIG_TTL_SECONDS = 300
_irt_config_last_fetch = 0.0
_irt_config_lock = threading.Lock()


@dataclass(frozen=True)
class _IrtConfigSnapshot:
    """驗證過型別、欄位齊全的 IRT 設定快照（P4 review BE-10）。原本直接對
    module global 逐欄位 `GLOBAL = data["key"]`：Django 回應如果中途缺一個
    欄位（例如後台漏填、部署時新舊欄位交接期），KeyError 只會中斷賦值序列
    ——前幾個 global 已經套用新值，後面幾個還停在舊值，變成一份「半新半舊」
    拼裝出來的設定，且外層 except Exception 只記 log、完全看不出這個更細微
    的部分失敗狀態。改成先解析成這個 immutable dataclass，任何欄位缺漏或
    型別轉換失敗都在這裡整包拋例外，呼叫端要嘛拿到完整可用的新設定、要嘛
    拿到例外，不會有第三種狀態。"""
    alpha0: float
    beta0: float
    default_guess: float
    type_aq_word_translate: float
    type_aq_word_match: float
    type_aq_sentence_fill: float
    type_aq_sentence_order: float
    learning_rate: float
    dq_alpha: float
    dq_beta: float
    dq_gamma: float
    beta1: float
    beta2: float
    beta3: float
    beta4: float
    beta5: float
    total_questions: int


def _parse_irt_config_snapshot(data: dict) -> _IrtConfigSnapshot:
    return _IrtConfigSnapshot(
        alpha0=float(data["alpha0"]),
        beta0=float(data["beta0"]),
        default_guess=float(data["default_guess"]),
        type_aq_word_translate=float(data["type_aq_word_translate"]),
        type_aq_word_match=float(data["type_aq_word_match"]),
        type_aq_sentence_fill=float(data["type_aq_sentence_fill"]),
        type_aq_sentence_order=float(data["type_aq_sentence_order"]),
        learning_rate=float(data["learning_rate"]),
        dq_alpha=float(data["dq_alpha"]),
        dq_beta=float(data["dq_beta"]),
        dq_gamma=float(data["dq_gamma"]),
        beta1=float(data["beta1"]),
        beta2=float(data["beta2"]),
        beta3=float(data["beta3"]),
        beta4=float(data["beta4"]),
        beta5=float(data["beta5"]),
        total_questions=int(data["total_questions"]),
    )


def _refresh_irt_config_if_stale() -> None:
    """從 Django 讀目前的 IRT 參數，更新這個模組的全域變數。TTL 內重複呼叫
    是no-op（快速的時間比較，不會每次都真的發請求）。Django 端讀取失敗
    （服務還沒啟動、網路問題、回應缺欄位或型別不對等）時記一筆警告並保留
    目前的值完全不變——可能是上次成功抓到的值，也可能是上面寫死的預設值，
    不讓 quiz 功能因為 Django 暫時連不上就整個壞掉，這跟 crawler 那邊
    「外部來源掛了就降級」是同一種設計精神。「完全不變」是重點：解析與
    套用分成兩步，只有整份回應都成功解析成 _IrtConfigSnapshot 之後才會
    真的寫回 module global，避免部分欄位新、部分欄位舊的中間狀態。

    這兩個函式都是同步 def（FastAPI 會丟到 thread pool 執行，不是掛在事件
    迴圈上），這裡直接用 requests 這種同步呼叫沒有阻塞事件迴圈的疑慮。
    """
    global ALPHA0, BETA0, DEFAULT_GUESS, TYPE_AQ, LEARNING_RATE
    global DQ_ALPHA, DQ_BETA, DQ_GAMMA, BETA1, BETA2, BETA3, BETA4, BETA5, TOTAL_QUESTIONS
    global _irt_config_last_fetch

    if time.monotonic() - _irt_config_last_fetch < _IRT_CONFIG_TTL_SECONDS:
        return

    with _irt_config_lock:
        # 雙重檢查鎖定：等鎖的期間可能已經有另一個請求刷新過了。
        if time.monotonic() - _irt_config_last_fetch < _IRT_CONFIG_TTL_SECONDS:
            return
        try:
            resp = requests.get(_IRT_CONFIG_URL, timeout=5)
            resp.raise_for_status()
            snapshot = _parse_irt_config_snapshot(resp.json())
        except Exception:
            _logging.warning("[quiz] 無法從後台讀取 IRT 參數，沿用目前值", exc_info=True)
        else:
            # 走到這裡代表整份回應已經完整解析、驗證過型別——一次性套用，
            # 不會有套用到一半的中間狀態。
            ALPHA0 = snapshot.alpha0
            BETA0 = snapshot.beta0
            DEFAULT_GUESS = snapshot.default_guess
            TYPE_AQ = {
                "word-translate": snapshot.type_aq_word_translate,
                "word-match": snapshot.type_aq_word_match,
                "sentence-fill": snapshot.type_aq_sentence_fill,
                "sentence-order": snapshot.type_aq_sentence_order,
            }
            LEARNING_RATE = snapshot.learning_rate
            DQ_ALPHA = snapshot.dq_alpha
            DQ_BETA = snapshot.dq_beta
            DQ_GAMMA = snapshot.dq_gamma
            BETA1 = snapshot.beta1
            BETA2 = snapshot.beta2
            BETA3 = snapshot.beta3
            BETA4 = snapshot.beta4
            BETA5 = snapshot.beta5
            TOTAL_QUESTIONS = snapshot.total_questions
        finally:
            # 失敗也更新時間戳記，避免 Django 持續連不上時，每一個請求都
            # 重新嘗試連線並等待逾時——跟成功時一樣進入下一個 TTL 週期再試。
            _irt_config_last_fetch = time.monotonic()

# ----------------------------
# 工具函數（IRT、score 計算）
# ----------------------------
def compute_normalized_freq_map(words: List[WordDTO]) -> Dict[str, float]:
    log_vals = [math.log(1 + (w.frequency or 0)) for w in words]
    max_log = max(log_vals) if log_vals else 1.0
    if max_log == 0: max_log = 1.0
    return {w.name: math.log(1 + (w.frequency or 0)) / max_log for w in words}

def compute_smoothed_error_rate(e_w: int, n_w: int, alpha0=ALPHA0, beta0=BETA0) -> float:
    return ((e_w or 0) + alpha0) / ((n_w or 0) + alpha0 + beta0)

def compute_Dq_and_bw(Dw: float, Dt: float, fprime: float, alpha=DQ_ALPHA, beta=DQ_BETA, gamma=DQ_GAMMA):
    Dq = alpha * Dw + beta * Dt + gamma * (1 - fprime)
    eps = 1e-6
    Dq_clipped = min(max(Dq, eps), 1 - eps)
    bw = math.log(Dq_clipped / (1 - Dq_clipped))
    return Dq_clipped, bw

def compute_P_theta(theta: float, bw: float, a_q: float = 1.0, C: float = DEFAULT_GUESS) -> float:
    ex = math.exp(-a_q * (theta - bw))
    return C + (1 - C) / (1 + ex)

def update_theta(theta_old: float, correct: bool, Ptheta: float, gamma: float = LEARNING_RATE) -> float:
    theta_new = theta_old + gamma * ((1 if correct else 0) - Ptheta)
    return max(0.0, min(1.0, theta_new))

def compute_delta_w(recent_results: List[int], e_w: int, n_w: int) -> float:
    D_recent = sum(recent_results) / len(recent_results) if recent_results else 0.5
    D_total = (e_w / n_w) if n_w and n_w > 0 else 0.0
    return 1.0 if D_total == 0 else D_recent / D_total

def compute_Tw(recent_times: List[float], t_avg_all: float) -> float:
    t_w = sum(recent_times) / len(recent_times) if recent_times else (t_avg_all or 1.0)
    return t_w / (t_avg_all or 1.0)

def compute_Bq(F_w: float, R_w: float, Delta_w: float, T_w: float, fprime: float) -> float:
    return (BETA1*F_w + BETA2*R_w + BETA3*Delta_w + BETA4*T_w + BETA5*fprime)

def compute_score(Ptheta: float, Bq: float) -> float:
    return Ptheta * (1 + Bq)


def _compute_type_counts(theta: float) -> Dict[str, int]:
    ratios = {'translate':0.3,'match':0.2,'fill':0.25,'order':0.25} if theta<0.7 else {'translate':0.2,'match':0.1,'fill':0.3,'order':0.4}
    type_count = {
        "wordTranslate": round(TOTAL_QUESTIONS*ratios['translate']),
        "wordMatch": round(TOTAL_QUESTIONS*ratios['match']),
        "sentenceFill": round(TOTAL_QUESTIONS*ratios['fill']),
        "sentenceOrder": round(TOTAL_QUESTIONS*ratios['order']),
    }
    tot_assigned = sum(type_count.values())
    if tot_assigned < TOTAL_QUESTIONS:
        type_count["wordTranslate"] += TOTAL_QUESTIONS - tot_assigned
    return type_count
