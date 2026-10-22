"""AI 助手的建議問題（路線圖 #13）：下一步可以問什麼。

不另外呼叫模型，也不讓一般對話變成 JSON（會犧牲 #9 的純文字串流）：建議由模板產生，只用「伺服器已經知道、
而且可信」的資料填空——這一輪辭典查到的詞條（回覆真的提到的詞）、學習資料裡最常錯的詞。
模板不描述詞義或用法，所以不可能編造族語內容；學生點了建議只是把那句話放進輸入框，仍由他決定要不要送出。
"""
from .output_guard import guard_field

MAX_FOLLOWUPS = 3
_MAX_LEN = 40          # 一句建議的字數上限（填進去的詞太長就整句不要，不截斷成怪句子）
_MAX_WORD_LEN = 16

DEFAULT_STARTERS = ("我想了解我的學習狀況", "介紹這個族語的文化特色", "幫我排一週讀書計畫")


def _fits(text: str) -> bool:
    return 0 < len(text) <= _MAX_LEN


def _word(value) -> str:
    """填進模板的詞：清成單行、去掉網址與標籤，太長就不用。"""
    word = " ".join(str(value or "").split())
    word = guard_field(word)
    return word if 0 < len(word) <= _MAX_WORD_LEN and "（已移除" not in word else ""


def starter_suggestions(profile: dict | None) -> list[str]:
    """第一次開啟時的建議（不呼叫模型）。有學習資料就帶入最常錯的詞；沒有就用預設三句。"""
    suggestions: list[str] = []
    # 預設三句可由管理者在後台調整（#35）；沒設定就是 DEFAULT_STARTERS
    from . import assistant_settings

    starters = assistant_settings.active()["suggestions"]
    for raw in (profile or {}).get("common_errors", []):
        word = _word(raw)
        if word:
            suggestions.append(f"幫我複習最常錯的「{word}」")
            break
    for text in starters:
        if len(suggestions) == MAX_FOLLOWUPS:
            break
        suggestions.append(text)
    return suggestions[:MAX_FOLLOWUPS]


def followups_for_entries(cards: list) -> list[str]:
    """這一輪回覆提到、辭典查得到的詞（entries.py 的卡片）→ 針對最前面那個詞的後續問題。"""
    for card in cards or []:
        word = _word(card.get("word"))
        if not word:
            continue
        candidates = (f"「{word}」還有其他意思嗎？", f"有跟「{word}」相關的詞嗎？", f"出一題關於「{word}」的小測驗")
        return [c for c in candidates if _fits(c)][:MAX_FOLLOWUPS]
    return []


PLAN_FOLLOWUPS = ("把計畫改成兩週", "每天的時間再短一點", "計畫裡先練習哪些詞？")


def followups_for_plan() -> list[str]:
    return list(PLAN_FOLLOWUPS)
