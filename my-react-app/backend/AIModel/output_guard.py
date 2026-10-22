"""模型回覆的輸出驗證（路線圖 #27）。

提示注入無法完全擋掉（模型可能被合法長度內的文字影響），所以除了在 prompt 裡把不可信的內容標成資料，
還要在【輸出端】縮小影響範圍：這個助手的任務是用中文回答族語學習問題，回覆裡不該有外部網址
（釣魚連結、被誘導貼出的追蹤網址）、電子郵件、HTML 標籤，也不該長得離譜（被誘導大量輸出）。
助手不產生引用連結（辭典詞條卡片由伺服器另外附上，不在文字裡），所以文字中的這些內容一律移除，沒有例外。

誠實的限制：這是黑名單式的最小處理，不是安全邊界。用空白拆開的網址（「evil .com」）、同形字、
「搜尋某某關鍵字」這類導流說法都擋不住，也不該為此擴大成「任意點號加字母」——那會誤殺族語正字與縮寫。
真正的防線是前端把回覆當純文字顯示（bot.jsx 沒有 Markdown／HTML 轉譯，不會產生可點的連結），這裡只是
讓不該出現的內容不被學生看到或複製。內容審核是另一項（#28）。
"""
import logging
import re
import unicodedata

logger = logging.getLogger(__name__)

# 系統提示要求 100 字內；1200 字是「明顯失控」的門檻，不是目標長度
MAX_REPLY_CHARS = 1200
LINK_REMOVED = "（已移除連結）"
CONTACT_REMOVED = "（已移除聯絡方式）"

# 零寬與方向控制字元：常被用來把網址拆開躲過比對，正常文字用不到，直接拿掉
_INVISIBLE = re.compile("[​-‏‪-‮⁠-⁤﻿­]")
# [文字](網址)、![替代文字](網址)，以及參考式 [文字][1] 與 [1]: 網址 的定義行：保留文字，丟掉網址
_MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\(\s*[^)\s]*\s*(?:\"[^\"]*\")?\)")
_MARKDOWN_REFERENCE_DEF = re.compile(r"^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$", re.MULTILINE)
_MARKDOWN_REFERENCE_USE = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_NET_SCHEMES = r"(?:https?|ftp|hxxps?)"
_OTHER_SCHEMES = r"(?:javascript|vbscript|data|mailto|tel|file|sms)"
_TLDS = (
    "com|net|org|io|tw|cn|info|xyz|top|ly|co|me|app|dev|ai|edu|gov|cloud|site|online|shop|club|live|link|click|"
    "vip|pro|biz|tk|ru|de|jp|kr|uk|us|fr|hk|sg"
)
_BARE_URL = re.compile(
    # 網路協定（含全形冒號斜線）、// 開頭、www. 開頭
    rf"(?:\b{_NET_SCHEMES}[:：][/／]{{2}}|(?<![\w/])//|\bwww\.)[^\s<>\"'）」』】]+"
    # 其他協定（javascript:、mailto: …）：後面只吃 ASCII，不把後面接著的中文一起吞掉
    rf"|\b{_OTHER_SCHEMES}[:：][A-Za-z0-9+\-._~/%?#&=@!$*(),;]+"
    # 帶常見頂級網域的裸網址
    rf"|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:{_TLDS})\b(?:/[^\s<>\"'）」』】]*)?"
    # 沒有網域名稱的 IPv4（可帶埠與路徑）
    r"|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:/[^\s<>\"'）」』】]*)?",
    re.IGNORECASE,
)
_SENTENCE_END = "。！？!?\n"


def strip_links(text: str) -> tuple[str, bool]:
    """移除網址、電子郵件與 HTML 標籤。回傳 (處理後的文字, 是否移除過)。"""
    removed = False

    def mark(replacement):
        def apply(match):
            nonlocal removed
            removed = True
            return replacement(match) if callable(replacement) else replacement
        return apply

    cleaned = _INVISIBLE.sub("", text)
    removed = cleaned != text
    cleaned = _MARKDOWN_LINK.sub(mark(lambda m: m.group(1)), cleaned)
    cleaned = _MARKDOWN_REFERENCE_DEF.sub(mark(""), cleaned)
    cleaned = _MARKDOWN_REFERENCE_USE.sub(mark(lambda m: m.group(1)), cleaned)
    cleaned = _HTML_TAG.sub(mark(""), cleaned)
    cleaned = _EMAIL.sub(mark(CONTACT_REMOVED), cleaned)
    cleaned = _BARE_URL.sub(mark(LINK_REMOVED), cleaned)
    return cleaned, removed


def _safe_cut(text: str, end: int) -> int:
    """把截斷位置往前退到不會把字母和它後面的組合符號（族語拼寫常用）拆開的地方。"""
    while 0 < end < len(text) and unicodedata.category(text[end]).startswith("M"):
        end -= 1
    return end


