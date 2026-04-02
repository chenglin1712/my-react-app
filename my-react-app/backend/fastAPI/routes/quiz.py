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

import io
import requests
from pydub import AudioSegment
import torch
import torchaudio
import torch.nn.functional as F
from dotenv import load_dotenv
import os
import json
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

_ffmpeg_path = _find_ffmpeg()
if _ffmpeg_path:
    AudioSegment.converter = _ffmpeg_path
    AudioSegment.ffprobe   = _ffmpeg_path
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
# DB helper: load all words
# ----------------------------
def load_all_words(db: Optional[Session] = None) -> List[Word]:
    if db:
        return db.query(Word).all()
    return []  # 如果完全不用 DB 可改成靜態列表

# ----------------------------
# API: 產生 quiz
# ----------------------------
@router.post("/generate_quiz_frontend", response_model=GenerateQuizResponse)
def generate_quiz_frontend(user_data: dict = Body(...), db: Session = Depends(get_db)):
    all_words = load_all_words(db)
    if not all_words:
        raise HTTPException(status_code=500, detail="No words in DB")

    user_model = {
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

    fprime_map = compute_normalized_freq_map(all_words)
    all_avg_times = [sum(ue.get("recent_times", []))/len(ue.get("recent_times", [])) 
                     for ue in user_model.get("user_errors", {}).values() if ue.get("recent_times")]
    t_avg_all = sum(all_avg_times)/len(all_avg_times) if all_avg_times else 1.0
    theta = user_model.get("ability", 0.5)

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

    candidates_sorted = sorted(candidates, key=lambda x: x["Score"], reverse=True)

    # 題型比例
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

    generated = []
    used = set()
    idx = 0
    def next_candidate():
        nonlocal idx
        while idx < len(candidates_sorted) and candidates_sorted[idx]["word"].name in used:
            idx += 1
        if idx >= len(candidates_sorted): return None
        c = candidates_sorted[idx]
        idx += 1
        used.add(c["word"].name)
        return c

    def _get_cn(word_obj):
        try:
            items = json.loads(word_obj.explanation_items or "[]")
            return (items[0].get('chineseExplanation') or '未知') if items else '未知'
        except Exception:
            return '未知'

    def _get_audio(word_obj):
        try:
            items = json.loads(word_obj.audio_items or "[]")
            return items[0].get('fileId') if items else None
        except Exception:
            return None

    def _get_sentence_fill_payload(w, all_words_list):
        """嘗試從句子範例建立填空題；若無資料回傳 None"""
        try:
            items = json.loads(w.explanation_items or "[]")
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
        except Exception:
            pass
        return None

    def _get_sentence_order_payload(w, all_words_list):
        """嘗試從句子範例建立排序題；若無資料回傳 None"""
        try:
            items = json.loads(w.explanation_items or "[]")
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
        except Exception:
            pass
        return None

    # --- word-translate ---
    for i in range(type_count["wordTranslate"]):
        c = next_candidate()
        if not c: break
        w = c["word"]
        Dt = c["Dt_map"].get("word-translate", 0.5)
        Dq, bw = compute_Dq_and_bw(c["Dw"], Dt, c["fprime"])
        a_q = TYPE_AQ.get("word-translate", 1.0)
        Ptheta = compute_P_theta(theta, bw, a_q, DEFAULT_GUESS)
        others = [o for o in all_words if o.name != w.name]
        random.shuffle(others)
        distractors = [_get_cn(o) for o in others[:3]]
        correct_cn = _get_cn(w)
        opts = [correct_cn] + distractors
        random.shuffle(opts)
        generated.append({
            "id": f"wt-{w.id}-{i}",
            "type": "word-translate",
            "payload": {"tayal": {"word": w.name, "audio": _get_audio(w)},
                        "cn": correct_cn, "options": opts},
            "difficulty": bw,
            "meta": {"Ptheta": Ptheta, "Bq": c["Bq"], "Dq": Dq}
        })

    # --- word-match（每題取 5 個單詞組成配對題）---
    for i in range(type_count["wordMatch"]):
        group = []
        for _ in range(5):
            c = next_candidate()
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

    # --- sentence-fill ---
    fill_needed = type_count["sentenceFill"]
    fill_done = 0
    fill_fallback = []
    while fill_done < fill_needed:
        c = next_candidate()
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
            fill_fallback.append(c)
    # 若句子資料不足，以 word-translate 補足
    for c in fill_fallback[:fill_needed - fill_done]:
        w = c["word"]
        others = [o for o in all_words if o.name != w.name]
        random.shuffle(others)
        distractors = [_get_cn(o) for o in others[:3]]
        correct_cn = _get_cn(w)
        opts = [correct_cn] + distractors
        random.shuffle(opts)
        generated.append({
            "id": f"sf-fb-{w.id}",
            "type": "word-translate",
            "payload": {"tayal": {"word": w.name, "audio": _get_audio(w)},
                        "cn": correct_cn, "options": opts},
            "difficulty": None,
            "meta": None
        })

    # --- sentence-order ---
    order_needed = type_count["sentenceOrder"]
    order_done = 0
    order_fallback = []
    while order_done < order_needed:
        c = next_candidate()
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
            order_fallback.append(c)
    # 若句子資料不足，以 word-translate 補足
    for c in order_fallback[:order_needed - order_done]:
        w = c["word"]
        others = [o for o in all_words if o.name != w.name]
        random.shuffle(others)
        distractors = [_get_cn(o) for o in others[:3]]
        correct_cn = _get_cn(w)
        opts = [correct_cn] + distractors
        random.shuffle(opts)
        generated.append({
            "id": f"so-fb-{w.id}",
            "type": "word-translate",
            "payload": {"tayal": {"word": w.name, "audio": _get_audio(w)},
                        "cn": correct_cn, "options": opts},
            "difficulty": None,
            "meta": None
        })

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


@router.post("/compare_audio/")
async def compare_audio(
    user_audio: UploadFile = File(...),
    audio_id: str = Form(...)
):
    if not _ffmpeg_path:
        return make_error("ffmpeg_missing", "伺服器未安裝 ffmpeg，語音比對功能暫時無法使用")
    try:
        # Step A — download target audio
        try:
            target_bytes = fetch_audio_from_id(audio_id)
        except Exception as e:
            return make_error("download_target", str(e))

        # Step B — read user audio
        try:
            user_bytes = await user_audio.read()
        except Exception as e:
            return make_error("read_user_audio", str(e))

        # Step C — convert BOTH to WAV
        try:
            target_wav = convert_to_wav(target_bytes)   # MP3 → WAV
        except Exception as e:
            return make_error("convert_target_to_wav", str(e))

        try:
            user_wav = convert_to_wav(user_bytes)       # WebM → WAV
        except Exception as e:
            return make_error("convert_user_to_wav", str(e))

        # Step D — WAV → tensor
        try:
            target_wave, sr1 = bytes_to_tensor(target_wav)
        except Exception as e:
            return make_error("target_to_tensor", str(e))

        try:
            user_wave, sr2 = bytes_to_tensor(user_wav)
        except Exception as e:
            return make_error("user_to_tensor", str(e))

        # Step E — embedding
        try:
            model = get_wav2vec2()
            emb1 = model.extract_features(target_wave)[0].mean(dim=1)
            emb2 = model.extract_features(user_wave)[0].mean(dim=1)
        except Exception as e:
            return make_error("embedding", str(e))

        # Step F — similarity
        try:
            sim = F.cosine_similarity(emb1, emb2).item()
            score = round(sim * 100, 2)
        except Exception as e:
            return make_error("similarity_calc", str(e))

        return {
            "success": True,
            "score": score,
            "passed": score >= 70
        }

    except Exception as e:
        return make_error("unknown_error", str(e))
