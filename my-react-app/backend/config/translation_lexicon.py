"""族語翻譯功能的正規化／切詞／詞綴規則——純函式，不碰 DB、不碰 HTTP。

原本放在 backend/fastAPI/routes/translation/，但整支檔案零框架依賴（只用
re／unicodedata／dataclasses／typing），Django 端的
adminapi/management/commands/rebuild_translation_attested_forms.py 也要用
tokenize()／normalize_token()，原本得反過來 import FastAPI 的 route 層模組
（見 P4 review BE-6）。搬到 backend/config 這個 Django/FastAPI 共用層，兩邊
都改成從這裡 import，不再有服務互相依賴 route 層的問題。FastAPI 那邊
（fastAPI/routes/translation/service.py／retrieve.py）用
`from config import translation_lexicon as lexicon` 保留原本 `lexicon.xxx()`
的呼叫寫法，這次搬移不改動任何函式簽名或行為。

這個模組是整個翻譯功能「佐證檢核」機制的地基：LLM 對這五族語幾乎沒有可靠的
內建知識，所以每一個它輸出的族語詞形都要能對回辭典資料查證。查證分兩邊：
- SQL 端：backend/fastAPI/alembic/versions/86d389a704d0_add_translation_support.py
  的 pg_trgm 運算式索引，對 words.name／word_explanation_sentence 欄位做同樣
  的正規化（統一 ʼ(U+02BC)／ʾ(U+02BE) 兩種變音符號撇號為 ASCII '，移除阿美語
  詞尾標記 ^，轉小寫）。
- Python 端：這裡的 normalize_token()，處理使用者輸入與 LLM 輸出。

**這兩邊的正規化規則必須逐字一致**——SQL 那邊改了規則，這裡也要同步改，
否則查證會出現「資料庫裡明明有這個詞，但正規化後的字串兜不起來」的假陰性。

實際字元庫存統計（全庫 words.name，2026-08 查證，見對話紀錄）：
ʼ(U+02BC) 2,453 筆／ASCII '(U+0027) 1,601 筆／-(連字號) 1,084 筆／^(caret) 412
筆／_(底線，Tayal 用於標記央中元音，例如 b_yaring／g_yagan，屬於正字法一部分，
不能當標點濾掉)／/(斜線，用於同一詞條內的異體拼寫並列，例如
"bzyok/bzyuwak"、"m'uyay / k'yayan"，屬於詞條標記語法，不是句子裡的分隔符，
所以刻意不放進 TOKEN_RE——LLM 輸出或使用者輸入的一般文字不會用斜線隔開兩個
候選拼寫，若真的出現，讓它自然把 token 切成兩段是正確行為，不需要特別處理）。
另有 CJK 字元、全形標點等個位數筆數的資料品質雜訊（例如 "qmuzi 掛"、
"keisacukiuku (借詞) / puqaqezeljanan"），TOKEN_RE 天生不會把中文字元併入
族語 token，不需要額外過濾。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal

# ---------------------------------------------------------------------------
# 正規化
# ---------------------------------------------------------------------------

# ʼ U+02BC MODIFIER LETTER APOSTROPHE、ʾ U+02BE MODIFIER LETTER RIGHT HALF RING
# ——五族語料裡用來標記喉塞音的兩種變音符號撇號，跟 ASCII ' 混用，必須統一，
# 否則同一個詞在字典裡跟句子裡會被當成兩個不同字串。範圍刻意只涵蓋這兩個字元
# （不含 U+2018 左單引號等其他相似字元）：要跟上面 SQL 運算式索引的
# regexp_replace('[ʼʾ]', ...) 逐字對應，兩邊各自多處理任何一個字元，就會讓
# Python 端算出的正規化字串跟 SQL 端索引的正規化字串對不起來。
_APOSTROPHE_RE = re.compile("[ʼʾ]")
# 注意：不能寫成 re.compile("^")——那是「字串開頭」的零寬度錨點，.sub() 對它
# 做替換是無操作（replace 空字串為空字串），完全不會移除真正的 ^ 字元。
# 這裡要匹配的是「字面上的插入符號字元」，必須跳脫成 \^。
_CARET_RE = re.compile(r"\^")  # ^，阿美語詞尾標記，正規化時移除
_WS_RE = re.compile(r"[\s\xa0]+")
# 用字串相接組出字元類別，避免在單一 regex 字面值裡混雜跳脫單引號/雙引號
# 造成難以肉眼核對的跳脫序列。
_EDGE_PUNCT_CHARS = r"\s" + "。，！？；：、" + ",.!?;:" + '"' + "'" + "“”‘’…—"
_EDGE_PUNCT_RE = re.compile(f"^[{_EDGE_PUNCT_CHARS}]+|[{_EDGE_PUNCT_CHARS}]+$")


def _clean_chars(s: str) -> str:
    """套用撇號/caret 正規化與大小寫折疊，不動頭尾字元。詞形 token（已經用
    TOKEN_RE 切出來，不含標點）跟詞綴標記字串（頭尾的 '-' 是形狀標記，不是
    標點）共用這段核心正規化，差異只在要不要再做頭尾標點/空白清理。"""
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s)
    s = s.casefold()
    s = _APOSTROPHE_RE.sub("'", s)
    s = _CARET_RE.sub("", s)
    return s


def normalize_token(s: str) -> str:
    """單一詞形 token 的正規化——用於使用者輸入切出的詞、LLM 輸出切出的詞、
    語料詞形，三邊比對前都要先過這個函式。跟 SQL 端的運算式索引必須算出同一
    個字串（不含頭尾空白/標點：TOKEN_RE 抽出來的 token 本來就不含這些）。"""
    return _clean_chars(s)


def normalize_phrase(tokens: list[str]) -> str:
    """把已切好的 token 序列組回可以直接比對 words.name（正規化後）的字串。
    多詞詞條（如 "babaw nya'"，全庫 1,037 筆 words.name 含空格）在資料庫裡
    本來就用單一空白分隔詞條內的各部分，所以逐一正規化每個 token 後用單一
    空白 join，會跟 SQL 端對整個 name 欄位做撇號/caret 正規化＋lower（不動
    空白本身）算出同一個字串。"""
    return " ".join(normalize_token(t) for t in tokens)


def normalize_sentence(s: str) -> str:
    """整句正規化：exact_corpus 短路判斷（比對 LLM 輸出是否等於某個語料
    句子）、Jaccard 相似度輸入都用這個。跟 normalize_token 不同之處：這裡
    處理的是完整句子字串，需要額外收斂連續空白、去除頭尾標點——
    normalize_token 處理的 token 是先用 TOKEN_RE 切出來的，切出來的內容
    本來就不含標點/空白，不需要這兩步。"""
    if not s:
        return ""
    s = _clean_chars(s)
    s = _WS_RE.sub(" ", s).strip()
    s = _EDGE_PUNCT_RE.sub("", s)
    return s


def char_trigrams(s: str) -> set[str]:
    """給 Jaccard 相似度（重排候選句對／exact_corpus 短路判斷）用的字元
    三連字集合。輸入長度 <3 時退化成整個字串當一個 gram——沒有三個字可切，
    但仍要能算出非空集合，否則短輸入跟任何句子的 Jaccard 永遠是 0，會讓
    「今天」「謝謝」這類短查詢完全拿不到語料短路的機會。"""
    if not s:
        return set()
    if len(s) < 3:
        return {s}
    return {s[i:i + 3] for i in range(len(s) - 2)}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


# ---------------------------------------------------------------------------
# 切詞
# ---------------------------------------------------------------------------

# 涵蓋撇號變體、caret、底線（Tayal 央中元音標記）、連字號——用來切出族語
# 詞形的 token 邊界。刻意不含 '/'：詞條內的異體拼寫並列語法（"bzyok/bzyuwak"）
# 只出現在字典詞條本身，不是一般文字的分隔符，讓它自然把 token 切成兩段是
# 正確行為。中文字元/標點不會被這個 pattern 吃進 token，中文句子的處理在
# retrieve.py 用字元 n-gram 另外做，不透過這裡。
TOKEN_RE = re.compile(r"[A-Za-zʼʾ'\^_\-]+")


def tokenize(s: str) -> list[str]:
    """抽出一句話裡所有的族語詞形 token（丟棄標點/空白/中文字元），依原始
    順序排列。TOKEN_RE 的字元集合（撇號/caret/底線/連字號）允許切出完全
    不含字母的片段（例如單獨一個 "'"），這種片段不是詞，過濾掉——這裡曾經
    忘記濾，導致 rebuild_translation_attested_forms 指令把這類雜訊寫進
    translation_attested_form（實測全庫 14,228 筆裡有 1 筆是這種雜訊）。"""
    return [t for t in TOKEN_RE.findall(s or "") if any(ch.isalpha() for ch in t)]


def split_display_tokens(s: str) -> list[str]:
    """把整句拆成『供前端逐一渲染』的 token 序列，含詞與詞之間的標點（例如
    句尾句號），但捨棄純空白間隔（不需要渲染成獨立的 UI 元素）。呼叫端對
    每個片段用 TOKEN_RE.fullmatch() 判斷是詞形還是標點。"""
    tokens: list[str] = []
    pos = 0
    for m in TOKEN_RE.finditer(s or ""):
        if m.start() > pos:
            gap = s[pos:m.start()]
            if gap.strip():
                tokens.append(gap)
        tokens.append(m.group())
        pos = m.end()
    if pos < len(s or ""):
        gap = s[pos:]
        if gap.strip():
            tokens.append(gap)
    return tokens


_HAS_LATIN_LETTER_RE = re.compile(r"[A-Za-z]")


def is_word_token(piece: str) -> bool:
    """split_display_tokens() 切出的片段是不是可查證的族語詞形。TOKEN_RE
    本身的字元集合（撇號/caret/底線/連字號）允許一個 token 完全不含任何
    字母（例如單獨一個 "-" 或 "'''"），這種片段不是詞，是標點性質的雜訊，
    必須額外要求至少含一個拉丁字母，否則會被誤判成一個「查無佐證」的
    unsupported 詞，錯誤地拉低佐證比例。"""
    piece = piece or ""
    return bool(TOKEN_RE.fullmatch(piece)) and bool(_HAS_LATIN_LETTER_RE.search(piece))


DisplayPieceClass = Literal["word", "foreign", "punct"]


def classify_display_piece(piece: str) -> DisplayPieceClass:
    """split_display_tokens() 切出的片段分三類：
    - "word"：可查證的族語詞形（這個語言的拉丁字母拼寫），會送進辭典查表。
    - "foreign"：含字母或數字、但不是這個語言合法拼寫系統的內容（例如 LLM
      輸出裡意外夾雜的中文字、阿拉伯數字）——直接視為 unsupported，不需要
      查表（一定查不到），但**不能**跟 punct 混為一談，否則模型夾帶的中文
      字或數字會被悄悄排除在佐證比例的分母之外，等同放行未經查證的內容。
    - "punct"：純標點/空白/符號，不計入佐證比例分母。
    """
    if is_word_token(piece):
        return "word"
    if any(ch.isalnum() for ch in piece):
        return "foreign"
    return "punct"


# ---------------------------------------------------------------------------
# 詞綴規則（佐證檢核 Tier C "derived" 用）
# ---------------------------------------------------------------------------

TokenStatus = Literal["headword", "attested", "derived", "unsupported", "punct"]

# grammar_affix.affix 正規化後必須符合這個形狀才視為真詞綴：可選的頭尾單一
# 連字號（標示前綴/後綴/中綴），中間是純字母＋撇號。這會濾掉「首音節重疊
# （CV-）」「部分重疊」「ta-…-aw」這類敘述性的值，也濾掉 affix 欄位本身
# 混進中文字的資料品質雜訊。**刻意不看 grammar_affix.affix_type 欄位**：
# 實測 paiwan 有 case/negation/particle、tayal 有 adverb/negation/particle
# 這些不在 config/grammar_affixes.VALID_AFFIX_TYPES 裡的值，形狀（頭尾連字
# 號位置）才是可靠的分類依據。
_AFFIX_SHAPE_RE = re.compile(r"^-?[a-zʼʾ']+-?$")

# 剝除詞綴後的殘餘長度下限——太短的殘餘（1~2 個字母）幾乎必然是巧合命中，
# 不是真的詞綴變化，會讓 Tier C 變成橡皮圖章。
_MIN_RESIDUE_LEN = 3


@dataclass(frozen=True)
class AffixRule:
    affix: str       # 正規化後、已去除頭尾連字號的純詞綴字串，例如 "m"、"in"
    function: str     # 中文說明，例如「主事焦點（AF）／已然現在式」，供 UI 顯示
    marker: str       # 原始標記形式（保留連字號），例如 "m-"、"-in-"，供 UI 顯示


@dataclass(frozen=True)
class StripCandidate:
    residue: str
    rule: AffixRule
    kind: Literal["prefix", "suffix", "infix", "reduplication"]

    @property
    def note(self) -> str:
        if self.kind == "reduplication":
            return "重疊構詞"
        return f"{self.rule.marker}（{self.rule.function}）" if self.rule.function else self.rule.marker


@dataclass(frozen=True)
class StripRules:
    prefixes: list[AffixRule] = field(default_factory=list)
    suffixes: list[AffixRule] = field(default_factory=list)
    infixes: list[AffixRule] = field(default_factory=list)

    def strip_candidates(self, token: str) -> list[StripCandidate]:
        """對一個（已正規化的）token，列出所有「剝掉一層詞綴/重疊構詞後」的
        候選殘餘，供呼叫端逐一拿去查 Tier A（headword）／Tier B（attested）。
        只剝一層，不遞迴——遞迴剝除會讓佐證檢核失去解釋力，任何字串最終都
        能被剝到符合某個 3 字元殘餘，變成橡皮圖章。"""
        candidates: list[StripCandidate] = []

        for rule in self.prefixes:
            if token.startswith(rule.affix) and len(token) - len(rule.affix) >= _MIN_RESIDUE_LEN:
                candidates.append(StripCandidate(token[len(rule.affix):], rule, "prefix"))

        for rule in self.suffixes:
            if token.endswith(rule.affix) and len(token) - len(rule.affix) >= _MIN_RESIDUE_LEN:
                candidates.append(StripCandidate(token[:-len(rule.affix)], rule, "suffix"))

        for rule in self.infixes:
            n = len(rule.affix)
            if n == 0:
                continue
            # 中綴插入位置沒有形態學規則可循（通常插在第一個輔音之後），這裡
            # 用啟發式：嘗試字首往後數 1~4 個字元內的每個可能插入點，命中就是
            # 候選——這不是嚴謹的形態學分析，只是「有沒有可能是這個中綴」的
            # 篩選，殘餘還是要再過 Tier A/B 才算數，誤判候選不會誤判成佐證。
            # 上界必須是 min(4, ...)（原本誤寫成 5，會多測到第 5 個插入點）；
            # 且中綴後面至少要留 1 個字元（pos + n < len(token)），插入點落在
            # 字尾等同於「後綴」，不該讓中綴規則越俎代庖，那種情況本來就會被
            # 上面的後綴迴圈處理到。
            for pos in range(1, min(4, len(token) - n - 1) + 1):
                if token[pos:pos + n] == rule.affix:
                    residue = token[:pos] + token[pos + n:]
                    if len(residue) >= _MIN_RESIDUE_LEN:
                        candidates.append(StripCandidate(residue, rule, "infix"))

        for k in (1, 2, 3):
            if len(token) >= 2 * k and token[:k] == token[k:2 * k] and len(token) - k >= _MIN_RESIDUE_LEN:
                dummy_rule = AffixRule(affix="", function="重疊構詞", marker="重疊")
                candidates.append(StripCandidate(token[k:], dummy_rule, "reduplication"))

        return candidates


def build_strip_rules(affix_rows: list[dict]) -> StripRules:
    """吃 grammar_affix 該族的列（dict 需含 'affix'／'function' 鍵，比照
    dictionary_db.model.GrammarAffix 的欄位名），依形狀分類成前綴/後綴/中綴，
    濾掉不符合真詞綴形狀的列。"""
    prefixes: list[AffixRule] = []
    suffixes: list[AffixRule] = []
    infixes: list[AffixRule] = []

    for row in affix_rows:
        raw = (row.get("affix") or "").strip()
        function = (row.get("function") or "").strip()
        if not raw:
            continue

        # 結構性佔位符（如 "CV-" 代表「複製詞根第一個輔音+母音」，不是字面上
        # 要剝除的 c、v 兩個字母）跟真正的字面詞綴（如 "m-"、"-in-"）用大小寫
        # 區分：語言學記號慣例用大寫字母標記音韻類別，真正的字面詞綴在這份
        # 資料裡一律小寫。實測全庫只有 tayal／paiwan 各一筆 "CV-"
        # （affix_type='reduplication'），且重疊構詞已經由下面 k-mer 比對
        # 動態處理，這筆資料本來就是多餘的，不能讓它被誤剝成字面前綴。
        # 刻意不依賴 affix_type 欄位本身（見上方形狀分類的理由），這裡改用
        # 純字形特徵判斷。
        raw_letters = "".join(ch for ch in raw if ch.isalpha())
        if raw_letters and raw_letters.isascii() and raw_letters == raw_letters.upper():
            continue

        norm = _clean_chars(raw)
        if not _AFFIX_SHAPE_RE.match(norm):
            continue  # 「首音節重疊（CV-）」「部分重疊」「ta-…-aw」等非真詞綴

        is_prefix = norm.endswith("-") and not norm.startswith("-")
        is_suffix = norm.startswith("-") and not norm.endswith("-")
        is_infix = norm.startswith("-") and norm.endswith("-") and len(norm) > 2

        bare = norm.strip("-")
        if not bare:
            continue

        rule = AffixRule(affix=bare, function=function, marker=norm)
        if is_infix:
            infixes.append(rule)
        elif is_prefix:
            prefixes.append(rule)
        elif is_suffix:
            suffixes.append(rule)
        # 裸詞（沒有任何 '-'，形狀既不像前綴也不像後綴/中綴）——不是詞綴
        # 標記寫法，跳過。

    return StripRules(prefixes=prefixes, suffixes=suffixes, infixes=infixes)
