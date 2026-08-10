import asyncio
import math
import random
import threading
import time
import shutil
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Body, HTTPException, Depends, File, UploadFile, Form, Query, Request
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session
from dictionary_db.connect import get_db, SessionLocal
from dictionary_db.model import MediaAsset, Word
from dictionary_db.word_data import load_explanation_items_for_words, load_audio_items_for_words
from config.tribes import TRIBE_IDS
from config.audio_source import get_ilrdf_audio_api
from config.media_source import get_media_source_mode
from fastAPI import game_config, rate_limit_config
from fastAPI.rate_limit import limiter
from fastAPI.url_safety import UnsafeConnectionError, assert_response_from_safe_peer, is_safe_redirect_target
from .keyed_cache import KeyedCache


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

import io
import re
import requests
import httpx
from urllib.parse import urlparse
from pydub import AudioSegment
import torch
import torchaudio
import torch.nn.functional as F
import os
import soundfile as sf

# 自動偵測 ffmpeg，優先讀環境變數，找不到才用 shutil.which
# 啟動時只發出警告，呼叫 /compare_audio 時才真正檢查
import logging as _logging

def _find_ffmpeg() -> str | None:
    from_env = os.getenv("FFMPEG_PATH")
    if from_env and os.path.isfile(from_env):
        return from_env
    found = shutil.which("ffmpeg")
    return found

def _find_ffprobe() -> str | None:
    # 優先從 FFPROBE_PATH，否則從 FFMPEG_PATH 推導同目錄的 ffprobe
    from_env = os.getenv("FFPROBE_PATH")
    if from_env and os.path.isfile(from_env):
        return from_env
    ffmpeg = _find_ffmpeg()
    if ffmpeg:
        ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe")
        if os.path.isfile(ffprobe):
            return ffprobe
        # Linux/macOS 無 .exe
        ffprobe_nix = os.path.join(os.path.dirname(ffmpeg), "ffprobe")
        if os.path.isfile(ffprobe_nix):
            return ffprobe_nix
    found = shutil.which("ffprobe")
    return found

_ffmpeg_path  = _find_ffmpeg()
_ffprobe_path = _find_ffprobe()

# compare_audio 上傳的使用者錄音大小上限，避免超大音檔送進 wav2vec2 拖垮記憶體
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB

# reference_urls 是前端傳入、後端直接發 GET 請求的網址（真人參考音檔），若不限制網域，
# 等於讓伺服器變成一個開放的請求轉發器（SSRF）：可被用來對內網位址（例如雲端環境的
# metadata endpoint 169.254.169.254）或任意外部主機發出請求。只允許 Firebase Storage
# 的公開音檔網域，且限定 https。
_ALLOWED_REF_HOSTS = ("firebasestorage.googleapis.com", "storage.googleapis.com")


def _is_allowed_reference_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in _ALLOWED_REF_HOSTS)

if _ffmpeg_path:
    # 把 ffmpeg bin 目錄加進 PATH，讓 pydub subprocess 找得到 ffprobe
    _bin_dir = os.path.dirname(_ffmpeg_path)
    if _bin_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _bin_dir + os.pathsep + os.environ.get("PATH", "")
    AudioSegment.converter = _ffmpeg_path
    if _ffprobe_path:
        AudioSegment.ffprobe = _ffprobe_path
else:
    _logging.warning(
        "[quiz] 找不到 ffmpeg，語音比對功能 (/compare_audio) 將無法使用。"
        "請安裝 ffmpeg 或在 .env 設定 FFMPEG_PATH=/path/to/ffmpeg"
    )




router = APIRouter()


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


