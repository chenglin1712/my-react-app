"""族語詞形分析器——純函式／純資料結構，不碰 DB、不碰 HTTP。

給一個沒見過的詞形，推測它的詞根與詞綴切分。跟 translation_lexicon.py 的
StripRules.strip_candidates() 的差別：那邊是人工維護的 88 筆詞綴表、最多剝
一層；這裡的規則是從辭典 words.derivative_root（衍生詞→詞根）的對照資料
自動歸納出來的，數量遠多於人工詞綴表，也涵蓋環綴（如阿美語 ma-…-ay）。

放在 backend/config 共用層（跟 translation_lexicon 同理）：評估指令在 Django
端、分析器之後要接進 FastAPI 的翻譯功能，兩邊都 import 這支，不能反過來
依賴任何一邊的 route 層。

**資料清洗的規則是評估結果能不能信的關鍵**，所以集中寫在 clean_root_field()，
評估報告會列出每一種丟棄原因的筆數。詞根欄位實測有這些雜訊：逗號分隔的多個
詞根（"baziy,baziy"）、結尾的同音異義編號（"bka'2" 的 2）、頭尾空白、
音節切分用的連字號（阿美語 "cya-taw"，這是詞本身而不是詞根）、中文說明文字
（"ma前綴詞，而fotiliʼ是詞根。"）、多詞片語、括號附註。
"""
from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Collection, Iterable, Mapping, Sequence

from config import translation_lexicon as lexicon

# 殘餘（剝掉詞綴之後剩下的詞根）長度下限。比 translation_lexicon 的 3 小，是因為
# 這裡每個候選之後都還要在詞庫裡查到才算數（詞庫查表本身就是過濾條件），
# 而詞根長度 2 的詞（如 "ba"）在這五個族語裡確實存在。
MIN_RESIDUE_LEN = 2

# 規則至少在訓練資料出現這麼多次才採用——出現 1~2 次的多半是個別詞條的特例，
# 不是能產生新詞的詞綴規則。
DEFAULT_MIN_RULE_COUNT = 3

# 中綴插入位置：詞根第 k 個字元之後（k=1..3），涵蓋「插在首輔音後」與常見的
# 首輔音叢。更長的詞綴（>3 字元）當中綴幾乎不會出現，限制長度可以避免把任意
# 內部子字串誤當成中綴。
_RULE_KINDS = ("P", "S", "I", "C", "R")
_MAX_INFIX_POSITION = 3
_MAX_INFIX_LEN = 3

_TRAILING_DIGITS_RE = re.compile(r"\d+$")
# 正規化之後的字元集合（見 _is_valid_root）；詞根不含連字號，衍生詞可以含。
_VALID_ROOT_RE = re.compile(r"[a-z'_]+")
_VALID_DERIVED_RE = re.compile(r"[a-z'_\-]+")


# ---------------------------------------------------------------------------
# 衍生詞→詞根配對的資料清洗與切分
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RootPair:
    tribe: str
    derived: str                 # 正規化後的衍生詞
    roots: tuple[str, ...]       # 正規化後、去重、保留原順序；多個代表任一個都算對


def _is_valid_root(token: str) -> bool:
    """清洗後的詞根只允許族語詞形該有的字元：小寫英文字母、撇號、底線（泰雅語央中
    元音標記），且至少一個字母。字元集合跟 translation_lexicon.TOKEN_RE 一致
    （連字號已在清洗時去掉）——不是這個字元集合的內容，不會被翻譯功能當成
    詞形處理，拿來歸納規則只會產生沒有意義的規則（例如詞根欄位裡的 "???" 或
    "123"）。U+2019（’）也不在其中：它不會被 normalize_token 統一成 ASCII 撇號，
    正式環境的詞庫索引也對不上，混進來只會造成「看起來一樣、其實比對不到」。"""
    return bool(_VALID_ROOT_RE.fullmatch(token)) and any(ch.isalpha() for ch in token)


def _is_valid_derived(token: str) -> bool:
    """衍生詞允許連字號（詞條本身可能含）；其餘同詞根。"""
    return bool(_VALID_DERIVED_RE.fullmatch(token)) and any(ch.isalpha() for ch in token)


