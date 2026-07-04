import math
import random
import threading
import shutil
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Body, HTTPException, Depends, File, UploadFile, Form
from pydantic import BaseModel

from sqlalchemy.orm import Session
from fastAPI.routes.connect import get_db
from fastAPI.routes.model import Word
from fastAPI.routes.word_data import load_explanation_items_for_words, load_audio_items_for_words

import io
import requests
from pydub import AudioSegment
import torch
import torchaudio
import torch.nn.functional as F
from dotenv import load_dotenv
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
# 超參數
# ----------------------------
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

# ----------------------------
# 工具函數（IRT、score 計算）
# ----------------------------
def compute_normalized_freq_map(words: List[Word]) -> Dict[str, float]:
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
_words_cache: List[Word] = []
_word_explanations_cache: Dict[str, List[dict]] = {}
_word_audios_cache: Dict[str, List[dict]] = {}
_words_cache_lock = threading.Lock()

def load_all_words(db: Optional[Session] = None) -> List[Word]:
    global _words_cache, _word_explanations_cache, _word_audios_cache
    if _words_cache:
        return _words_cache
    if not db:
        return []
    with _words_cache_lock:
        if not _words_cache:
            _words_cache = db.query(Word).all()
            _word_explanations_cache = load_explanation_items_for_words(db)
            _word_audios_cache = load_audio_items_for_words(db)
    return _words_cache


def warm_cache(db: Session) -> None:
    """在 app 啟動時預先跑一次 load_all_words，
    把全表掃描的成本放在部署當下，而不是留給第一個打 quiz 的使用者請求承擔。"""
    load_all_words(db)

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

def _score_candidates(all_words: List[Word], user_model: dict, theta: float, t_avg_all: float, fprime_map: Dict[str, float]) -> list:
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


def _generate_word_translate_questions(picker: _CandidatePicker, all_words: List[Word], theta: float, count: int) -> list:
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

def _generate_sentence_fill_questions(picker: _CandidatePicker, all_words: List[Word], count: int) -> list:
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

def _generate_sentence_order_questions(picker: _CandidatePicker, all_words: List[Word], count: int) -> list:
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
def generate_quiz_frontend(user_data: dict = Body(...), db: Session = Depends(get_db)):
    all_words = load_all_words(db)
    if not all_words:
        raise HTTPException(status_code=500, detail="No words in DB")

    user_model = _build_user_model(user_data)
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

# ----------------------------
# API: submit answer
# ----------------------------
@router.post("/submit_answer_frontend", response_model=SubmitAnswerResp)
def submit_answer_frontend(body: dict = Body(...), db: Session = Depends(get_db)):
    user_model = body.get("user_data", {})
    answer = body.get("answer", {})

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
    all_words = load_all_words(db)
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






def make_error(step: str, msg: str):
    """統一錯誤輸出格式"""
    return {
        "success": False,
        "error_step": step,
        "error": msg
    }


# 1. 下載語音
def fetch_audio_from_id(audio_id: str):
    load_dotenv()
    VITE_AUDIO_FILE_URL = os.getenv("VITE_AUDIO_FILE_URL")
    if not VITE_AUDIO_FILE_URL:
        raise EnvironmentError(
            "環境變數 VITE_AUDIO_FILE_URL 未設定，語音比對功能無法使用。"
            "請在 .env 填入音檔 API URL。"
        )
    api_url = VITE_AUDIO_FILE_URL + audio_id

    # 第一次請求取得重導向 URL
    resp = requests.get(api_url, allow_redirects=False, timeout=10)
    if resp.status_code in [301, 302, 303, 307, 308]:
        final_url = resp.headers.get("Location")
    else:
        final_url = resp.text.strip()

    if not final_url or not final_url.startswith("http"):
        raise Exception(f"無法取得真正音檔 URL: {resp.text}")

    # 第二次請求下載真正音檔
    audio_resp = requests.get(final_url, timeout=15)
    if audio_resp.status_code != 200:
        raise Exception(f"下載音檔失敗 (HTTP {audio_resp.status_code})")

    return audio_resp.content

# 2. WebM → WAV
def convert_to_wav(audio_bytes):
    try:
        audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=None)
    except Exception as e:
        print("DEBUG: 無法解碼音檔，前 10 bytes:", list(audio_bytes[:10]))
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
async def compare_audio(
    user_audio: UploadFile = File(...),
    audio_id: str = Form(...),
    reference_urls: str = Form(default=""),   # 逗號分隔的 Firebase Storage 公開 URL
):
    if not _ffmpeg_path:
        return make_error("ffmpeg_missing", "伺服器未安裝 ffmpeg，語音比對功能暫時無法使用")
    try:
        # Step A — 讀取使用者錄音
        try:
            user_bytes = await user_audio.read()
        except Exception as e:
            return make_error("read_user_audio", str(e))

        # Step B — 使用者錄音轉 WAV + 取得嵌入
        try:
            user_wav = convert_to_wav(user_bytes)
            user_wave, _ = bytes_to_tensor(user_wav)
        except Exception as e:
            return make_error("convert_user_to_wav", str(e))

        try:
            model = get_wav2vec2()
            user_emb = _get_embedding(model, user_wave)
        except Exception as e:
            return make_error("user_embedding", str(e))

        # Step C — 官方音檔比對
        try:
            target_bytes = fetch_audio_from_id(audio_id)
        except Exception as e:
            return make_error("download_target", str(e))

        try:
            official_score = _score_from_bytes(model, user_emb, target_bytes)
        except Exception as e:
            return make_error("official_similarity", str(e))

        # Step D — 真人參考音檔比對（Firebase Storage 公開 URL，用 httpx 非同步抓取）
        best_ref_score = None
        if reference_urls.strip():
            import httpx
            urls = [u.strip() for u in reference_urls.split(",") if u.strip()][:5]
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                for url in urls:
                    try:
                        resp = await client.get(url)
                        ref_score = _score_from_bytes(model, user_emb, resp.content)
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
            "passed": final_score >= 70,
        }

    except Exception as e:
        return make_error("unknown_error", str(e))
