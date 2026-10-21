"""回覆後的族語詞驗證（路線圖 #18）。

助手回覆寫完後，抓出回覆裡疑似族語的詞（拉丁字母寫的詞），逐一查辭典；辭典查無的詞回傳給前端，
介面標示「辭典查無此詞形」。只標示，不刪除、不改寫回覆。

刻意的限制：
- 這裡只檢查「辭典有沒有這個詞形」，沒有檢查書寫規則（特殊字元、符號的用法）。書寫規則要先核對官方書寫系統
  再寫成檢查，不憑記憶下規則，所以還沒做。
- 族語詞形變化豐富，辭典沒收的詞形不代表寫錯（可能是變化形、人名、借詞），所以措辭只說「查無此詞形」。
- 所有候選詞合成一次輕量查詢（lookup.names），不是每個詞各查一次；本輪辭典工具已查到的詞（RecordingLookup 記下的）不再重查。
"""
import logging
import re
import unicodedata

from .tools import DictionaryLookup, candidate_forms

logger = logging.getLogger(__name__)

MAX_CHECKED = 20     # 每則回覆最多檢查幾個詞（全部合成一次查詢，不是每個詞各查一次）
MAX_FLAGGED = 5      # 最多回報幾個
_MIN_LEN = 2
_APOSTROPHES = "'’ʼ`"
_URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)


def _is_latin_char(ch: str) -> bool:
    if ch in _APOSTROPHES:
        return True
    category = unicodedata.category(ch)
    if category[0] == "M":          # 組合符號跟著前一個字母
        return True
    return category[0] == "L" and unicodedata.name(ch, "").startswith("LATIN")


def extract_candidates(text: str) -> list:
    """回覆裡以拉丁字母寫的詞，保留原樣（頭尾的撇號可能是引號，也可能是喉塞音，比對時才處理）。
    依出現順序、不分大小寫去重。略過：網址、全大寫的（AI、OK 這類縮寫）、單一字母、緊貼數字的（型號、代碼）、
    含連字號的（s-m-yaya 這類複合詞：辭典怎麼收還沒核對過，寧可不檢查，也不誤報或驗錯詞根）。
    中文裡不一定有空格（「lokah是」），所以緊貼中文字的拉丁片段照樣算一個詞。"""
    chars = _URL.sub(" ", text) + " "
    runs, buf = [], []
    for index, ch in enumerate(chars):
        if _is_latin_char(ch) or (ch == "-" and buf and index + 1 < len(chars) and _is_latin_char(chars[index + 1])):
            buf.append(ch)
            continue
        if buf:
            start = index - len(buf)
            before = chars[start - 1] if start > 0 else ""
            runs.append(("".join(buf), bool(before) and unicodedata.category(before)[0] == "N",
                         unicodedata.category(ch)[0] == "N"))
            buf = []
    words, seen = [], set()
    for token, digit_before, digit_after in runs:
        core = token.strip(_APOSTROPHES)
        key = unicodedata.normalize("NFC", core).casefold()
        if (len(core) < _MIN_LEN or core.isupper() or "-" in token or digit_before or digit_after or key in seen):
            continue
        seen.add(key)
        words.append(token)
    return words


def _normalize(name: str) -> str:
    return unicodedata.normalize("NFC", " ".join(str(name).split())).casefold().strip(_APOSTROPHES)


def query_forms(token: str) -> list:
    """一個詞要拿哪些寫法去查：原樣、去頭尾撇號、只留尾端一個撇號（喉塞音，三種撇號字元都試）；
    每一種再試 NFC / NFD，以及 candidate_forms 的大小寫與詞尾空白變體。"""
    core = token.strip(_APOSTROPHES)
    variants = [token, core, token.lstrip(_APOSTROPHES), token.rstrip(_APOSTROPHES)]
    variants += [core + mark for mark in "'’ʼ"]
    forms = []
    for variant in variants:
        for normal in dict.fromkeys((variant, unicodedata.normalize("NFC", variant), unicodedata.normalize("NFD", variant))):
            for form in candidate_forms(normal):
                if form not in forms:
                    forms.append(form)
    return forms


def find_unverified_words(text: str, known_names: set, lookup: DictionaryLookup) -> list:
    """回覆裡辭典查無的詞形（顯示用，已去掉頭尾撇號）。known_names：本輪已查到的詞（正規化後）。
    輔助檢查，任何失敗（資料庫例外、資料格式異常）都只記 log、不回報任何詞，不能影響回覆。"""
    try:
        candidates = [w for w in extract_candidates(text) if _normalize(w) not in known_names][:MAX_CHECKED]
        if not candidates:
            return []
        forms = list(dict.fromkeys(form for word in candidates for form in query_forms(word)))
        found = {_normalize(name) for name in lookup.names(forms) if isinstance(name, str)}
        flagged = [word.strip(_APOSTROPHES) for word in candidates if _normalize(word) not in found]
        return flagged[:MAX_FLAGGED]
    except Exception:  # noqa: BLE001 - 輔助檢查，失敗只記 log
        logger.exception("[AIModel] 回覆後的族語詞驗證失敗，略過驗證")
        return []