def clean_root_field(raw: str | None, derived_norm: str) -> tuple[tuple[str, ...], str | None]:
    """清洗 words.derivative_root，回傳 (詞根們, 丟棄原因)。丟棄原因不是 None
    時，詞根們一律是空 tuple，呼叫端不該使用。

    丟棄原因：bad_root_field（中文說明／括號／多詞片語／不是族語詞形的字元）、
    empty_gold（清洗後沒有任何詞根）、self_pair（所有詞根去掉音節連字號後都
    就是衍生詞自己，例如阿美語 "cya-taw"→"cyataw" 只是音節標記，不是衍生關係）。

    多個詞根（逗號分隔）時，各自獨立判斷：逗號旁的空白不算錯，單一詞根內部
    有空白才是多詞片語；其中一個等於衍生詞自己，只丟掉那一個，不連累其他
    合法詞根。
    """
    text = (raw or "").strip()
    if not text:
        return (), "empty_gold"

    own = derived_norm.replace("-", "")
    roots: list[str] = []
    saw_self = False
    for part in text.split(","):
        part = part.strip()
        if re.search(r"\s", part):
            return (), "bad_root_field"
        part = _TRAILING_DIGITS_RE.sub("", part)
        part = lexicon.normalize_token(part).replace("-", "").strip()
        if not part:
            continue
        # 中文說明文字、括號附註、其他標點、U+2019 等一律在這道白名單被擋下
        # （normalize_token 已先把 U+02BC／U+02BE 統一成 ASCII 撇號）。
        if not _is_valid_root(part):
            return (), "bad_root_field"
        if part == own:
            saw_self = True
            continue
        if part not in roots:
            roots.append(part)

    if roots:
        return tuple(roots), None
    return (), ("self_pair" if saw_self else "empty_gold")


def build_pairs(rows: Iterable[tuple[str, str | None, str | None]]) -> tuple[list[RootPair], Counter]:
    """rows 是 (族語名稱, 衍生詞原始字串, 詞根欄位原始字串)。回傳清洗後的配對
    與各丟棄原因的筆數。同一 (族語, 衍生詞) 出現多列（同形異義詞條）時，合併
    成一筆、詞根取聯集，避免同一個詞在測試集裡被重複計算。"""
    dropped: Counter = Counter()
    merged: dict[tuple[str, str], list[str]] = {}
    order: list[tuple[str, str]] = []

    for tribe, derived_raw, root_raw in rows:
        derived = lexicon.normalize_token((derived_raw or "").strip())
        if not derived or not _is_valid_derived(derived):
            dropped["bad_derived"] += 1
            continue
        roots, reason = clean_root_field(root_raw, derived)
        if reason:
            dropped[reason] += 1
            continue
        key = (tribe, derived)
        if key not in merged:
            merged[key] = []
            order.append(key)
        for r in roots:
            if r not in merged[key]:
                merged[key].append(r)

    pairs = [RootPair(t, d, tuple(merged[(t, d)])) for (t, d) in order]
    return pairs, dropped


def is_test_pair(tribe: str, derived: str, *, holdout_mod: int = 5) -> bool:
    """決定性切分：同一個 (族語, 衍生詞) 永遠落在同一邊，不依賴亂數種子或資料
    列順序，所以辭典增減詞條之後，沒動到的配對不會從訓練集跳到測試集。"""
    if holdout_mod <= 0:
        raise ValueError(f"holdout_mod 必須是正整數：{holdout_mod}")
    digest = hashlib.sha1(f"{tribe}|{derived}".encode("utf-8")).hexdigest()
    return int(digest, 16) % holdout_mod == 0


# ---------------------------------------------------------------------------
# 規則
# ---------------------------------------------------------------------------

