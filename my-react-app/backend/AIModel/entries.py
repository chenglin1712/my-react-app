"""回覆旁的辭典詞條卡片（路線圖 #17）。

這一輪對話中，助手用辭典工具查到了哪些詞條，由伺服器自己記下來（RecordingLookup）；回覆寫完後，
只挑出「回覆文字裡真的有提到」的詞，做成卡片資料附在回覆旁。卡片的內容全部來自辭典資料庫，
不是模型寫的，所以它只表示「辭典有這個詞條」，不表示模型的每一句話都有出處。

與路線圖原本的做法不同：沒有使用 Anthropic Citations（search_result 區塊）。引用要改成區塊格式的
工具結果、串流要處理 citations_delta，而且這個專案的串流端點與工具迴圈還沒有用真實金鑰驗證過引用的行為；
詞條卡片只需要「查到了什麼」，伺服器本來就知道，不必依賴模型標註。
"""
import unicodedata

from .tools import MAX_ENTRIES_PER_KEYWORD, DictionaryLookup

MAX_CARDS = 5
_MIN_WORD_LEN = 2


class RecordingLookup(DictionaryLookup):
    """包住真正的辭典查詢，原樣轉發，同時把每次查到的詞條記下來（以 word_id 去重，保留第一次的順序）。"""

    def __init__(self, inner: DictionaryLookup):
        self._inner = inner
        self.inner = inner   # 回覆後驗證要另外查詢，不能經過會記錄的這一層
        self._seen: dict = {}

    def search(self, forms):
        results = self._inner.search(forms)
        # 只記模型實際看得到的：run_tool 會依 word_id 去重並只給前 MAX_ENTRIES_PER_KEYWORD 筆，
        # 這裡照同一規則，否則卡片會出現模型沒讀過的同形詞義項
        seen_ids = set()
        for entry in results:
            if entry["word_id"] in seen_ids:
                continue
            seen_ids.add(entry["word_id"])
            if len(seen_ids) <= MAX_ENTRIES_PER_KEYWORD:
                self._remember(entry)
        return results

    def get(self, word_id):
        word = self._inner.get(word_id)
        if word is not None:
            self._remember(word)
        return word

    def _remember(self, entry: dict) -> None:
        word_id = str(entry.get("word_id") or "")
        if not word_id:
            return
        current = self._seen.get(word_id)
        if current is None:
            self._seen[word_id] = {
                "word_id": word_id,
                "name": entry.get("name") or "",
                "chinese": _first_chinese(entry),
                "audio": entry.get("audio_file_id") or "",
            }
            return
        # search 與 get 各自帶的欄位不同（get 沒有 has_audio，search 沒有例句）；補上第一次沒有的值
        if not current["chinese"]:
            current["chinese"] = _first_chinese(entry)
        if not current["audio"]:
            current["audio"] = entry.get("audio_file_id") or ""

    def known_names(self) -> set:
        """本輪辭典工具查到的詞（NFC、不分大小寫、去頭尾撇號），回覆後的驗證（validators.py）不用重查。"""
        return {
            unicodedata.normalize("NFC", " ".join(entry["name"].split())).casefold().strip("'’ʼ`")
            for entry in self._seen.values()
        }

    def cards(self, reply_text: str) -> list:
        return cards_for_reply(list(self._seen.values()), reply_text)


def _first_chinese(entry: dict) -> str:
    """search 回傳 explanations 是字串清單，get 回傳的是 {chinese, ...} 清單；兩種都收。"""
    parts = []
    for item in entry.get("explanations") or []:
        text = item.get("chinese") if isinstance(item, dict) else item
        text = " ".join(str(text or "").split())
        if text:
            parts.append(text)
        if len(parts) == 2:
            break
    return "；".join(parts)[:120]


def _is_word_char(ch: str) -> bool:
    # 族語拼寫會用到撇號（喉塞音）與組合符號，這些都算詞的一部分，避免「yaya」誤中「yaya'」
    return unicodedata.category(ch)[0] in "LMN" or ch in "'’ʼ`"


def mentions(text: str, word: str) -> bool:
    """word 是否以完整詞的形式出現在 text 裡（不分大小寫；前後不能緊貼著其他字母）。"""
    # 先統一成 NFC：預組字元與「字母＋組合符號」看起來一樣，不統一會漏比對
    haystack = unicodedata.normalize("NFC", text).casefold()
    needle = unicodedata.normalize("NFC", word).casefold()
    if not needle:
        return False
    start = haystack.find(needle)
    while start != -1:
        before = haystack[start - 1] if start > 0 else ""
        after = haystack[start + len(needle)] if start + len(needle) < len(haystack) else ""
        if not (before and _is_word_char(before)) and not (after and _is_word_char(after)):
            return True
        start = haystack.find(needle, start + 1)
    return False


def cards_for_reply(entries: list, reply_text: str) -> list:
    """從記下的詞條裡，挑出回覆文字有提到的，做成前端卡片：{word_id, word, chinese, audio}。"""
    cards = []
    for entry in entries:
        word = " ".join(entry["name"].split())  # 辭典裡有些詞尾多一個空白
        if len(word) < _MIN_WORD_LEN or not mentions(reply_text, word):
            continue
        cards.append({"word_id": entry["word_id"], "word": word, "chinese": entry["chinese"], "audio": entry["audio"]})
        if len(cards) == MAX_CARDS:
            break
    return cards
