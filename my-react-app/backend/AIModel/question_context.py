"""單題錯題講解的題目脈絡（路線圖 #22）。

前端只傳「哪一次作答（attempt_id）的第幾題（index）」，不傳題目內容、也不傳使用者的答案：
伺服器用 Admin SDK 讀 situations/{attempt_id}（必須是本人的作答紀錄）與 quizs/{quizId}，
自己組出題幹、選項、使用者選了什麼、正解是什麼。

誠實的限制：作答紀錄與測驗文件原本是前端寫進 Firestore 的（正解 correctAnswers 也是），本人在
Firestore 規則下改得動自己的紀錄，所以這些內容對「有心人改自己的資料」並非完全可信；它們只影響他
自己的講解，這裡把每段文字清成單行、限制長度後才放進 prompt，並在 prompt 標示為資料。
"""
import logging

from .learner_profile import _client, _one_line

logger = logging.getLogger(__name__)

_MAX_TEXT = 300
_MAX_OPTIONS = 6
_MAX_PAIRS = 8


class QuestionNotFound(LookupError):
    """作答紀錄、測驗或題號不存在，或這份紀錄不屬於這個使用者。"""


def _text(value, limit: int = _MAX_TEXT) -> str:
    return _one_line(value, limit) if isinstance(value, (str, int, float)) else ""


def _choice(answer, labels: dict) -> str:
    """作答編號 → 人看得懂的說法；沒作答（None）或編號不合法都說明白，不亂猜。"""
    if answer is None:
        return "未作答"
    return labels.get(answer, "（紀錄異常）") if isinstance(answer, int) and not isinstance(answer, bool) else "（紀錄異常）"


def describe_question(item: dict, user_answer, correct_answer) -> dict:
    """純函式：把一題（依欄位判斷題型）整理成講解用的脈絡 {type, lines, user_answer, correct_answer, source_text}。
    題型不認得回傳 None。lines 是給模型看的題目資料；source_text 是題目裡出現的族語文字，用來抓相關詞條。"""
    if not isinstance(item, dict):
        return None

    if "pairs" in item:
        pairs = [p for p in item.get("pairs") or [] if isinstance(p, dict)][:_MAX_PAIRS]
        entries = [f"{_text((p.get('word') or {}).get('word') if isinstance(p.get('word'), dict) else p.get('word'))} = {_text(p.get('cn'))}"
                   for p in pairs]
        labels = {1: "全部配對正確", 2: "有配錯的"}
        return {
            "type": "matching",
            "lines": ["題型：配合題（把族語詞和中文意思配對，全部對才算對）", "這一題的配對：" + "；".join(entries)],
            "user_answer": _choice(user_answer, labels),
            "correct_answer": _choice(1 if correct_answer is None else correct_answer, labels),
            "source_text": " ".join(e.split(" = ")[0] for e in entries),
        }

    if "passage_ab" in item:
        options = [_text(o, 60) for o in (item.get("options") or [])[:_MAX_OPTIONS]]
        labels = {i + 1: f"選項{i + 1}「{o}」" for i, o in enumerate(options)}
        return {
            "type": "cloze",
            "lines": ["題型：閱讀填空（選出最適合填入「＿＿＿」的詞）",
                      f"族語短文：{_text(item.get('passage_ab'))}", f"中文：{_text(item.get('passage_ch'))}",
                      "選項：" + "、".join(f"{i}. {o}" for i, o in enumerate(options, 1))],
            "user_answer": _choice(user_answer, labels),
            "correct_answer": _choice(correct_answer, labels),
            "source_text": f"{_text(item.get('passage_ab'))} {' '.join(options)}",
        }

    # 前端存進資料庫的格式是 images: {A, B, C}；imageA 是出題 API 的原始欄位名稱，兩種都認
    if "imageA" in item or isinstance(item.get("images"), dict):
        labels = {1: "圖片 A", 2: "圖片 B", 3: "圖片 C"}
        return {
            "type": "choice",
            "lines": ["題型：三選一圖片選擇題（依族語句子的語意選圖片；你看不到圖片，不要描述圖片內容）",
                      f"族語句子：{_text(item.get('question_ab'))}", f"中文意思：{_text(item.get('question_ch'))}"],
            "user_answer": _choice(user_answer, labels),
            "correct_answer": _choice(correct_answer, labels),
            "source_text": _text(item.get("question_ab")),
        }

    if "question_ab" in item:
        labels = {1: "O（符合）", 2: "X（不符合）"}
        return {
            "type": "true_false",
            "lines": ["題型：是非題（聽族語句子，判斷是否符合圖片；你看不到圖片和音檔，不要描述圖片內容）",
                      f"族語句子：{_text(item.get('question_ab'))}", f"中文意思：{_text(item.get('question_ch'))}"],
            "user_answer": _choice(user_answer, labels),
            "correct_answer": _choice(correct_answer, labels),
            "source_text": _text(item.get("question_ab")),
        }
    return None


def load_question_context(uid: str, attempt_id: str, index: int) -> dict:
    """讀出本人某次作答的第 index 題。找不到、不是本人的、題號超出範圍、題型不認得都丟 QuestionNotFound。
    Firestore 本身出錯（網路、權限）照原樣往外丟，由呼叫端轉成 503。"""
    db = _client()
    attempt_snap = db.collection("situations").document(attempt_id).get()
    attempt = attempt_snap.to_dict() if attempt_snap.exists else None
    if not isinstance(attempt, dict) or attempt.get("userId") != uid:
        raise QuestionNotFound("找不到這次作答")

    quiz_id = attempt.get("quizId")
    quiz_snap = db.collection("quizs").document(quiz_id).get() if isinstance(quiz_id, str) and quiz_id else None
    quiz = quiz_snap.to_dict() if quiz_snap is not None and quiz_snap.exists else None
    items = quiz.get("data") if isinstance(quiz, dict) else None
    if not isinstance(items, list) or not 0 <= index < len(items):
        raise QuestionNotFound("找不到這一題")

    def at(name):
        values = attempt.get(name)
        return values[index] if isinstance(values, list) and index < len(values) else None

    described = describe_question(items[index], at("answers"), at("correctAnswers"))
    if described is None:
        raise QuestionNotFound("這種題型目前不支援講解")
    tribe = quiz.get("tribe") if isinstance(quiz.get("tribe"), str) else "tayal"
    results = attempt.get("results")
    result = results[index] if isinstance(results, list) and index < len(results) else None
    is_correct = result.get("isCorrect") if isinstance(result, dict) else None
    return {**described, "tribe": tribe, "index": index, "is_correct": is_correct if isinstance(is_correct, bool) else None}


def record_asked_question(uid: str, attempt_id: str, index: int) -> None:
    """記下「這位學生問過助手哪一題」（之後的學習週報 #25 會用）。存在只有後端能寫的
    users/{uid}/aiAskedQuestions；失敗只記 log，不影響講解。刪除帳號時要一併清掉（adminapi/user_views.py）。"""
    try:
        from firebase_admin import firestore

        _client().collection("users").document(uid).collection("aiAskedQuestions").document(
            f"{attempt_id}_{index}"
        ).set({"attemptId": attempt_id, "index": index, "askedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    except Exception:  # noqa: BLE001 - 輔助紀錄
        logger.exception("[AIModel] 記錄學生問過的題目失敗，略過")