@dataclass(frozen=True, order=True)
class MorphRule:
    """一條「詞根 → 衍生詞」的形態規則。

    kind：P 前綴（a）、S 後綴（a）、I 中綴（a，插在詞根第 k 個字元之後）、
    C 環綴（a 是前半、b 是後半）、R 重疊（複製詞根開頭 k 個字元放在詞根前面）。
    """
    kind: str
    a: str = ""
    b: str = ""
    k: int = 0

    def __post_init__(self):
        # 空詞綴或非正的位置會讓 apply() 把整個 token 原封不動當成「殘餘」，負的 k
        # 還會靠 Python 的負索引在意外的位置剝字元。規則可能從設定檔或反序列化
        # 建構，不能只靠 derive_rules() 保證合法，這裡直接拒絕。
        if self.kind not in _RULE_KINDS:
            raise ValueError(f"未知的規則類型：{self.kind!r}")
        if self.kind in ("P", "S", "I", "C") and not self.a:
            raise ValueError(f"{self.kind} 規則的詞綴不可為空")
        if self.kind == "C" and not self.b:
            raise ValueError("C 規則的後半詞綴不可為空")
        if self.kind in ("I", "R") and self.k <= 0:
            raise ValueError(f"{self.kind} 規則的 k 必須是正整數：{self.k}")

    def apply(self, token: str) -> str | None:
        """反向套用：從衍生詞還原詞根。不適用、或殘餘短於 MIN_RESIDUE_LEN 時
        回傳 None。呼叫端還要自己確認殘餘真的是詞庫裡的詞，這裡只管字串操作。"""
        kind = self.kind
        if kind == "P":
            if token.startswith(self.a):
                residue = token[len(self.a):]
                return residue if len(residue) >= MIN_RESIDUE_LEN else None
        elif kind == "S":
            if token.endswith(self.a):
                residue = token[:len(token) - len(self.a)]
                return residue if len(residue) >= MIN_RESIDUE_LEN else None
        elif kind == "I":
            n = len(self.a)
            if token[self.k:self.k + n] == self.a:
                residue = token[:self.k] + token[self.k + n:]
                return residue if len(residue) >= MIN_RESIDUE_LEN else None
        elif kind == "C":
            if token.startswith(self.a) and token.endswith(self.b):
                # 前後半重疊（token 太短放不下兩半）時切片會是空字串，下面的殘餘長度
                # 檢查會擋掉，不需要另外比較長度。
                residue = token[len(self.a):len(token) - len(self.b)]
                return residue if len(residue) >= MIN_RESIDUE_LEN else None
        elif kind == "R":
            k = self.k
            if len(token) >= 2 * k and token[:k] == token[k:2 * k]:
                residue = token[k:]
                return residue if len(residue) >= MIN_RESIDUE_LEN else None
        return None

    def segment(self, token: str) -> list[tuple[str, str]] | None:
        """把衍生詞切成 [(片段, 種類)]，種類是 "root"（詞根）、"affix"（詞綴）、"redup"
        （重疊的那一段）；規則不適用於這個詞時回傳 None。所有片段接起來必定等於原 token，
        給介面標示哪一段是詞綴、哪一段是詞根用。"""
        root = self.apply(token)
        if root is None:
            return None
        kind = self.kind
        if kind == "P":
            parts = [(self.a, "affix"), (root, "root")]
        elif kind == "S":
            parts = [(root, "root"), (self.a, "affix")]
        elif kind == "I":
            parts = [(root[:self.k], "root"), (self.a, "affix"), (root[self.k:], "root")]
        elif kind == "C":
            parts = [(self.a, "affix"), (root, "root"), (self.b, "affix")]
        else:
            parts = [(token[:self.k], "redup"), (root, "root")]
        return [(text, seg_kind) for text, seg_kind in parts if text]

    def generate(self, root: str) -> str:
        """正向套用：把詞根變成衍生詞，是 apply() 的反運算（apply(generate(r)) == r，
        只要 r 夠長）。用來造「保留真實詞綴、只換詞幹」的假詞，也是之後出
        『有語言學意義的干擾項』的基礎。"""
        if self.kind == "P":
            return self.a + root
        if self.kind == "S":
            return root + self.a
        if self.kind == "I":
            return root[:self.k] + self.a + root[self.k:]
        if self.kind == "C":
            return self.a + root + self.b
        return root[:self.k] + root

    @property
    def marker(self) -> str:
        """給人看的標記形式，格式比照 grammar_affix.affix（前綴 "m-"、後綴 "-en"、
        中綴 "-in-"）。"""
        if self.kind == "P":
            return f"{self.a}-"
        if self.kind == "S":
            return f"-{self.a}"
        if self.kind == "I":
            return f"-{self.a}-"
        if self.kind == "C":
            return f"{self.a}-…-{self.b}"
        return f"重疊{self.k}"


