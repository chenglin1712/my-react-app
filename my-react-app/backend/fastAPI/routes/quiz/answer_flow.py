"""作答端點的詞素診斷流程：診斷錯誤類型 → 依診斷更新規則熟練度 → 經同意後記錄研究事件。

整段是「加分功能」：旗標關閉、不是句子填空題、或任何一步出錯，都只會讓該步驟被略過，絕不能影響既有的
IRT 更新與回應。各步驟分別由旗標控制（見 flags.py），而且都是 fail-closed。

api.py 的呼叫順序（順序有意義）：
1. prepare()：驗證 token 並診斷（只讀）；
2. authoritative_correct()：token 驗證過時，答對與否以伺服器依 token 判斷的為準，覆蓋前端自報的 correct，
   讓 IRT 與詞素診斷不會互相矛盾；
3. 既有的 IRT 更新；
4. update_skills()：在 Firestore 交易裡更新這位使用者的整體表現與規則熟練度（伺服器持有，nonce 去重）；
5. record_event()：同意過才寫入匿名化事件。

更新熟練度的條件（見 diagnosis.skill_observation）：token 驗證通過、這一題真的在測目標詞的那條規則、
而且錯因是詞綴或中綴位置。選到別的詞根、歧義、無法分類的錯誤都只回傳診斷，不扣熟練度。
"""
from __future__ import annotations

import logging
from dataclasses import replace

from config import quiz_research as QR
from config import rule_skill_model as R

from . import diagnosis as G
from . import deadline, distractors, flags, research_events, rule_state_store

logger = logging.getLogger(__name__)

SENTENCE_FILL = "sentence-fill"
MODEL_UPDATE_TIMEOUT = 3.0        # 秒；超過就放棄等待，作答回應照常送出（更新可能仍在背景完成）
EVENT_TIMEOUT = 2.0


def _diagnose(db, tribe, answer: dict, uid: str) -> G.Diagnosis:
    token = answer.get("question_token")
    selected = answer.get("selected_option") or ""
    ctx = None
    if token:
        ctx = G.verify_for_answer(token, question_id=answer.get("question_id", ""), tribe=tribe.slug,
                                  word_name=answer.get("word_name") or "", uid=uid)
    if ctx is not None:
        return G.diagnose_with_context(ctx, selected)
    try:
        kit = distractors.get_kit(db, tribe)
    except Exception:
        logger.exception("quiz diagnosis kit lookup failed for tribe %s", tribe.id)
        kit = None
    diag = G.diagnose_by_recompute(kit, tribe.slug, answer.get("word_name") or "", selected)
    return replace(diag, reason=f"token_invalid:{diag.reason}") if token else diag


def prepare(db, tribe, answer: dict, uid: str) -> G.Diagnosis | None:
    """診斷這次作答；不適用（旗標關、不是句子填空、沒有選項）或出錯就回傳 None。"""
    if answer.get("question_type") != SENTENCE_FILL or not answer.get("selected_option"):
        return None
    try:
        if not flags.enabled(flags.DIAGNOSIS):
            return None
        return _diagnose(db, tribe, answer, uid)
    except Exception:
        logger.exception("quiz rule diagnosis failed")
        return None


def authoritative_correct(diag: G.Diagnosis | None, client_correct: bool) -> bool:
    """token 驗證過、所選選項確實在這一題裡時，答對與否由伺服器依 token 判斷；否則沿用前端自報的值。"""
    if diag is None or diag.confidence != "high" or diag.status == G.STATUS_INVALID:
        return client_correct
    server_correct = diag.status == G.STATUS_CORRECT
    if server_correct != bool(client_correct):
        logger.warning("quiz answer correctness mismatch: client=%s server=%s", client_correct, server_correct)
    return server_correct


