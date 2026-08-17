"""適性測驗端點——薄薄一層路由組裝，實際邏輯都在 irt.py（超參數與計算
公式）、repository.py（詞彙資料存取）、generator.py（出題邏輯）。也在這裡
掛上 ..pronunciation 的 /compare_audio/ 端點，讓對外 URL 維持跟拆分前
一樣的 /api/v1/quiz/compare_audio/（見 main.py 的 include_router）。"""
import random

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from config.tribes import TRIBE_IDS
from dictionary_db.connect import get_db

from .. import pronunciation
from . import irt
from .generator import (
    _CandidatePicker,
    _build_user_model,
    _compute_avg_time,
    _generate_sentence_fill_questions,
    _generate_sentence_order_questions,
    _generate_word_match_questions,
    _generate_word_translate_questions,
    _score_candidates,
)
from .irt import (
    _compute_type_counts,
    _refresh_irt_config_if_stale,
    compute_Dq_and_bw,
    compute_P_theta,
    compute_normalized_freq_map,
    compute_smoothed_error_rate,
    update_theta,
)
from .repository import load_all_words, warm_cache
from .schemas import (
    GenerateQuizResponse,
    QuizQuestion,
    SubmitAnswerFrontendReq,
    SubmitAnswerResp,
    UserModelReq,
)

router = APIRouter()
router.include_router(pronunciation.router)


# ----------------------------
# API: 產生 quiz
# ----------------------------
@router.post("/generate_quiz_frontend", response_model=GenerateQuizResponse)
def generate_quiz_frontend(
    user_data: UserModelReq = Body(...),
    tribe: str = Query(default="tayal"),
    db: Session = Depends(get_db),
):
    # 沒被下面明確攔截的例外交給 main.py 的全域 Exception handler 處理
    # （P4 review BE-28，說明見 vision.py analyze_image()）。
    _refresh_irt_config_if_stale()
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
             for q in generated[:irt.TOTAL_QUESTIONS]]
    return {"questions": qlist}

# ----------------------------
# API: submit answer
# ----------------------------
@router.post("/submit_answer_frontend", response_model=SubmitAnswerResp)
def submit_answer_frontend(
    body: SubmitAnswerFrontendReq = Body(...),
    tribe: str = Query(default="tayal"),
    db: Session = Depends(get_db),
):
    # 沒被下面明確攔截的例外交給 main.py 的全域 Exception handler 處理
    # （P4 review BE-28，說明見 vision.py analyze_image()）。
    _refresh_irt_config_if_stale()
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
    a_q = irt.TYPE_AQ.get(t,1.0)
    current_theta = user_model.get("ability",0.5)
    Ptheta = compute_P_theta(current_theta, bw, a_q, irt.DEFAULT_GUESS)
    theta_new = update_theta(current_theta, answer.get("correct"), Ptheta, irt.LEARNING_RATE)
    user_model["ability"] = theta_new
    user_model["type_stats"] = type_stats
    user_model["user_errors"] = user_errors

    return {"new_theta": theta_new, "updated_user_errors":{word_name:user_errors[word_name]}, "user_model":user_model}