def derive_rules(derived: str, root: str, kinds: str = "PSICR") -> list[MorphRule]:
    """列出所有能把 root 變成 derived 的簡單規則。一個配對可能同時符合多條規則
    （例如 "ma"+"alaw" 同時像前綴 ma- 又像前綴 m- 加重疊開頭），全部列出來，
    之後靠頻次與精確度排序，不在這裡武斷挑一條。"""
    rules: list[MorphRule] = []
    # 詞根短於殘餘下限時，apply() 一定會拒絕，歸納出來的規則在分析時永遠不可能
    # 命中同一個案例，不能讓它灌高規則的出現次數。
    if derived == root or len(root) < MIN_RESIDUE_LEN:
        return rules

    if "P" in kinds and derived.endswith(root) and len(derived) > len(root):
        rules.append(MorphRule("P", a=derived[:len(derived) - len(root)]))
    if "S" in kinds and derived.startswith(root) and len(derived) > len(root):
        rules.append(MorphRule("S", a=derived[len(root):]))

    if "I" in kinds and len(derived) > len(root):
        ins_len = len(derived) - len(root)
        if 1 <= ins_len <= _MAX_INFIX_LEN:
            for k in range(1, min(_MAX_INFIX_POSITION, len(root) - 1) + 1):
                if derived[:k] == root[:k] and derived[k + ins_len:] == root[k:]:
                    rules.append(MorphRule("I", a=derived[k:k + ins_len], k=k))

    if "C" in kinds:
        idx = derived.find(root)
        while idx != -1:
            if idx > 0 and idx + len(root) < len(derived):
                rules.append(MorphRule("C", a=derived[:idx], b=derived[idx + len(root):]))
            idx = derived.find(root, idx + 1)

    if "R" in kinds:
        for k in (1, 2, 3):
            if k <= len(root) and derived == root[:k] + root:
                rules.append(MorphRule("R", k=k))

    # 去重並保留順序（C 的 find 迴圈在詞根重複出現時可能產生相同規則）；同時用
    # 反向套用驗證每條規則——只留下真的能把 derived 還原成 root 的。
    seen: set[MorphRule] = set()
    out: list[MorphRule] = []
    for r in rules:
        if r not in seen and r.apply(derived) == root:
            seen.add(r)
            out.append(r)
    return out


# 解釋一個衍生詞時，優先採用的規則種類：詞首／詞尾的詞綴最自然，其次環綴，最後才是
# 中綴與重疊（它們比較容易是巧合）。
_RULE_KIND_PREFERENCE = {"P": 0, "S": 1, "C": 2, "I": 3, "R": 4}


def simplest_rule(rules: Iterable[MorphRule]) -> MorphRule:
    """從能解釋同一個衍生詞的多條規則裡挑出最自然的一條（決定性）。"""
    return min(rules, key=lambda r: (_RULE_KIND_PREFERENCE[r.kind], r))


def induce_rules(train_pairs: Iterable[RootPair], lexicon_set: Collection[str], *,
                 min_count: int = DEFAULT_MIN_RULE_COUNT, kinds: str = "PSICR") -> Counter:
    """從訓練配對歸納規則，回傳 {規則: 出現次數}（只含次數 >= min_count 者）。
    只用「詞根真的在詞庫裡」的配對：詞庫外的詞根無法在分析時被驗證，拿來歸納
    只會讓規則偏向無法驗證的案例。"""
    counts: Counter = Counter()
    for pair in train_pairs:
        for root in pair.roots:
            if root not in lexicon_set:
                continue
            for rule in derive_rules(pair.derived, root, kinds):
                counts[rule] += 1
    return Counter({r: n for r, n in counts.items() if n >= min_count})