def update_skills(diag: G.Diagnosis | None, tribe_slug: str, uid: str) -> dict | None:
    """更新這位使用者的狀態，回傳這次更新的摘要；沒有更新回 None。

    每一題「token 驗證過、所選選項確實在這題裡」的作答都會計入整體表現（預測用的先驗，不論這題有沒有測到規則）；
    只有真的在測某條規則的題目才額外更新那條規則的熟練度。回傳：
    - {"answered": 整體作答次數, "pred_skill": 作答前對這題的預測（只有測到規則時才有）, "rule", "before", "after", "n"}；
    - 同一題重送：{"duplicate": True}（不更新任何東西）；
    - 儲存不可用、逾時或忙碌：{"unavailable": "error" | "timeout" | "busy"}（這次沒有確定更新成功）。"""
    if diag is None or diag.confidence != "high" or diag.status == G.STATUS_INVALID or not diag.nonce or not diag.expires_at:
        return None
    observation = G.skill_observation(diag)
    try:
        if not flags.enabled(flags.SKILL_UPDATE):
            return None
        store = rule_state_store.get_store()
        if store is None:
            return None

        def mutate(state: rule_state_store.RuleState) -> dict:
            result: dict = {}
            if observation is not None:
                rid, correct = observation
                # 預測必須在更新之前算（前瞻預測，不洩漏這題的答案）
                result["pred_skill"] = R.blended_prediction(state.skills, rid, state.overall)
                before, after = R.apply_observation(state.skills, rid, correct)
                if not correct and diag.selected_rule_id:
                    R.add_confusion(state.confusions, rid, diag.selected_rule_id)
                result.update({"rule": rid, "before": before, "after": after, "n": state.skills[rid]["n"]})
            R.add_overall(state.overall, diag.status == G.STATUS_CORRECT)
            result["answered"] = state.overall["n"]
            return result

        status, outcome = deadline.run_with_deadline(
            lambda: store.apply(uid, tribe_slug, diag.nonce, mutate, diag.expires_at), MODEL_UPDATE_TIMEOUT)
        if status != "ok":
            return {"unavailable": status}
        applied, result = outcome
        return result if applied else {"duplicate": True}
    except Exception:
        logger.exception("quiz rule skill update failed")
        return None


def record_event(diag: G.Diagnosis | None, tribe_slug: str, uid: str, answer: dict, *,
                 pred_ability: float, ability_before: float, rule_update: dict | None) -> bool:
    """經同意才記錄；任何失敗都只回傳 False。"""
    if diag is None or diag.confidence != "high" or diag.status == G.STATUS_INVALID or not diag.nonce:
        return False
    if rule_update and (rule_update.get("duplicate") or rule_update.get("unavailable")):
        return False
    try:
        if not flags.enabled(flags.EVENTS):
            return False
        update = rule_update or {}
        before = update.get("before")
        event = {
            "nonce": diag.nonce,
            "tribe": tribe_slug,
            "question_type": SENTENCE_FILL,
            "target_rule_id": diag.target_rule_id or "",
            "selected_rule_id": diag.selected_rule_id or "",
            "diagnosis_status": diag.status,
            "error_type": diag.error_type or "",
            "correct": diag.status == G.STATUS_CORRECT,
            "probe": diag.probe,
            "seconds_bucket": QR.seconds_bucket(answer.get("time_spent")),
            "p_before": _round(before),
            "p_after": _round(update.get("after")),
            "pred_skill": _round(update.get("pred_skill")),
            "pred_ability": _round(pred_ability),
            "ability_before": _round(ability_before),
            "model_version": R.MODEL_VERSION,
            "kit_version": diag.kit_version,
            "selection_policy": diag.policy,
        }
        status, recorded = deadline.run_with_deadline(lambda: research_events.record_skill_event(uid, event), EVENT_TIMEOUT)
        return bool(recorded) if status == "ok" else False
    except Exception:
        logger.exception("quiz research event failed")
        return False


def _round(value):
    return None if value is None else round(float(value), 4)
