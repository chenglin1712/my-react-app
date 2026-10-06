"""適性測驗端點——薄薄一層路由組裝，實際邏輯都在 irt.py（超參數與計算
公式）、repository.py（詞彙資料存取）、generator.py（出題邏輯）。也在這裡
掛上 ..pronunciation 的 /compare_audio/ 端點，讓對外 URL 維持跟拆分前
一樣的 /api/v1/quiz/compare_audio/（見 main.py 的 include_router）。"""
import logging
import random

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.tribes import TRIBE_IDS, TRIBES
from dictionary_db.connect import get_db

from .. import auth, pronunciation
from . import distractors, flags, irt
from . import answer_flow, research_events, rule_state_store
from . import diagnosis as quiz_diagnosis
from .generator import (
    TokenOptions,
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
from .rule_selection import RulePolicy
from .schemas import (
    GenerateQuizResponse,
    QuizQuestion,
    SubmitAnswerFrontendReq,
    SubmitAnswerResp,
    UserModelReq,
)

logger = logging.getLogger(__name__)
router = APIRouter()
_TRIBE_BY_SLUG = {t.slug: t for t in TRIBES}
router.include_router(pronunciation.router)


def _ability_prediction(user_model: dict, word_name: str, qtype: str, fprime: float) -> float:
    """目前單一能力值（IRT）對「這位使用者答對這一題」的預測，只用作答【之前】的統計。"""
    ue = (user_model.get("user_errors") or {}).get(word_name) or {}
    stats = (user_model.get("type_stats") or {}).get(qtype) or {}
    dw = compute_smoothed_error_rate(ue.get("errors", 0), ue.get("attempts", 0))
    dt = compute_smoothed_error_rate(stats.get("e", 0), stats.get("n", 0))
    _, bw = compute_Dq_and_bw(dw, dt, fprime)
    return compute_P_theta(user_model.get("ability", 0.5), bw, irt.TYPE_AQ.get(qtype, 1.0), irt.DEFAULT_GUESS)


_warned_missing_secret = False


def _token_options(tribe: str, uid: str):
    """診斷 token 的出題選項。旗標關閉回傳 None；旗標開了卻沒有可用的密鑰（QUIZ_TOKEN_SECRET 沒設定或太弱）
    也回傳 None（出題照常，只是沒有詞素診斷），並記一次警告，讓維運人員知道為什麼旗標開了卻沒有效果。"""
    global _warned_missing_secret
    if not flags.enabled(flags.DIAGNOSIS):
        return None
    if quiz_diagnosis.signing_secret() is None:
        if not _warned_missing_secret:
            _warned_missing_secret = True
            logger.warning("quiz_morphology_diagnosis 已開啟，但 QUIZ_TOKEN_SECRET 沒設定或不合格（至少 32 個字元），"
                           "句子填空題不會附診斷 token")
        return None
    return TokenOptions(tribe, uid)


def _rule_policy(source, tribe: str, uid: str):
    """適性選題：旗標開、有干擾項來源、而且讀得到這位使用者的規則熟練度才啟用；任何一項不成立就是 None
    （照原本的難度排序出題）。"""
    if source is None or not uid or not flags.enabled(flags.ADAPTIVE):
        return None
    try:
        store = rule_state_store.get_store()
        if store is None:
            return None
        return RulePolicy(source.kit, tribe, store.load(uid, tribe).skills)
    except Exception:
        logger.exception("quiz rule policy setup failed")
        return None


# ----------------------------
# API: 產生 quiz
# ----------------------------
@router.post("/generate_quiz_frontend", response_model=GenerateQuizResponse)
def generate_quiz_frontend(
    user_data: UserModelReq = Body(...),
    tribe: str = Query(default="tayal"),
    db: Session = Depends(get_db),
    user: dict = Depends(auth.verify_firebase_token),
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
    uid = (user or {}).get("uid", "")
    fill_source = distractors.source_for(db, _TRIBE_BY_SLUG[tribe])
    generated += _generate_sentence_fill_questions(
        picker, all_words, type_count["sentenceFill"],
        distractor_source=fill_source,
        token_options=_token_options(tribe, uid),
        rule_policy=_rule_policy(fill_source, tribe, uid),
    )
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
    user: dict = Depends(auth.verify_firebase_token),
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

    # 詞素診斷（加分功能，旗標關閉或出錯時是 None）。token 驗證過時，答對與否以伺服器依 token 判斷的為準，
    # 避免前端自報的 correct 讓 IRT 與詞素診斷互相矛盾。
    uid = (user or {}).get("uid", "")
    tribe_obj = _TRIBE_BY_SLUG[tribe]
    diagnosis = answer_flow.prepare(db, tribe_obj, answer, uid)
    answer["correct"] = answer_flow.authoritative_correct(diagnosis, answer.get("correct"))
    t = answer.get("question_type")
    type_stats = user_model.get("type_stats", {})
    user_errors = user_model.get("user_errors", {})

    # 研究事件要的「作答前預測」：必須在下面更新 type_stats／user_errors【之前】，用尚未包含這一題的統計算出來；
    # 下面計算 theta 用的 Ptheta 是更新之後的統計，含有這題的答案，不能拿來當前瞻預測。
    all_words = load_all_words(db, tribe_id)
    fprime = compute_normalized_freq_map(all_words).get(word_name, 0.0)
    pred_ability = _ability_prediction(user_model, word_name, t, fprime)

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
    Dq, bw = compute_Dq_and_bw(Dw, Dt, fprime)
    a_q = irt.TYPE_AQ.get(t,1.0)
    current_theta = user_model.get("ability",0.5)
    Ptheta = compute_P_theta(current_theta, bw, a_q, irt.DEFAULT_GUESS)
    theta_new = update_theta(current_theta, answer.get("correct"), Ptheta, irt.LEARNING_RATE)
    user_model["ability"] = theta_new
    user_model["type_stats"] = type_stats
    user_model["user_errors"] = user_errors

    # 規則熟練度由伺服器持有並以交易更新（不經前端），再經同意才記錄研究事件；兩者都不影響上面的 IRT 結果。
    rule_update = answer_flow.update_skills(diagnosis, tribe, uid)
    answer_flow.record_event(diagnosis, tribe, uid, answer, pred_ability=pred_ability,
                             ability_before=current_theta, rule_update=rule_update)

    return {"new_theta": theta_new, "updated_user_errors":{word_name:user_errors[word_name]}, "user_model":user_model,
            "diagnosis": diagnosis.as_dict() if diagnosis else None, "rule_update": rule_update}


# ----------------------------
# API: 詞素學習的研究資料同意、規則熟練度摘要
# ----------------------------
class ResearchConsentReq(BaseModel):
    granted: bool


@router.get("/research_consent")
def get_research_consent(user: dict = Depends(auth.verify_firebase_token)):
    """這位使用者目前有沒有同意（目前版本的）研究資料說明；enabled 是這個功能對外有沒有開放。"""
    state = research_events.consent_state((user or {}).get("uid", ""))
    state["enabled"] = flags.enabled(flags.EVENTS)
    return state


@router.put("/research_consent")
def put_research_consent(body: ResearchConsentReq, user: dict = Depends(auth.verify_firebase_token)):
    """同意或撤回；撤回會一併刪除這位使用者已記錄的全部事件。功能不可用時回 503，不假裝成功。"""
    try:
        state = research_events.set_consent((user or {}).get("uid", ""), body.granted)
    except research_events.ResearchUnavailable:
        raise HTTPException(status_code=503, detail="研究資料記錄目前無法使用，請稍後再試")
    state["enabled"] = flags.enabled(flags.EVENTS)
    return state


@router.get("/rule_summary")
def get_rule_summary(tribe: str = Query(default="tayal"), user: dict = Depends(auth.verify_firebase_token)):
    """測驗結束頁用：待加強的規則（資料足夠才列）與常見混淆。旗標關閉或狀態儲存不可用時 available=False。"""
    if tribe not in TRIBE_IDS:
        raise HTTPException(status_code=400, detail=f"不支援的族語：{tribe}")
    uid = (user or {}).get("uid", "")
    try:
        store = rule_state_store.get_store()
        if not uid or store is None or not flags.enabled(flags.SKILL_UPDATE):
            return {"available": False}
        return {"available": True, **rule_state_store.summarize(store.load(uid, tribe))}
    except Exception:
        logger.exception("quiz rule summary failed")
        return {"available": False}