def estimate_rule_precision(train_pairs: Iterable[RootPair], rules: Collection[MorphRule],
                            lexicon_set: Collection[str]) -> dict[MorphRule, float]:
    """每條規則的精確度估計：在訓練配對上，這條規則『剝完之後殘餘在詞庫裡』
    的次數裡，有多少次殘餘剛好是正確詞根。用 (對+1)/(總+2) 平滑，避免只出現
    過 3 次的規則被估成 100%。

    注意這是在訓練集自己身上量的，偏樂觀；它只用來排序，不當作對外顯示的信心。
    對外信心要看留出測試集的實測（見評估指令）。"""
    applicable: Counter = Counter()
    correct: Counter = Counter()
    pairs = list(train_pairs)
    for rule in rules:
        for pair in pairs:
            residue = rule.apply(pair.derived)
            if residue is None or residue not in lexicon_set:
                continue
            applicable[rule] += 1
            if residue in pair.roots:
                correct[rule] += 1
    return {rule: (correct[rule] + 1) / (applicable[rule] + 2) for rule in rules}


# ---------------------------------------------------------------------------
# 容許詞根母音變化的模糊比對（泰雅語的詞根在加詞綴時常有母音脫落／替換，
# 例如 lamu' → lmway、saqit → sqiti，單純字串剝除還原不回來）
# ---------------------------------------------------------------------------

def _deletion_keys(word: str, max_dist: int) -> set[str]:
    keys = {word}
    frontier = {word}
    for _ in range(max_dist):
        nxt: set[str] = set()
        for w in frontier:
            for i in range(len(w)):
                nxt.add(w[:i] + w[i + 1:])
        keys |= nxt
        frontier = nxt
    return keys


def _bounded_levenshtein(a: str, b: str, limit: int) -> int:
    """a、b 的編輯距離；超過 limit 就提早放棄回傳 limit+1。"""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        row_min = i
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            val = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            cur.append(val)
            row_min = min(row_min, val)
        if row_min > limit:
            return limit + 1
        prev = cur
    return prev[-1]


class EditIndex:
    """詞庫的刪除鄰域索引（SymSpell 的作法）：兩個字串編輯距離 <= d，則各刪掉
    至多 d 個字元後必有相同結果，所以先用刪除鍵縮小候選，再用真正的編輯距離
    驗證。詞庫每族約 3~9 千筆，索引大小可以接受。"""

    def __init__(self, words: Iterable[str], max_dist: int):
        # 只支援 1、2：距離越大，索引鍵數量爆增，命中的也越不可信（對佐證檢核而言
        # 是錯誤放行的來源）。
        if max_dist not in (1, 2):
            raise ValueError(f"max_dist 只能是 1 或 2：{max_dist}")
        self.max_dist = max_dist
        self._index: dict[str, set[str]] = defaultdict(set)
        for w in words:
            if " " in w:
                continue  # 多詞詞條不是單一詞根
            for key in _deletion_keys(w, max_dist):
                self._index[key].add(w)

    def neighbors(self, query: str) -> dict[str, int]:
        found: dict[str, int] = {}
        for key in _deletion_keys(query, self.max_dist):
            for w in self._index.get(key, ()):
                if w in found:
                    continue
                d = _bounded_levenshtein(query, w, self.max_dist)
                if d <= self.max_dist:
                    found[w] = d
        return found


# ---------------------------------------------------------------------------
# 分析器
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Analysis:
    root: str
    rule: MorphRule
    score: float
    stage: str            # "exact"（剝完直接是詞庫詞）｜"fuzzy"（容許編輯距離）
    distance: int = 0
    support: int = 0      # 這條規則在訓練資料出現的次數；次數少的規則不該被當成強證據


# 模糊比對的殘餘長度下限：太短的字串差 1~2 個字元就會命中一大堆不相干的詞。
_FUZZY_MIN_RESIDUE_LEN = 4
# 每增加 1 的編輯距離，分數打這個折扣；剝完直接命中的候選永遠排在模糊候選前面。
_FUZZY_DISTANCE_DISCOUNT = 0.5


