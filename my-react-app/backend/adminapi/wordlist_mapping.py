"""千詞表對照：解析官方詞表 CSV，並把每個詞形對辭典做「唯讀」比對（不寫辭典）。

比對規則（互斥、依序）只依字串，不下語言學結論：
  skip_placeholder  詞表占位項（含「無此詞」）
  manual_multiple   同族語完全同名的辭典詞條有多筆
  same_dialect_unique / unknown_dialect_unique / cross_dialect_unique
                    唯一完全同名；既有語別等於目標語別 → same；未標（NULL／空字串）→ unknown（不能證明是目標語別）；
                    其他語別 → cross
  manual_near_form  沒有完全同名，但去頭尾空白、撇號統一、casefold、去 ^ : 之後相同
  new               以上皆否
「完全同名」比較的是 NFC 後的原字串，所以辭典詞條名稱帶尾端空白者（例如 'na '）會落在 near_form，
不會被當成同一筆自動合併。
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path

from adminapi.models.wordlist import (
    MATCH_CROSS_DIALECT, MATCH_MANUAL_MULTIPLE, MATCH_NEAR_FORM, MATCH_NEW,
    MATCH_SAME_DIALECT, MATCH_SKIP_PLACEHOLDER, MATCH_UNKNOWN_DIALECT, WordlistEntry, WordlistForm,
)

# 題庫標示的語別。dialect_in_dictionary：words.dialect 等於這個字串才算「同語別」；NULL／空字串是「未標」，不是同語別
TARGETS = {
    "tayal": {"label": "賽考利克泰雅", "file_key": "賽考利克泰雅語", "dictionary_dialect": "賽考利克泰雅語"},
    "amis": {"label": "秀姑巒阿美", "file_key": "秀姑巒阿美語", "dictionary_dialect": "秀姑巒阿美語"},
    "bunun": {"label": "郡群布農", "file_key": "郡群布農語", "dictionary_dialect": "郡群布農語"},
    "kavalan": {"label": "噶瑪蘭", "file_key": "噶瑪蘭語", "dictionary_dialect": "噶瑪蘭語"},
    "paiwan": {"label": "中排灣", "file_key": "中排灣語", "dictionary_dialect": "中排灣語"},
}
# 官方學習詞表只有一份、因此辭典『未標語別』也能視為該語別的族語（只影響自動接受的資格，不改變 match_class，也不回填 dialect）
SINGLE_LIST_TRIBES = frozenset({"kavalan"})
# 可以自動新增詞條的族語。排灣排除：題庫、翻譯、搜尋、AI 查詞都只分族、不分語別，中排灣詞會混進北排灣詞池；
# 阿美、噶瑪蘭排除：新增詞形會讓形態放行檔的詞庫指紋對不上而停用引擎，要重新校準後才能新增。
CREATE_TRIBES = frozenset({"tayal", "bunun"})
_CREATE_NAMESPACE = uuid.UUID("5b0f3c1e-7a42-4d8e-9c55-2f6e0b8a4d17")


def create_target_id(tribe: str, form: str) -> str:
    """新詞條 id：由（族語, NFC 詞形）決定，所以同一個詞形在詞表出現多次也只會對到同一個詞條。"""
    return str(uuid.uuid5(_CREATE_NAMESPACE, f"{tribe}\0{nfc(form)}"))


PLACEHOLDERS = frozenset({"無此詞", "無此詞彙"})
PLACEHOLDER_HINT = "無此詞"
_APOSTROPHES = ("’", "ʼ", "ʾ", "‘", "′")
MAX_CANDIDATES = 20
SENSE_EXACT, SENSE_CONTAINS, SENSE_NONE, SENSE_NO_EXPLANATION = "exact_sense", "contains", "none", "no_explanation"
_SENSE_SPLIT = re.compile(r"[、／/；;，,]")
_SENSE_STRIP = re.compile(r"[（(][^）)]*[）)]|[\s。.．!！?？]")
MAX_FILE_BYTES = 5_000_000


class WordlistError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedEntry:
    seq: int
    code: str
    zh: str
    raw: str
    note: str
    level: str
    category: str


@dataclass(frozen=True)
class ParsedList:
    tribe: str
    label: str
    source_label: str
    sha256: str
    entries: tuple


def senses(text: str) -> set:
    """把中文釋義拆成義項字串：依 、／；，分隔、去掉括號註解與空白標點。只用於比對，不改寫任何資料。"""
    out = set()
    for part in _SENSE_SPLIT.split(text or ""):
        p = _SENSE_STRIP.sub("", part).strip()
        if p:
            out.add(p)
    return out


def sense_agreement(zh: str, explanations) -> str:
    """詞表中文與辭典既有釋義是否指同一個義項。exact_sense＝某個義項字串完全相同（唯一可用於自動接受的證據）；
    contains＝詞表義項（至少 2 字）出現在釋義文字裡或反過來（只當線索，要人看）；none＝看不出關聯；
    no_explanation＝辭典詞條沒有任何有實質文字的中文釋義（沒有證據可比）。"""
    texts = [t for t in explanations if t and t.strip()]
    if not texts:
        return SENSE_NO_EXPLANATION
    a = senses(zh)
    if any(a & senses(t) for t in texts):
        return SENSE_EXACT
    zh_plain = _SENSE_STRIP.sub("", zh)
    for t in texts:
        plain = _SENSE_STRIP.sub("", t)
        if any(len(s) >= 2 and s in plain for s in a) or any(len(b) >= 2 and b in zh_plain for b in senses(t)):
            return SENSE_CONTAINS
    return SENSE_NONE


def is_placeholder(form: str) -> bool:
    f = nfc(form).strip()
    if f in PLACEHOLDERS:
        return True
    if PLACEHOLDER_HINT in f:
        raise WordlistError(f"疑似占位項但寫法不在已知清單：{f!r}")
    return False


def split_forms(cell: str) -> list[str]:
    """一格可能有多個詞形，只依明確的 '/' 分隔，不猜其他格式。"""
    return [p.strip() for p in cell.split("/") if p.strip()]


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def loose_key(s: str) -> str:
    """寬鬆比對鍵：只用來找『近似形』候選，不主張它們等價。"""
    s = nfc(s).strip()
    for ch in _APOSTROPHES:
        s = s.replace(ch, "'")
    return s.replace("^", "").replace(":", "").casefold()


def parse_wordlist_csv(path: Path, tribe: str) -> ParsedList:
    target = TARGETS[tribe]
    if not path.is_file():
        raise WordlistError(f"不是一般檔案：{path.name}")
    with path.open("rb") as fh:
        raw_bytes = fh.read(MAX_FILE_BYTES + 1)         # 同一次讀取就限制大小，不先 stat 再讀
    if len(raw_bytes) > MAX_FILE_BYTES:
        raise WordlistError(f"詞表檔太大：{path.name}")
    rows = list(csv.reader(io.StringIO(raw_bytes.decode("utf-8-sig"))))
    if not rows or len(rows[0]) < 5 or not rows[0][4].strip():
        raise WordlistError(f"詞表檔頭不完整：{path.name}")
    head_dialect, source_label = rows[0][2].strip(), rows[0][4].strip()
    if target["file_key"] not in head_dialect:
        raise WordlistError(f"檔頭語別（{head_dialect}）與預期（{target['file_key']}）不符：{path.name}")
    entries, category, seen = [], "", set()
    for line_no, r in enumerate(rows[1:], 2):
        if not any(x.strip() for x in r):
            continue
        if r[0].strip() == "序號" or (line_no == 2 and target["file_key"] in "".join(r)):
            continue                                            # 欄位標題列、語別標題列
        if r[0] == "類別":
            category = r[1].strip()
            if not category:
                raise WordlistError(f"類別名稱空白：第 {line_no} 列（{path.name}）")
            continue
        if len(r) < 6 or not r[0].strip().isdigit():
            raise WordlistError(f"無法辨識的資料列：第 {line_no} 列（{path.name}）")
        e = ParsedEntry(int(r[0]), r[1].strip(), r[2].strip(), r[3], r[4].strip(), r[5].strip(), category)
        if not e.code or e.code in seen:
            raise WordlistError(f"詞表編號空白或重複：{e.code!r}（{path.name}）")
        if not e.raw.strip() or not category or not e.zh or not e.level:
            raise WordlistError(f"詞表欄位空白：{e.code}（{path.name}）")
        seen.add(e.code)
        entries.append(e)
    if [e.seq for e in entries] != list(range(1, len(entries) + 1)):
        raise WordlistError(f"詞表序號不連續（疑似遺漏列）：{path.name}")
    if not entries:
        raise WordlistError(f"詞表沒有任何條目：{path.name}")
    return ParsedList(tribe, target["label"], source_label, hashlib.sha256(raw_bytes).hexdigest(), tuple(entries))


def find_list_file(directory: Path, tribe: str) -> Path:
    key = TARGETS[tribe]["file_key"]
    hits = sorted(p for p in directory.glob("*.csv") if key in p.name)
    if len(hits) != 1:
        raise WordlistError(f"{tribe} 需要恰好一份檔名含「{key}」的 CSV，找到 {len(hits)} 份")
    return hits[0]


@dataclass(frozen=True)
class DictionarySnapshot:
    """某族語在辭典的唯讀快照：exact[name]→[(id, dialect, has_explanation)]；near[loose_key]→[(id, name, dialect)]。"""
    exact: dict
    near: dict
    explanations: dict = None     # word_id -> tuple(有實質文字的中文釋義)


def load_snapshot(db, tribe_id: str) -> DictionarySnapshot:
    from dictionary_db.model import Word, WordExplanation

    # 釋義是否「有實質文字」在 Python 判斷（str.strip 處理全部 Unicode 空白；PostgreSQL trim 只處理空格）
    texts = {}
    for wid, text in db.query(WordExplanation.word_id, WordExplanation.chinese_explanation).order_by(WordExplanation.id).all():
        if text and text.strip():
            texts.setdefault(wid, []).append(text)
    explained = set(texts)
    exact, near = {}, {}
    for wid, name, dialect in db.query(Word.id, Word.name, Word.dialect).filter(Word.tribe_id == tribe_id).order_by(Word.id).all():
        if name is None:
            continue
        exact.setdefault(nfc(name), []).append((wid, dialect, wid in explained))
        near.setdefault(loose_key(name), []).append((wid, name, dialect))
    return DictionarySnapshot(exact, near, {w: tuple(v) for w, v in texts.items()})


@dataclass(frozen=True)
class Classified:
    match_class: str
    candidates: list          # 展示用，最多 MAX_CANDIDATES 筆
    candidate_count: int
    fingerprint: str = ""     # 【完整】候選集合（含各候選的釋義文字雜湊）的雜湊，決定依據用它，所以第 21 筆以後的變動也看得到
    sense_check: str = ""     # 只有『恰好一個完全同名候選』才有值：exact_sense／contains／none／no_explanation


def classify(form: str, tribe: str, snap: DictionarySnapshot, zh: str = "") -> Classified:
    if is_placeholder(form):
        return Classified(MATCH_SKIP_PLACEHOLDER, [], 0, _fp([]))
    f = nfc(form).strip()
    hits = snap.exact.get(f, [])
    cands = [{"word_id": w, "dialect": d, "has_explanation": ex} for w, d, ex in hits[:MAX_CANDIDATES]]
    if len(hits) > 1:
        return Classified(MATCH_MANUAL_MULTIPLE, cands, len(hits), _fp([(w, str(d), ex, _texts_hash(snap, w)) for w, d, ex in hits]))
    if len(hits) == 1:
        dialect = hits[0][1]
        if dialect == TARGETS[tribe]["dictionary_dialect"]:
            cls = MATCH_SAME_DIALECT
        elif dialect in (None, ""):
            cls = MATCH_UNKNOWN_DIALECT
        else:
            cls = MATCH_CROSS_DIALECT
        return Classified(cls, cands, 1, _fp([(w, str(d), ex, _texts_hash(snap, w)) for w, d, ex in hits]),
                          sense_agreement(zh, (snap.explanations or {}).get(hits[0][0], ())))
    near = snap.near.get(loose_key(f), [])
    if near:
        ordered = sorted(near, key=lambda x: (str(x[0]), x[1], str(x[2])))
        return Classified(
            MATCH_NEAR_FORM,
            [{"word_id": w, "dialect": d, "has_explanation": False, "name": n, "near": True} for w, n, d in ordered[:MAX_CANDIDATES]],
            len(near),
            _fp([(w, n, str(d)) for w, n, d in ordered]),
        )
    return Classified(MATCH_NEW, [], 0, _fp([]))


def _texts_hash(snap: DictionarySnapshot, word_id: str) -> str:
    texts = sorted((snap.explanations or {}).get(word_id, ()))
    return hashlib.sha256("\x1f".join(texts).encode("utf-8")).hexdigest()


def _fp(items) -> str:
    return hashlib.sha256(json.dumps(sorted(items), ensure_ascii=False).encode("utf-8")).hexdigest()


def decision_basis(*, form: str, zh: str, note: str, raw_cell: str, match_class: str, candidate_count: int, fingerprint: str,
                   sense_check: str = "") -> str:
    """人工決定的依據雜湊：詞形、詞表中文／備註／原格、比對分類、【完整】候選指紋任一改變就會不同。
    全部用已存進對照表的欄位計算，所以決定當下與之後重跑算出的值可以直接比較。"""
    payload = {"form": nfc(form), "zh": zh, "note": note, "raw": raw_cell, "class": match_class,
               "count": candidate_count, "fingerprint": fingerprint, "sense": sense_check}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def check_lengths(slug_label: str, entry: ParsedEntry, forms: list[str], source_label: str = "") -> None:
    """PostgreSQL 的 varchar 超長會讓整批失敗；先在計畫階段給出可讀的錯誤。"""
    def limit(model, name):
        return model._meta.get_field(name).max_length

    for name, value in (("entry_code", entry.code), ("level", entry.level), ("category", entry.category),
                        ("zh", entry.zh), ("raw_cell", entry.raw), ("note", entry.note)):
        if len(value) > limit(WordlistEntry, name):
            raise WordlistError(f"{slug_label} {entry.code} 的 {name} 超過上限 {limit(WordlistEntry, name)}")
    if len(source_label) > limit(WordlistEntry, "source_label"):
        raise WordlistError(f"{slug_label} 的詞表版本字樣超過上限 {limit(WordlistEntry, 'source_label')}")
    for f in forms:
        if len(f) > limit(WordlistForm, "form"):
            raise WordlistError(f"{slug_label} {entry.code} 的詞形超過上限")
