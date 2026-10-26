"""內容審核事件的記錄（路線圖 #28）：被攔下或被引導的訊息，供後台檢視誤攔與漏攔。

隱私（對象可能是未成年人，S-17）：
  - 不存 uid，只存單向雜湊。
  - 「安全類」（unsafe）完全不存訊息文字：那種訊息最容易夾帶自述的困境與個人細節，後台只需要知道「有幾次被攔」。
  - 其他類型只存開頭 40 字的摘錄，且先遮掉可識別個人的內容：網址與網域、電子郵件、@帳號、長數字（電話、證號）、
    英數混合的帳號、自報的姓名、學校名稱、含門牌號碼的地址、縣市區。寧可多遮：詢問地名、學校的正常問題摘錄也會被遮。
  - 保存 30 天（見 adminapi/models/ai_assistant.py）。
遮罩是用規則比對，抓得到常見的格式，但不保證抓到所有可識別的內容（例如沒有「我叫」前綴的暱稱），所以才同時限制長度與保存期限。
記錄失敗只寫 log，絕不影響回覆。正常通過的訊息不記。
"""
import datetime
import logging
import re
import unicodedata

from django.utils import timezone

logger = logging.getLogger(__name__)

EXCERPT_LEN = 40
# 先取前面這麼多字再做遮罩：限制正規表示式要處理的長度，也不讓超長訊息拖慢回覆
_SCAN_LEN = 400
# 這些類型完全不存訊息文字
NO_TEXT_INTENTS = frozenset({"unsafe"})
MASK = "＊"

_CJK = r"\u4e00-\u9fff"
_REDACTIONS = [
    re.compile(r"(?:h(?:tt|xx)ps?://|www\.)\S+", re.I),                    # 網址（含 hxxp 這類刻意拼錯）
    re.compile(r"[\w.+-]+\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)+"),           # 電子郵件（容許 @ 與 . 前後有空白）
    re.compile(r"@\s*[\w.]+"),                                         # @帳號
    re.compile(r"\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|edu|gov|tw|io|me|cc|co)\b(?:/\S*)?", re.I),   # 裸網域
    re.compile(r"\+?\d[\d\s\-().]{4,}\d"),                           # 長數字：電話、證號（含括號、點號分隔）
    # 英數混合的長字串（社群帳號、代號）。門檻 8：族語拼寫加課號（如 lokah2）與 Python3 這類正常內容不會被誤遮
    re.compile(r"\b(?=[A-Za-z_.-]*\d)(?=[\d_.-]*[A-Za-z])[A-Za-z\d_.-]{8,}\b"),
    re.compile(rf"[{_CJK}]{{2,8}}(?:國民小學|國民中學|國小|國中|高中|高職|大學|幼兒園)"),     # 學校
    re.compile(rf"[{_CJK}]{{1,10}}[路街巷弄]\s*[\d一二三四五六七八九十]+\s*[號之]?"),     # 含門牌號碼的地址
    re.compile(rf"[{_CJK}]{{1,3}}[縣市][{_CJK}]{{1,4}}[區鄉鎮市]"),                       # 縣市區
]
# 自報姓名：保留前面的引導詞，遮掉後面的名字（「我是」太常見，不列入）
_SELF_NAME = re.compile(rf"(我叫|叫我|我的名字是|名字是|名字叫|本名是|姓名是?|我姓)\s*[{_CJK}A-Za-z·]{{1,6}}")


def _redact(text: str) -> str:
    # NFKC：全形數字、全形 ＠ 先轉成一般字元，否則「０９１２…」會躲過比對。
    # 再丟掉所有 Unicode 格式字元（類別 Cf：零寬空白、雙向控制字元等）：有人會把它們插在 email、網址中間躲過比對。
    clean = "".join(ch for ch in unicodedata.normalize("NFKC", text) if unicodedata.category(ch) != "Cf")
    for pattern in _REDACTIONS:
        clean = pattern.sub(MASK, clean)
    return _SELF_NAME.sub(lambda m: m.group(1) + MASK, clean)


def _excerpt(text, intent: str = "") -> str:
    if intent in NO_TEXT_INTENTS:
        return ""
    clean = " ".join(str(text or "").split())[:_SCAN_LEN]
    return _redact(clean)[:EXCERPT_LEN]


def record(uid: str, intent: str, action: str, text: str, tribe: str = "") -> None:
    """記一筆審核事件。任何失敗都吞掉。"""
    try:
        from adminapi.models import AiModerationEvent

        from .feedback import hash_uid

        AiModerationEvent.objects.create(
            uid_hash=hash_uid(uid or ""), intent=intent, action=action, excerpt=_excerpt(text, intent), tribe=(tribe or "")[:20],
        )
    except Exception:
        logger.warning("[AIModel] 記錄內容審核事件失敗（不影響回覆）", exc_info=True)


def purge_old(days: int | None = None) -> int:
    """刪除超過保存期限的事件，回傳刪除筆數。"""
    from adminapi.models import AiModerationEvent
    from adminapi.models.ai_assistant import MODERATION_RETENTION_DAYS

    cutoff = timezone.now() - datetime.timedelta(days=MODERATION_RETENTION_DAYS if days is None else days)
    deleted, _ = AiModerationEvent.objects.filter(created_at__lt=cutoff).delete()
    return deleted