class MorphAnalyzer:
    """從歸納規則還原詞根的分析器。

    **用在佐證檢核時的安全守則**（錯誤放行比漏判嚴重得多，實測見
    adminapi 的 evaluate_morphology_analyzer 指令）：
    1. 只接受 stage == "exact" 的候選。模糊比對實測會讓六到八成「改了一個字母的
       亂造詞」找到詞根，只能當「你是不是想打…」的提示，不能提升佐證狀態。
    2. 呼叫端要先用 normalize_token() 正規化 token，並使用同一個族語的分析器；
       這裡不做這兩件事。
    3. 要設定 min_rule_precision > 0；它是規則在訓練資料上的精確度估計（偏樂觀，
       而且只在「有衍生詞標註」的正例資料上量），不是「候選正確的機率」，單靠它
       不足以決定放行，應再用獨立的負例集校準。
    4. 建構 EditIndex 很貴，依族語在服務啟動時建一次並快取，不要每個請求重建。
    """

    def __init__(self, rules: Mapping[MorphRule, int], lexicon_set: Collection[str], *,
                 precision: Mapping[MorphRule, float] | None = None,
                 rank_by: str = "precision", max_edit: int = 0, min_rule_precision: float = 0.0,
                 min_root_len: int = MIN_RESIDUE_LEN):
        if rank_by not in ("precision", "count"):
            raise ValueError(f"rank_by 只能是 precision 或 count：{rank_by}")
        if max_edit not in (0, 1, 2):
            raise ValueError(f"max_edit 只能是 0（關閉）、1 或 2：{max_edit}")
        if not 0.0 <= min_rule_precision <= 1.0:
            raise ValueError(f"min_rule_precision 必須介於 0 與 1：{min_rule_precision}")
        if min_rule_precision > 0.0 and rank_by != "precision":
            # count 模式的分數是訓練次數，不是機率，拿來跟 0~1 的門檻比較沒有意義。
            raise ValueError("min_rule_precision 只能搭配 rank_by='precision' 使用")
        if min_root_len < MIN_RESIDUE_LEN:
            raise ValueError(f"min_root_len 不可小於 {MIN_RESIDUE_LEN}：{min_root_len}")
        self.min_root_len = min_root_len
        self.rules = dict(rules)
        self.precision = dict(precision or {})
        if any(not math.isfinite(v) or not 0.0 <= v <= 1.0 for v in self.precision.values()):
            raise ValueError("precision 的值必須是 0 到 1 之間的有限數")
        if rank_by == "precision":
            # 缺精確度的規則會被當成 0 分照常回傳，整合層忘了傳 precision 就會悄悄
            # 產生零分候選，所以直接要求每條規則都有精確度。
            missing = [r for r in self.rules if r not in self.precision]
            if missing:
                raise ValueError(f"rank_by='precision' 時每條規則都要有精確度，缺 {len(missing)} 條，例如 {missing[0]}")
        self.lexicon = lexicon_set
        self.rank_by = rank_by
        self.max_edit = max_edit
        # 低於這個「規則精確度估計」的規則整條不用。注意比較的是規則本身的精確度，
        # 不是候選最後的分數：模糊候選的 Analysis.score 還會再打折，可能低於這個
        # 門檻——所以才要求呼叫端另外用 stage 擋掉模糊候選。
        # 泰雅語實測，門檻 0.5 大約讓「改一個字母的亂造詞」放行率減半（約 4~6% →
        # 2~3%，依亂數取樣略有不同），真實衍生詞的放行率少約 8 個百分點。
        self.min_rule_precision = min_rule_precision
        self._edit_index = EditIndex(lexicon_set, max_edit) if max_edit > 0 else None

    def _rule_score(self, rule: MorphRule) -> float:
        if self.rank_by == "count":
            return float(self.rules[rule])
        return self.precision.get(rule, 0.0)

    def analyze(self, token: str, top_n: int = 3) -> list[Analysis]:
        """對一個已正規化的詞形，回傳最多 top_n 個「詞根候選」，由好到壞。同一個
        詞根被多條規則還原時只留最好的那條。"""
        best: dict[str, Analysis] = {}

        def consider(a: Analysis) -> None:
            cur = best.get(a.root)
            if cur is None or _analysis_key(a, self.rules) < _analysis_key(cur, self.rules):
                best[a.root] = a

        for rule in self.rules:
            if self._rule_score(rule) < self.min_rule_precision:
                continue
            residue = rule.apply(token)
            # 太短的詞根（只有 2 個字母）很容易碰巧撞到詞庫裡的另一個詞，錯放行風險
            # 比長詞根高得多；min_root_len 讓佐證用途可以直接排除它們。
            if residue is None or len(residue) < self.min_root_len:
                continue
            support = self.rules[rule]
            if residue in self.lexicon:
                consider(Analysis(residue, rule, self._rule_score(rule), "exact", 0, support))
            elif self._edit_index is not None and len(residue) >= _FUZZY_MIN_RESIDUE_LEN:
                for word, dist in self._edit_index.neighbors(residue).items():
                    if word == token:
                        continue
                    score = self._rule_score(rule) * (_FUZZY_DISTANCE_DISCOUNT ** dist)
                    consider(Analysis(word, rule, score, "fuzzy", dist, support))

        ranked = sorted(best.values(), key=lambda a: _analysis_key(a, self.rules))
        return ranked[:top_n]


