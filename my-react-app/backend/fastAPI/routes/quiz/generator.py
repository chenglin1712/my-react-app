"""候選字排序後，怎麼組成四種題型（配對、翻譯、填空、排序）的出題邏輯。
依賴 repository.py 拿詞彙資料／快取好的釋義音檔，依賴 irt.py 算難度分數；
本身不做任何 DB 存取或 HTTP 呼叫。"""
import random
from typing import Dict, List

from . import irt, repository
from .irt import (
    compute_Bq,
    compute_Dq_and_bw,
    compute_P_theta,
    compute_delta_w,
    compute_score,
    compute_Tw,
    compute_smoothed_error_rate,
)
from .repository import _get_audio, _get_cn
from .schemas import WordDTO


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
        # 欄位名一定要叫 answer，不能叫 cn：前端 wordTranslation.jsx 判分／
        # 顯示正確答案都是讀 question.answer（quiz_recommon_question.jsx
        # 攤平 payload 時直接展開成 question 的頂層欄位）。這裡原本叫 cn，
        # 兩邊對不上，question.answer 永遠是 undefined，導致這個題型不管
        # 選什麼都被判成答錯——是這次連帶抓到、獨立於題目本身邏輯的 bug。
        "payload": {"tayal": {"word": w.name, "audio": _get_audio(w)},
                    "answer": correct_cn, "options": opts},
        "difficulty": difficulty,
        "meta": meta,
    }

def _get_sentence_fill_payload(w, all_words_list):
    """嘗試從句子範例建立填空題；若無資料回傳 None"""
    items = repository._word_explanations_cache.get(w.id, [])
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
    items = repository._word_explanations_cache.get(w.id, [])
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
        a_q = irt.TYPE_AQ.get("word-translate",1.0)
        Ptheta_example = compute_P_theta(theta, bw_example, a_q, irt.DEFAULT_GUESS)
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


def _generate_word_translate_questions(picker: _CandidatePicker, all_words: List[WordDTO], theta: float, count: int) -> list:
    generated = []
    for i in range(count):
        c = picker.next()
        if not c: break
        w = c["word"]
        Dt = c["Dt_map"].get("word-translate", 0.5)
        Dq, bw = compute_Dq_and_bw(c["Dw"], Dt, c["fprime"])
        a_q = irt.TYPE_AQ.get("word-translate", 1.0)
        Ptheta = compute_P_theta(theta, bw, a_q, irt.DEFAULT_GUESS)
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