def truncate_reply(text: str, limit: int = MAX_REPLY_CHARS) -> tuple[str, bool]:
    """超過上限就在最後一個句尾截斷（找不到合適的句尾就硬切並加刪節號）。結果一定不超過 limit 個字元，
    且不會把字母和它的組合符號切開。"""
    if len(text) <= limit:
        return text, False
    window = text[:limit]
    cut = max(window.rfind(mark) for mark in _SENTENCE_END)
    if cut >= limit * 0.6:
        return window[: cut + 1].rstrip(), True
    return text[:_safe_cut(text, limit - 1)].rstrip() + "…", True      # 留一格給刪節號


def guard_reply(text: str, *, context: str = "") -> str:
    """回覆文字的最後一道檢查：移除網址等、限制長度。只記錄觸發了哪一項（不記內容）。"""
    cleaned, linked = strip_links(text)
    cleaned, truncated = truncate_reply(cleaned)
    if linked or truncated:
        logger.warning(
            "[AIModel] 回覆經輸出驗證調整 context=%s links_removed=%s truncated=%s original_chars=%d",
            context or "-", linked, truncated, len(text),
        )
    return cleaned


def guard_field(text: str, limit: int | None = None) -> str:
    """結構化輸出的單一欄位（補充說明、題目講解）：移除網址等，再套欄位長度上限（不拆開字母與組合符號）。"""
    cleaned, _ = strip_links(text)
    return cleaned[:_safe_cut(cleaned, limit)] if limit and len(cleaned) > limit else cleaned


# 串流用：網址由 ASCII 字元組成，結尾連續的這類字元要等到後面出現別的字元才知道網址有沒有結束
_URLISH_RUN = re.compile(r"[A-Za-z0-9:/._~%?#&=@+\-]+")
_URLISH_TAIL = re.compile(r"[A-Za-z0-9:/._~%?#&=@+\-]+$")
# 連續 200 個 ASCII 網址字元以上不是正常的回覆內容：整段丟掉，不放行前段
_MAX_URLISH_RUN = 200
# Markdown／HTML 的結構（<標籤>、[文字](網址)）可能被切在兩個片段中間，未閉合的起頭先扣住，最多扣這麼長
_MAX_OPEN_HOLD = 120


def _open_construct_start(text: str) -> int | None:
    """結尾還沒閉合的 <標籤 或 [文字 或 [文字](網址 的起點位置（沒有就回傳 None）。"""
    floor = max(0, len(text) - _MAX_OPEN_HOLD)
    starts = []
    lt = text.rfind("<", floor)
    # 只有像標籤的才扣：<後面接字母、/、! 或剛好是結尾。「3 < 5」這種數學式不扣
    if lt != -1 and ">" not in text[lt:] and (lt == len(text) - 1 or text[lt + 1].isalpha() or text[lt + 1] in "/!"):
        starts.append(lt)
    lb = text.rfind("[", floor)
    if lb != -1:
        after = text[lb:]
        close = after.find("]")
        if close == -1:
            starts.append(lb)                                  # [文字 還沒收尾
        else:
            rest = after[close + 1:]
            if rest == "" or (rest.startswith("(") and ")" not in rest):
                starts.append(lb)                              # [文字] 後面可能接 (網址)，或已經接了但還沒收尾
    return min(starts) if starts else None


class StreamGuard:
    """串流用的過濾器：一小段一小段餵進來，吐出可以安全顯示的文字。

    網址與 Markdown／HTML 結構可能被切在兩個片段中間（"https://evil." + "com"、"[說明](" + "https://…)"），
    逐片段處理會漏掉，所以結尾「可能還沒結束」的部分先扣住，等後面的字元來了再一起處理；
    連續超過 200 個網址字元的整段直接丟棄。另外只放行前 MAX_REPLY_CHARS 個字元，之後的不再顯示。
    串流正常結束時要呼叫 finish() 取回扣住的部分。最終版本以 done 事件的 guard_reply 為準（前端會用它取代）。"""

    def __init__(self, limit: int = MAX_REPLY_CHARS):
        self._pending = ""
        self._sent = 0
        self._limit = limit
        self._dropping = False                                 # 正在丟棄一段超長的網址字元

    def _release(self, text: str) -> str:
        cleaned, _ = strip_links(text)
        out = cleaned[: max(self._limit - self._sent, 0)]
        self._sent += len(out)
        return out

    def feed(self, piece: str) -> str:
        if self._dropping:
            run = _URLISH_RUN.match(piece)
            piece = piece[run.end():] if run else piece
            if piece == "":
                return ""
            self._dropping = False
        self._pending += piece

        tail = _URLISH_TAIL.search(self._pending)
        if tail and len(tail.group()) > _MAX_URLISH_RUN:
            ready = self._pending[: tail.start()]
            self._pending, self._dropping = "", True
            return self._release(ready + LINK_REMOVED)

        holds = [tail.start()] if tail else []
        opened = _open_construct_start(self._pending)
        if opened is not None:
            holds.append(opened)
        cut = min(holds) if holds else len(self._pending)
        ready, self._pending = self._pending[:cut], self._pending[cut:]
        return self._release(ready)

    def finish(self) -> str:
        ready, self._pending = self._pending, ""
        return self._release(ready)