def _analysis_key(a: Analysis, rules: Mapping[MorphRule, int]):
    # 直接命中永遠優先於模糊命中；其餘依分數降冪、編輯距離升冪、規則頻次降冪，
    # 最後用詞根字串、規則本身打破平手，讓同樣的輸入永遠得到同樣的結果（可重現，
    # 測試也穩定）。兩種 rank_by 共用同一個 key，差別只在 score 的來源。
    stage_rank = 0 if a.stage == "exact" else 1
    return (stage_rank, -a.score, a.distance, -rules.get(a.rule, 0), a.root, a.rule)


def build_function_table(affix_rows: Iterable[Mapping[str, str | None]]) -> dict[str, str]:
    """grammar_affix 的列 → {正規化後的標記: 功能說明}，給 describe_rule() 查詞綴
    功能用。標記沿用資料表原本的寫法（"m-"、"-in-"、"-en"）。"""
    table: dict[str, str] = {}
    for row in affix_rows:
        raw = (row.get("affix") or "").strip()
        func = (row.get("function") or "").strip()
        if raw and func:
            table.setdefault(lexicon.normalize_token(raw), func)
    return table


def describe_rule(rule: MorphRule, function_table: Mapping[str, str]) -> str | None:
    """規則對應的詞綴功能說明；查不到就回傳 None（不編造）。環綴是前半加後半，
    兩半各自查得到才組合顯示，只查到一半就只顯示那一半。"""
    if rule.kind == "R":
        return "重疊構詞"
    if rule.kind == "C":
        parts = [function_table.get(f"{rule.a}-"), function_table.get(f"-{rule.b}")]
        found = [p for p in parts if p]
        return "；".join(found) if found else None
    return function_table.get(rule.marker)


# ---------------------------------------------------------------------------
# 評估
# ---------------------------------------------------------------------------

@dataclass
class Metrics:
    total: int = 0
    answered: int = 0     # 至少有一個候選
    top1: int = 0
    top3: int = 0

    @property
    def coverage(self) -> float:
        return self.answered / self.total if self.total else 0.0

    @property
    def top1_acc(self) -> float:
        return self.top1 / self.total if self.total else 0.0

    @property
    def top3_acc(self) -> float:
        return self.top3 / self.total if self.total else 0.0

    @property
    def precision_at_1(self) -> float:
        """有給答案時，第一名答對的比例。"""
        return self.top1 / self.answered if self.answered else 0.0


def evaluate(predict: Callable[[str], Sequence[str]], test_pairs: Iterable[RootPair]) -> Metrics:
    """predict(token) 回傳由好到壞的詞根候選。任一個 gold 詞根出現在前 k 名就算對。"""
    m = Metrics()
    for pair in test_pairs:
        m.total += 1
        # 候選去重：同一個詞根重複出現不該佔掉 top-3 的名額。
        preds = list(dict.fromkeys(predict(pair.derived)))
        if not preds:
            continue
        m.answered += 1
        gold = set(pair.roots)
        if preds[0] in gold:
            m.top1 += 1
        if any(p in gold for p in preds[:3]):
            m.top3 += 1
    return m
