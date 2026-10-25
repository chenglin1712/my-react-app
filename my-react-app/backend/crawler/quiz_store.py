"""測驗題目存進 Firestore `quizs`（S-06）。

以前是前端拿到題目後自己 addDoc 寫進去，firestore.rules 只能檢查形狀，任何登入者都能無限建立文件。
現在改成出題的當下由伺服器用 Admin SDK 寫入（規則改為不開放 client 建立），出題 API 回傳 quizId，
前端用這個 id 當作答紀錄（situations）的 quizId。內容是伺服器剛組出來的，不再信任前端送來的版本。

存進去的是「不含正確答案」的版本：正確答案不能放在任何登入者都讀得到的文件（見 firestore.rules 的說明），
前端作答批改用的答案仍由出題 API 的回應帶給本人。欄位與前端原本的 formatQuestionForUpload 一致，
既有的歷史頁、AI 單題講解（AIModel/question_context.py）讀到的形狀不變。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# 等級 → 前端 quizLevels.js 的中文名稱（歷史頁用 title 反查等級，兩邊必須一致）
LEVEL_TITLES = {"1": "初級", "2": "中級", "3": "中高級", "4": "高級"}
# 題目只留給歷史頁與講解用；保留一年後可由排程清掉（Firestore TTL 對 expiresAt 設定即可）
RETENTION_DAYS = 365
MAX_QUESTIONS = 200


class QuizStoreError(Exception):
    """寫入失敗（Firestore 出錯或題目形狀不是預期的）。呼叫端回 503。"""


def _present(source: dict, mapping: dict) -> dict:
    """只放來源裡有這個鍵的欄位（沒有的鍵不寫，值是 None 的照寫，和前端 stripUndefined 的行為一致）。"""
    return {target: source[key] for target, key in mapping.items() if key in source}


def sanitize_questions(part_type: str, questions: list) -> list[dict]:
    """依題型整理成要存的格式，且一定不含 answer。"""
    result = []
    for q in questions:
        if not isinstance(q, dict):
            raise QuizStoreError("題目格式不正確")
        if part_type == "true_false":
            item = _present(q, {"question_ab": "question_ab", "image": "image", "audio": "audio"})
            item["options"] = {"1": "O (符合)", "2": "X (不符合)"}
        elif part_type == "choice":
            item = _present(q, {"question_ab": "question_ab", "question_ch": "question_ch", "audio": "audio"})
            images = _present(q, {"A": "imageA", "B": "imageB", "C": "imageC"})
            item["images"] = images
        elif part_type == "matching":
            item = _present(q, {"pairs": "pairs"})
        elif part_type == "cloze":
            item = _present(q, {"passage_ab": "passage_ab", "passage_ch": "passage_ch", "options": "options"})
        else:
            raise QuizStoreError("不支援的題型")
        result.append(item)
    return result


def save_quiz(uid: str, tribe: str, level: str, part: dict) -> str:
    """寫入一份測驗，回傳文件 id。失敗丟 QuizStoreError。"""
    questions = part.get("questions") if isinstance(part, dict) else None
    if not isinstance(questions, list) or not 0 < len(questions) <= MAX_QUESTIONS:
        raise QuizStoreError("沒有可存的題目")
    title = LEVEL_TITLES.get(level)
    if title is None:
        raise QuizStoreError("不支援的等級")
    data = sanitize_questions(part.get("type"), questions)

    try:
        from firebase_admin import firestore

        from adminapi import firebase_ops

        ref = firebase_ops.get_firestore_client().collection("quizs").document()
        ref.set({
            "title": title,
            "tribe": tribe,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=RETENTION_DAYS),
            "userId": uid,
            "data": data,
        })
        return ref.id
    except QuizStoreError:
        raise
    except Exception as exc:  # noqa: BLE001 - Firestore／憑證／網路的任何錯誤都轉成同一種失敗
        logger.error("[quiz_store] 寫入測驗失敗", exc_info=True)
        raise QuizStoreError("測驗儲存失敗") from exc