def _refresh_irt_config_if_stale() -> None:
    """從 Django 讀目前的 IRT 參數，更新這個模組的全域變數。TTL 內重複呼叫
    是no-op（快速的時間比較，不會每次都真的發請求）。Django 端讀取失敗
    （服務還沒啟動、網路問題等）時記一筆警告並保留目前的值不變——可能是
    上次成功抓到的值，也可能是上面寫死的預設值，不讓 quiz 功能因為 Django
    暫時連不上就整個壞掉，這跟 crawler 那邊「外部來源掛了就降級」是同一種
    設計精神。

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
            data = resp.json()

            ALPHA0 = data["alpha0"]
            BETA0 = data["beta0"]
            DEFAULT_GUESS = data["default_guess"]
            TYPE_AQ = {
                "word-translate": data["type_aq_word_translate"],
                "word-match": data["type_aq_word_match"],
                "sentence-fill": data["type_aq_sentence_fill"],
                "sentence-order": data["type_aq_sentence_order"],
            }
            LEARNING_RATE = data["learning_rate"]
            DQ_ALPHA = data["dq_alpha"]
            DQ_BETA = data["dq_beta"]
            DQ_GAMMA = data["dq_gamma"]
            BETA1 = data["beta1"]
            BETA2 = data["beta2"]
            BETA3 = data["beta3"]
            BETA4 = data["beta4"]
            BETA5 = data["beta5"]
            TOTAL_QUESTIONS = data["total_questions"]
        except Exception:
            _logging.warning("[quiz] 無法從後台讀取 IRT 參數，沿用目前值", exc_info=True)
        finally:
            # 失敗也更新時間戳記，避免 Django 持續連不上時，每一個請求都
            # 重新嘗試連線並等待逾時——跟成功時一樣進入下一個 TTL 週期再試。
            _irt_config_last_fetch = time.monotonic()

# ----------------------------
# Pydantic Schemas
# ----------------------------
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

# ----------------------------
# DB helper: load all words (module-level cache)
# ----------------------------
_words_cache: KeyedCache[str, List[WordDTO]] = KeyedCache()
_word_explanations_cache: Dict[str, List[dict]] = {}
_word_audios_cache: Dict[str, List[dict]] = {}

def load_all_words(db: Optional[Session] = None, tribe_id: Optional[str] = None) -> List[WordDTO]:
    """依 tribe_id 載入該族語的詞彙清單（模組級快取，每個族語第一次請求時查詢一次）。
    word id 在 words 表裡全域唯一，不同族語不會撞號，所以 explanation/audio 快取
    繼續當成單一全域字典累加即可，只有 _words_cache（出題用的候選單字清單）需要
    依族語分開存，避免出題時把不同族語的單字混在同一份候選池裡。"""
    if tribe_id in _words_cache:
        return _words_cache.get(tribe_id)
    if not db:
        return []

    def _compute():
        query = db.query(Word)
        if tribe_id:
            query = query.filter(Word.tribe_id == tribe_id)
        words = [WordDTO(id=w.id, name=w.name, frequency=w.frequency) for w in query.all()]
        _word_explanations_cache.update(load_explanation_items_for_words(db, tribe_id=tribe_id))
        _word_audios_cache.update(load_audio_items_for_words(db, tribe_id=tribe_id))
        return words

    return _words_cache.get_or_compute(tribe_id, _compute)


def warm_cache(db: Session) -> None:
    """在 app 啟動時預先為每個族語跑一次 load_all_words，
    把全表掃描的成本放在部署當下，而不是留給第一個打 quiz 的使用者請求承擔。"""
    for tribe_id in TRIBE_IDS.values():
        load_all_words(db, tribe_id)

# ----------------------------
# 出題用小工具（原本是 generate_quiz_frontend 內的巢狀函式，
# 因為只讀模組級快取＋參數都已明確傳入，不需要 closure，抽成模組層級函式）
# ----------------------------
def _get_cn(word_obj):
    items = _word_explanations_cache.get(word_obj.id, [])
    return (items[0].get('chineseExplanation') or '未知') if items else '未知'

def _get_audio(word_obj):
    items = _word_audios_cache.get(word_obj.id, [])
    return items[0].get('fileId') if items else None

def _build_translate_options(w, all_words_list):
    others = [o for o in all_words_list if o.name != w.name]
    random.shuffle(others)
    distractors = [_get_cn(o) for o in others[:3]]
    correct_cn = _get_cn(w)
    opts = [correct_cn] + distractors
    random.shuffle(opts)
    return correct_cn, opts

def _build_word_translate_question(w, all_words_list, question_id, difficulty=None, meta=None):
    correct_cn, opts = _build_translate_options(w, all_words_list)
    return {
        "id": question_id,
        "type": "word-translate",
        "payload": {"tayal": {"word": w.name, "audio": _get_audio(w)},
                    "cn": correct_cn, "options": opts},
        "difficulty": difficulty,
        "meta": meta,
    }

def _get_sentence_fill_payload(w, all_words_list):
    """嘗試從句子範例建立填空題；若無資料回傳 None"""
    items = _word_explanations_cache.get(w.id, [])
    for item in items:
        for sent in (item.get("sentenceItems") or []):
            orig = (sent.get("originalSentence") or "").strip()
            ch_sent = (sent.get("chineseSentence") or "").strip()
            if not orig or w.name not in orig:
                continue
            blank_sent = orig.replace(w.name, "___", 1)
            sent_audios = sent.get("audioItems") or []
            sent_audio = sent_audios[0].get("fileId") if sent_audios else None
            pool = [o for o in all_words_list if o.name != w.name]
            random.shuffle(pool)
            distractors = [{"word": o.name, "audio": _get_audio(o)} for o in pool[:3]]
            options = [{"word": w.name, "audio": _get_audio(w)}] + distractors
            random.shuffle(options)
            return {
                "tayal": {"word": w.name, "exsentence": orig, "sentence": blank_sent,
                          "cn": ch_sent, "audio": sent_audio},
                "options": options,
                "answer": w.name,
            }
    return None

def _get_sentence_order_payload(w, all_words_list):
    """嘗試從句子範例建立排序題；若無資料回傳 None"""
    items = _word_explanations_cache.get(w.id, [])
    for item in items:
        for sent in (item.get("sentenceItems") or []):
            orig = (sent.get("originalSentence") or "").strip()
            ch_sent = (sent.get("chineseSentence") or "").strip()
            if not orig:
                continue
            words_in_sent = orig.split()
            if len(words_in_sent) < 2:
                continue
            sent_audios = sent.get("audioItems") or []
            sent_audio = sent_audios[0].get("fileId") if sent_audios else None
            word_list = [{"word": ww, "audio": None} for ww in words_in_sent]
            return {
                "tayal": {"word": w.name, "sentence": orig, "cn": ch_sent, "audio": sent_audio},
                "words": word_list,
                "answer": words_in_sent,
            }
    return None


class _CandidatePicker:
    """依 Score 排序後的候選字清單，依序挑出下一個「尚未用過」的候選字。
    四種題型的出題迴圈共用同一個實例，確保同一次出題不會有兩題用到同一個字。"""
    def __init__(self, candidates_sorted):
        self._candidates = candidates_sorted
        self._idx = 0
        self._used = set()

    def next(self):
        while self._idx < len(self._candidates) and self._candidates[self._idx]["word"].name in self._used:
            self._idx += 1
        if self._idx >= len(self._candidates):
            return None
        c = self._candidates[self._idx]
        self._idx += 1
        self._used.add(c["word"].name)
        return c


def _build_user_model(user_data: dict) -> dict:
    return {
        "ability": user_data.get("ability", 0.5),
        "user_errors": user_data.get("user_errors", {}),
        "favorites": user_data.get("favorites", {}),
        "explorations": user_data.get("explorations", {}),
        "type_stats": user_data.get("type_stats", {
            "word-translate": {"e":0,"n":0},
            "word-match": {"e":0,"n":0},
            "sentence-fill": {"e":0,"n":0},
            "sentence-order": {"e":0,"n":0},
        })
    }

def _compute_avg_time(user_model: dict) -> float:
    all_avg_times = [sum(ue.get("recent_times", []))/len(ue.get("recent_times", []))
                     for ue in user_model.get("user_errors", {}).values() if ue.get("recent_times")]
    return sum(all_avg_times)/len(all_avg_times) if all_avg_times else 1.0

def _score_candidates(all_words: List[WordDTO], user_model: dict, theta: float, t_avg_all: float, fprime_map: Dict[str, float]) -> list:
    candidates = []
    for w in all_words:
        name = w.name
        ue = user_model.get("user_errors", {}).get(name, {})
        e_w, n_w = ue.get("errors",0), ue.get("attempts",0)
        recent_results, recent_times = ue.get("recent_results", []), ue.get("recent_times", [])
        Dw = compute_smoothed_error_rate(e_w, n_w)
        type_stats = user_model.get("type_stats", {})
        Dt_map = {tname: compute_smoothed_error_rate(st.get("e",0), st.get("n",0)) for tname, st in type_stats.items()}
        fprime = fprime_map.get(name, 0.0)
        Dt_example = Dt_map.get("word-translate", 0.5)
        Dq_example, bw_example = compute_Dq_and_bw(Dw, Dt_example, fprime)
        a_q = TYPE_AQ.get("word-translate",1.0)
        Ptheta_example = compute_P_theta(theta, bw_example, a_q, DEFAULT_GUESS)
        Delta_w = compute_delta_w(recent_results, e_w, n_w)
        T_w = compute_Tw(recent_times, t_avg_all)
        F_w = 1.0 if user_model.get("favorites", {}).get(name) else 0.0
        R_w = user_model.get("explorations", {}).get(name, 0.0)
        Bq = compute_Bq(F_w, R_w, Delta_w, T_w, fprime)
        Score = compute_score(Ptheta_example, Bq)

        candidates.append({"word": w, "Dw":Dw, "Dt_map":Dt_map, "fprime":fprime,
                           "recent_results":recent_results, "recent_times":recent_times,
                           "e_w": e_w, "n_w": n_w, "Dq_example":Dq_example, "bw_example":bw_example,
                           "Ptheta_example":Ptheta_example, "Delta_w":Delta_w, "T_w":T_w, "Bq":Bq, "Score":Score})

    return sorted(candidates, key=lambda x: x["Score"], reverse=True)

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


def _generate_word_translate_questions(picker: _CandidatePicker, all_words: List[WordDTO], theta: float, count: int) -> list:
    generated = []
    for i in range(count):
        c = picker.next()
        if not c: break
        w = c["word"]
        Dt = c["Dt_map"].get("word-translate", 0.5)
        Dq, bw = compute_Dq_and_bw(c["Dw"], Dt, c["fprime"])
        a_q = TYPE_AQ.get("word-translate", 1.0)
        Ptheta = compute_P_theta(theta, bw, a_q, DEFAULT_GUESS)
        generated.append(_build_word_translate_question(
            w, all_words, f"wt-{w.id}-{i}",
            difficulty=bw, meta={"Ptheta": Ptheta, "Bq": c["Bq"], "Dq": Dq}
        ))
    return generated

def _generate_word_match_questions(picker: _CandidatePicker, count: int) -> list:
    """每題取 5 個單詞組成配對題"""
    generated = []
    for i in range(count):
        group = []
        for _ in range(5):
            c = picker.next()
            if not c: break
            group.append(c)
        if not group: break
        pairs = [{"cn": _get_cn(gc["word"]),
                  "tayal": {"word": gc["word"].name, "audio": _get_audio(gc["word"])}}
                 for gc in group]
        generated.append({
            "id": f"wm-{i}",
            "type": "word-match",
            "payload": {"pairs": pairs},
            "difficulty": None,
            "meta": None
        })
    return generated

def _generate_sentence_fill_questions(picker: _CandidatePicker, all_words: List[WordDTO], count: int) -> list:
    generated = []
    fill_done = 0
    fallback = []
    while fill_done < count:
        c = picker.next()
        if not c: break
        w = c["word"]
        payload = _get_sentence_fill_payload(w, all_words)
        if payload:
            generated.append({
                "id": f"sf-{w.id}-{fill_done}",
                "type": "sentence-fill",
                "payload": payload,
                "difficulty": None,
                "meta": None
            })
            fill_done += 1
        else:
            fallback.append(c)
    # 若句子資料不足，以 word-translate 補足
    for c in fallback[:count - fill_done]:
        w = c["word"]
        generated.append(_build_word_translate_question(w, all_words, f"sf-fb-{w.id}"))
    return generated

def _generate_sentence_order_questions(picker: _CandidatePicker, all_words: List[WordDTO], count: int) -> list:
    generated = []
    order_done = 0
    fallback = []
    while order_done < count:
        c = picker.next()
        if not c: break
        w = c["word"]
        payload = _get_sentence_order_payload(w, all_words)
        if payload:
            generated.append({
                "id": f"so-{w.id}-{order_done}",
                "type": "sentence-order",
                "payload": payload,
                "difficulty": None,
                "meta": None
            })
            order_done += 1
        else:
            fallback.append(c)
    # 若句子資料不足，以 word-translate 補足
    for c in fallback[:count - order_done]:
        w = c["word"]
        generated.append(_build_word_translate_question(w, all_words, f"so-fb-{w.id}"))
    return generated


# ----------------------------
# API: 產生 quiz
# ----------------------------
@router.post("/generate_quiz_frontend", response_model=GenerateQuizResponse)
def generate_quiz_frontend(
    user_data: UserModelReq = Body(...),
    tribe: str = Query(default="tayal"),
    db: Session = Depends(get_db),
):
    _refresh_irt_config_if_stale()
    try:
        tribe_id = TRIBE_IDS.get(tribe)
        if not tribe_id:
            raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")
        all_words = load_all_words(db, tribe_id)
        if not all_words:
            raise HTTPException(status_code=500, detail="No words in DB")

        user_model = _build_user_model(user_data.model_dump())
        fprime_map = compute_normalized_freq_map(all_words)
        t_avg_all = _compute_avg_time(user_model)
        theta = user_model.get("ability", 0.5)

        candidates_sorted = _score_candidates(all_words, user_model, theta, t_avg_all, fprime_map)
        type_count = _compute_type_counts(theta)
        picker = _CandidatePicker(candidates_sorted)

        generated = []
        generated += _generate_word_translate_questions(picker, all_words, theta, type_count["wordTranslate"])
        generated += _generate_word_match_questions(picker, type_count["wordMatch"])
        generated += _generate_sentence_fill_questions(picker, all_words, type_count["sentenceFill"])
        generated += _generate_sentence_order_questions(picker, all_words, type_count["sentenceOrder"])

        random.shuffle(generated)
        qlist = [QuizQuestion(id=q["id"], type=q["type"], payload=q["payload"],
                              difficulty=q.get("difficulty"), meta=q.get("meta"))
                 for q in generated[:TOTAL_QUESTIONS]]
        return {"questions": qlist}
    except HTTPException:
        raise
    except Exception as e:
        # user_data 的型別已由 UserModelReq 驗證過，這裡是防禦剩餘的例外
        # （例如資料內容本身導致的執行期錯誤）；只記 log、回傳通用訊息，
        # 跟同一輪稽核的 vision.py／dictionary/search.py 同一套做法。
        _logging.exception(e)
        raise HTTPException(status_code=500, detail="伺服器發生錯誤，請稍後再試")

# ----------------------------
# API: submit answer
# ----------------------------
@router.post("/submit_answer_frontend", response_model=SubmitAnswerResp)
def submit_answer_frontend(
    body: SubmitAnswerFrontendReq = Body(...),
    tribe: str = Query(default="tayal"),
    db: Session = Depends(get_db),
):
    _refresh_irt_config_if_stale()
    try:
        tribe_id = TRIBE_IDS.get(tribe)
        if not tribe_id:
            raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")
        user_model = body.user_data.model_dump()
        answer = body.answer.model_dump()

        word_name = answer.get("word_name")
        if not word_name:
            raise HTTPException(status_code=400, detail="word_name required")
        t = answer.get("question_type")
        type_stats = user_model.get("type_stats", {})
        user_errors = user_model.get("user_errors", {})

        # 更新 type_stats
        if t not in type_stats: type_stats[t] = {"e":0,"n":0}
        type_stats[t]["n"] += 1
        if not answer.get("correct"): type_stats[t]["e"] += 1

        # 更新 user_errors
        ue = user_errors.get(word_name, {"attempts":0,"errors":0,"recent_results":[],"recent_times":[],"avg_time":0.0})
        ue["attempts"] += 1
        if not answer.get("correct"): ue["errors"] += 1
        ue["recent_results"].append(0 if answer.get("correct") else 1)
        if len(ue["recent_results"])>5: ue["recent_results"].pop(0)
        ue["recent_times"].append(answer.get("time_spent",0.0))
        if len(ue["recent_times"])>5: ue["recent_times"].pop(0)
        ue["avg_time"] = sum(ue["recent_times"])/len(ue["recent_times"])
        user_errors[word_name] = ue

        # 計算 theta
        e_w, n_w = ue["errors"], ue["attempts"]
        Dw = compute_smoothed_error_rate(e_w,n_w)
        Dt = compute_smoothed_error_rate(type_stats.get(t,{}).get("e",0), type_stats.get(t,{}).get("n",0))
        all_words = load_all_words(db, tribe_id)
        fprime_map = compute_normalized_freq_map(all_words)
        fprime = fprime_map.get(word_name,0.0)
        Dq, bw = compute_Dq_and_bw(Dw, Dt, fprime)
        a_q = TYPE_AQ.get(t,1.0)
        current_theta = user_model.get("ability",0.5)
        Ptheta = compute_P_theta(current_theta, bw, a_q, DEFAULT_GUESS)
        theta_new = update_theta(current_theta, answer.get("correct"), Ptheta, LEARNING_RATE)
        user_model["ability"] = theta_new
        user_model["type_stats"] = type_stats
        user_model["user_errors"] = user_errors

        return {"new_theta": theta_new, "updated_user_errors":{word_name:user_errors[word_name]}, "user_model":user_model}
    except HTTPException:
        raise
    except Exception as e:
        _logging.exception(e)
        raise HTTPException(status_code=500, detail="伺服器發生錯誤，請稍後再試")






def make_error(step: str, msg: str):
    """統一錯誤輸出格式"""
    return {
        "success": False,
        "error_step": step,
        "error": msg
    }


# 1. 下載語音
def _lookup_verified_audio_url(audio_id: str):
    """P5 辭典媒體自主化：查這個 file_id 是否已經有遷移完成的自有 Storage
    副本，有的話回傳 public_url，沒有回傳 None。這支函式本身是同步函式、被
    asyncio.to_thread 呼叫，不是 FastAPI request-scoped，沒有 Depends(get_db)
    可用，比照 crawler/dictionary_source.py 既有的「db = SessionLocal();
    try/finally: db.close()」慣例（跟 audio_proxy.py 的 kind 命名一致，見
    該檔案的 _AUDIO_MEDIA_KIND 說明——word_audio／sentence_audio 共用同一個
    "ilrdf_audio" kind）。"""
    db = SessionLocal()
    try:
        asset = db.query(MediaAsset).filter_by(
            source_provider="ilrdf", source_kind="ilrdf_audio", source_locator=audio_id, status="verified",
        ).first()
        return asset.public_url if asset else None
    finally:
        db.close()


def fetch_audio_from_id(audio_id: str):
    # P5 辭典媒體自主化：發音比對功能每次使用者錄音都要抓一次官方音檔，使用
    # 頻率遠高於單純播放——優先用自己 Storage 的已驗證副本，不用每次都跟
    # ILRDF 要一次。
    public_url = _lookup_verified_audio_url(audio_id)
    if public_url:
        with httpx.Client(timeout=15) as client:
            resp = client.get(public_url)
        if resp.status_code != 200:
            raise Exception(f"下載音檔失敗 (HTTP {resp.status_code})")
        return resp.content

    if get_media_source_mode() == "storage_only":
        raise Exception("音檔尚未遷移完成，暫時無法比對")

    # hybrid 模式（預設）：還沒遷移到的詞條，照舊即時代理 ILRDF，行為完全不變。
    # 網址單一資料來源見 config/audio_source.py：原本這裡跟 dictionary/
    # audio_proxy.py 的 debug_audio 各自讀環境變數，audio_proxy.py 的正式路徑
    # （proxy_audio，全站辭典發音實際在走的路徑）卻是另一個寫死的 Python 常數，
    # 三處各自一份、容易改了環境變數卻漏改寫死常數那條路徑。
    api_url = get_ilrdf_audio_api() + audio_id

    # 第一次請求取得重導向 URL
    resp = requests.get(api_url, allow_redirects=False, timeout=10)
    if resp.status_code in [301, 302, 303, 307, 308]:
        final_url = resp.headers.get("Location")
    else:
        final_url = resp.text.strip()

    if not final_url or not final_url.startswith("http"):
        raise Exception(f"無法取得真正音檔 URL: {resp.text}")

    # 第二次請求的目標網址完全由第一次請求的回應內容決定，發出前先擋掉明顯
    # 指向內網／loopback／link-local（含雲端 metadata endpoint）的位址，
    # 避免被當成 SSRF 跳板（見 url_safety.py 說明，跟 compare_audio.reference_urls
    # 已經修好的白名單機制互補）。
    if not is_safe_redirect_target(final_url):
        raise Exception("音檔 URL 指向不允許的位址")

    # 第二次請求下載真正音檔。這裡改用 httpx（而非 requests）：is_safe_redirect_target
    # 剛剛做的 DNS 解析，跟接下來實際連線時重新做的 DNS 解析是兩次獨立的查詢——
    # 如果網域在中間變更了解析結果（低 TTL、DNS rebinding），前面的檢查就形同
    # 虛設。httpx 能在連線建立「之後」告訴我們實際連到的是哪個 IP
    # （response.extensions["network_stream"]），藉此改成檢查「真正被拿去
    # 收發資料的那個位址」本身安全（見 url_safety.py 的
    # assert_response_from_safe_peer），不再只依賴檢查當下的解析結果。
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        audio_resp = client.get(final_url)
        try:
            assert_response_from_safe_peer(audio_resp)
        except UnsafeConnectionError:
            raise Exception("音檔 URL 指向不允許的位址")

    if audio_resp.status_code != 200:
        raise Exception(f"下載音檔失敗 (HTTP {audio_resp.status_code})")

    return audio_resp.content

# 2. WebM → WAV
def convert_to_wav(audio_bytes):
    try:
        audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=None)
    except Exception as e:
        _logging.warning("[quiz] 無法解碼音檔，前 10 bytes: %s", list(audio_bytes[:10]))
        raise Exception(f"無法解碼音檔：{str(e)}")

    wav_io = io.BytesIO()
    audio.export(wav_io, format="wav")
    wav_io.seek(0)
    return wav_io


# 3. bytes → tensor
def bytes_to_tensor(wav_io):
    try:
        wav_io.seek(0)
        data, sr = sf.read(wav_io)  # 用 soundfile 讀 WAV
        waveform = torch.tensor(data, dtype=torch.float32).T  # shape [channel, time]
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)
    except Exception as e:
        raise Exception(f"soundfile 無法讀 WAV：{str(e)}")

    # 多聲道轉單聲道
    if waveform.size(0) > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    return waveform, sr

# 4. wav2vec2（懶載入，第一次呼叫時才下載模型，Lock 保護執行緒安全）
_wav2vec2_model = None
_wav2vec2_lock = threading.Lock()

def get_wav2vec2():
    global _wav2vec2_model
    if _wav2vec2_model is None:
        with _wav2vec2_lock:
            if _wav2vec2_model is None:
                bundle = torchaudio.pipelines.WAV2VEC2_BASE
                _wav2vec2_model = bundle.get_model()
    return _wav2vec2_model


def _get_embedding(model, wave):
    """wav tensor → 最後一層 transformer 特徵向量"""
    features, _ = model.extract_features(wave)
    return features[-1].mean(dim=1)


def _score_from_bytes(model, user_emb, audio_bytes):
    """把 audio bytes 轉成嵌入後與 user_emb 計算相似度，回傳 0-100 分"""
    wav = convert_to_wav(audio_bytes)
    wave, _ = bytes_to_tensor(wav)
    emb = _get_embedding(model, wave)
    sim = F.cosine_similarity(user_emb, emb).item()
    return round(sim * 100, 2)


@router.post("/compare_audio/")
@limiter.limit(lambda: rate_limit_config.get_configured_rate("quiz_compare_audio", "20/minute"))  # CPU 密集的 wav2vec2 推論 + 對外下載，每用戶每分鐘最多 20 次（後台可調）
async def compare_audio(
    request: Request,
    user_audio: UploadFile = File(...),
    audio_id: str = Form(...),
    reference_urls: str = Form(default=""),   # 逗號分隔的 Firebase Storage 公開 URL
):
    if not _ffmpeg_path:
        return make_error("ffmpeg_missing", "伺服器未安裝 ffmpeg，語音比對功能暫時無法使用")

    # audio_id 會直接拼接進下載 URL（fetch_audio_from_id），先驗證格式避免路徑遍歷／SSRF
    if not re.match(r'^[a-zA-Z0-9._-]+$', audio_id):
        return make_error("invalid_audio_id", "audio_id 格式不合法")

    game_config.refresh_game_config_if_stale()
    max_audio_bytes = game_config.PRONUNCIATION_MAX_AUDIO_MB * 1024 * 1024

    try:
        # Step A — 讀取使用者錄音
        try:
            user_bytes = await user_audio.read()
        except Exception as e:
            return make_error("read_user_audio", str(e))

        if len(user_bytes) > max_audio_bytes:
            return make_error("file_too_large", f"音檔不得超過 {game_config.PRONUNCIATION_MAX_AUDIO_MB} MB")

        # Step B — 使用者錄音轉 WAV + 取得嵌入
        # 以下都是同步、CPU 密集或（下載官方音檔時）阻塞式 I/O，用 asyncio.to_thread
        # 丟到執行緒池執行，避免卡住 event loop、拖慢同一 worker 上的其他請求。
        try:
            user_wav = await asyncio.to_thread(convert_to_wav, user_bytes)
            user_wave, _ = await asyncio.to_thread(bytes_to_tensor, user_wav)
        except Exception as e:
            return make_error("convert_user_to_wav", str(e))

        try:
            model = await asyncio.to_thread(get_wav2vec2)
            user_emb = await asyncio.to_thread(_get_embedding, model, user_wave)
        except Exception as e:
            return make_error("user_embedding", str(e))

        # Step C — 官方音檔比對
        try:
            target_bytes = await asyncio.to_thread(fetch_audio_from_id, audio_id)
        except Exception as e:
            return make_error("download_target", str(e))

        try:
            official_score = await asyncio.to_thread(_score_from_bytes, model, user_emb, target_bytes)
        except Exception as e:
            return make_error("official_similarity", str(e))

        # Step D — 真人參考音檔比對（Firebase Storage 公開 URL，用 httpx 非同步抓取）
        best_ref_score = None
        if reference_urls.strip():
            urls = [u.strip() for u in reference_urls.split(",") if u.strip()][:5]
            # follow_redirects=False：即使初始網址通過白名單，也不能放行伺服器端重導向，
            # 否則白名單可被「先指到合法網域、再 302 到內網位址」繞過（redirect-based SSRF）。
            # Firebase Storage 下載網址本來就是直接回傳檔案內容，不需要重導向。
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                for url in urls:
                    if not _is_allowed_reference_url(url):
                        continue
                    try:
                        resp = await client.get(url)
                        if resp.is_redirect:
                            continue
                        ref_score = await asyncio.to_thread(_score_from_bytes, model, user_emb, resp.content)
                        if best_ref_score is None or ref_score > best_ref_score:
                            best_ref_score = ref_score
                    except Exception:
                        continue

        # Step E — 取最終分數（有真人音檔則取兩者最高）
        final_score = official_score
        if best_ref_score is not None:
            final_score = max(official_score, best_ref_score)

        return {
            "success": True,
            "score": final_score,
            "official_score": official_score,
            "ref_score": best_ref_score,
            "passed": final_score >= game_config.PRONUNCIATION_PASS_THRESHOLD,
            # 優/良/待加強三級門檻——原本完全在前端寫死（pronunciation_game.jsx
            # 的 RATING()），這裡隨分數一起回傳，前端改用這份值當顯示依據。
            "rating_thresholds": {
                "excellent": game_config.PRONUNCIATION_EXCELLENT_THRESHOLD,
                "good": game_config.PRONUNCIATION_GOOD_THRESHOLD,
                "fair": game_config.PRONUNCIATION_FAIR_THRESHOLD,
            },
        }

    except Exception as e:
        return make_error("unknown_error", str(e))
