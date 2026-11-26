"""辭典查詢的比對用正規化（稽核 FE3-02）。

族語書寫裡的撇號（喉塞音）與組合符號（例如 U+0332 底線）是字母的一部分，不能刪掉；
但同一個詞會因為輸入裝置不同而有好幾種寫法：
- iOS 智慧標點把 ' 打成 ’，首字自動大寫；
- 撇號有 ' ’ ‘ ʼ ʻ ＇ ` ´ ′ 等多種字元；
- 同一個帶符號的字母可能是預組字（é）或「字母＋組合符號」兩個碼位；
- 中文輸入法切到全形時打出 ａｂｃ、全形空白。

原則是「比對用正規化鍵，顯示保留原字」：這裡算出來的鍵只拿來比對，回應裡的詞條名稱、
查詢字詞一律維持原樣。前端 frontend/src/_search/searchText.js 用同一套規則，兩邊要一起改。
"""
import re
import unicodedata

# 各種撇號寫法統一成 ASCII '。要在 NFKC 之前換掉：´（U+00B4）經過 NFKC 會變成「空白＋組合尖音符」，
# 先換成 ' 才不會產生多餘的空白與組合符號。
_APOSTROPHES = "’‘ʼʻʽ＇`´′‛"
_APOSTROPHE_RE = re.compile(f"[{re.escape(_APOSTROPHES)}]")
_SPACES_RE = re.compile(r"\s+")


def search_key(text) -> str:
    """回傳比對用的鍵：撇號統一 → NFKC（全形字母、全形空白轉半形；組合符號保留）→ casefold
    → NFC → 連續空白收成一個並去頭尾。不會刪掉撇號或組合符號。"""
    if not text:
        return ""
    value = _APOSTROPHE_RE.sub("'", str(text))
    value = unicodedata.normalize("NFKC", value)
    value = value.casefold()
    value = unicodedata.normalize("NFC", value)
    return _SPACES_RE.sub(" ", value).strip()
