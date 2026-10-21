"""AI 助手的辭典工具（路線圖 #16）：讓模型回答族語詞彙前先查辭典，回答以查到的內容為準。

工具只有兩個，且都固定在「這次對話選的族語」上，模型不能指定其他族語：
  search_words(keywords)  以族語詞查辭典，回傳收錄的詞條（含 word_id 與中文解釋）
  get_word(word_id)       以 word_id 取得完整解釋與例句

切詞與正規化在這裡處理，不交給模型：去掉前後標點、大小寫變體、辭典裡詞尾多一個空白的詞。
這個模組只負責工具定義、輸入驗證與結果整理；資料庫查詢由 DictionaryLookup 完成，
測試時整個換成假的實作。
"""
import logging
import re
import unicodedata

logger = logging.getLogger(__name__)

MAX_KEYWORDS = 10
MAX_ENTRIES_PER_KEYWORD = 3
MAX_EXAMPLES = 3
_MAX_KEYWORD_LEN = 60
_MAX_TEXT_LEN = 200

# 模型看到的工具。tribe 由伺服器固定，不開放給模型填；strict 讓輸入必定符合 schema。
# 陣列長度（最多 10 個）strict 模式不支援寫在 schema 裡，由 clean_keywords 在伺服器端限制。
TOOLS = [
    {
        "name": "search_words",
        "description": (
            "以族語詞查詢辭典，回傳辭典收錄的詞條（word_id、詞、中文解釋）。"
            "一次最多查 10 個詞；沒有收錄的詞會標示 found=false。只能用族語詞查，不能用中文查。"
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"keywords": {"type": "array", "items": {"type": "string"}}},
            "required": ["keywords"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_word",
        "description": "以 search_words 回傳的 word_id 取得該詞條的完整解釋與例句。",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"word_id": {"type": "string"}},
            "required": ["word_id"],
            "additionalProperties": False,
        },
    },
]


class ToolInputError(ValueError):
    """模型給的工具參數不合法；訊息會原樣回給模型（is_error），所以只寫規則，不含輸入原值。"""


def _strip_edge_punctuation(token: str) -> str:
    """去掉頭尾的標點與符號（含全形），保留詞中間的字元。
    族語拼音系統裡有些符號（例如喉塞音的 ' ）可能出現在詞尾，所以這只是「額外的候選」，
    查詢時原樣的詞也會一併查。"""
    start, end = 0, len(token)
    while start < end and unicodedata.category(token[start])[0] in "PSZC":
        start += 1
    while end > start and unicodedata.category(token[end - 1])[0] in "PSZC":
        end -= 1
    return token[start:end]


def clean_keywords(raw) -> list:
    """驗證並整理 search_words 的 keywords：必須是字串陣列；去空白、去重、最多 MAX_KEYWORDS 個。"""
    if not isinstance(raw, list) or not raw:
        raise ToolInputError("keywords 必須是至少一個字串的陣列")
    seen, result = set(), []
    for item in raw:
        if not isinstance(item, str):
            raise ToolInputError("keywords 裡的每一項都必須是字串")
        word = " ".join(item.split())[:_MAX_KEYWORD_LEN]
        if word and word not in seen:
            seen.add(word)
            result.append(word)
    if not result:
        raise ToolInputError("keywords 不能全是空白")
    return result[:MAX_KEYWORDS]


def candidate_forms(keyword: str) -> list:
    """一個查詢詞要試哪些寫法：原樣、去頭尾標點、小寫，以及辭典裡常見的「詞尾多一個空白」版本。"""
    base = [keyword]
    stripped = _strip_edge_punctuation(keyword)
    if stripped and stripped != keyword:
        base.append(stripped)
    forms = []
    for form in base:
        for variant in (form, form.casefold()):
            for candidate in (variant, variant + " "):
                if candidate not in forms:
                    forms.append(candidate)
    return forms


def _clip(text, limit=_MAX_TEXT_LEN) -> str:
    return " ".join(str(text or "").split())[:limit]


class DictionaryLookup:
    """工具背後的資料存取。子類別（或測試用的假物件）實作這兩個方法即可。"""

    def search(self, forms: list) -> list:
        """forms：同一個查詢詞的各種寫法。回傳 [{word_id, name, explanations: [中文解釋...], has_audio}]。"""
        raise NotImplementedError

    def names(self, forms: list) -> set:
        """forms 之中，辭典真的有收錄的詞形（只要詞形，不載入解釋與音檔）。回覆後的族語詞驗證用（validators.py）。
        預設用 search 湊合，正式環境的實作改成一次輕量查詢。"""
        return {entry["name"] for entry in self.search(forms)}

    def get(self, word_id: str):
        """回傳 {word_id, name, explanations: [{chinese, part_of_speech, examples: [{original, chinese}]}]}，
        找不到（或不屬於這次的族語）回傳 None。"""
        raise NotImplementedError


def run_tool(lookup: DictionaryLookup, name: str, tool_input) -> dict:
    """執行一次工具呼叫，回傳可以 JSON 序列化的結果。參數不合法丟 ToolInputError。"""
    if not isinstance(tool_input, dict):
        raise ToolInputError("工具輸入必須是物件")

    if name == "search_words":
        keywords = clean_keywords(tool_input.get("keywords"))
        results = []
        for kw in keywords:
            # 每個詞各查一次：合併成一次 IN 查詢再全域截斷，會讓某個詞的大量同名詞條擠掉其他詞的結果
            matches = lookup.search(candidate_forms(kw))
            seen_ids, unique = set(), []
            for entry in matches:
                if entry["word_id"] not in seen_ids:
                    seen_ids.add(entry["word_id"])
                    unique.append(entry)
            results.append({
                "keyword": kw,
                "found": bool(unique),
                "entries": [
                    {
                        "word_id": e["word_id"],
                        "word": _clip(e["name"], _MAX_KEYWORD_LEN),
                        "chinese": _clip("；".join(x for x in e["explanations"][:2] if x)) or "（辭典沒有中文解釋）",
                        "has_audio": bool(e.get("has_audio")),
                    }
                    for e in unique[:MAX_ENTRIES_PER_KEYWORD]
                ],
            })
        return {"results": results}

    if name == "get_word":
        word_id = tool_input.get("word_id")
        if not isinstance(word_id, str) or not word_id.strip() or len(word_id) > 80:
            raise ToolInputError("word_id 必須是 search_words 回傳的字串")
        word = lookup.get(word_id.strip())
        if word is None:
            return {"found": False}
        return {
            "found": True,
            "word_id": word["word_id"],
            "word": _clip(word["name"], _MAX_KEYWORD_LEN),
            "explanations": [
                {
                    "chinese": _clip(exp.get("chinese")),
                    "part_of_speech": [_clip(p, 40) for p in exp.get("part_of_speech", [])][:4],
                    "examples": [
                        {"original": _clip(ex.get("original")), "chinese": _clip(ex.get("chinese"))}
                        for ex in exp.get("examples", [])[:MAX_EXAMPLES]
                    ],
                }
                for exp in word["explanations"][:4]
            ],
        }

    raise ToolInputError(f"沒有這個工具：{_clip(name, 40)}")


def _first_file_id(audio_items) -> str:
    return str((audio_items[0].get("fileId") if audio_items else "") or "")


class SqlDictionaryLookup(DictionaryLookup):
    """正式環境的實作：用既有的辭典資料庫（SQLAlchemy）。每次呼叫自己開關連線。"""

    def __init__(self, tribe_id: str):
        self.tribe_id = tribe_id

    def search(self, forms):
        from dictionary_db.connect import SessionLocal
        from dictionary_db.model import Word
        from dictionary_db.word_data import load_audio_items_for_words, load_explanation_items_for_words

        db = SessionLocal()
        try:
            words = (
                db.query(Word)
                .filter(Word.name.in_(forms), Word.tribe_id == self.tribe_id)
                .order_by(Word.id)
                .limit(MAX_ENTRIES_PER_KEYWORD * 4)
                .all()
            )
            ids = [w.id for w in words]
            explanations = load_explanation_items_for_words(db, word_ids=ids) if ids else {}
            audio = load_audio_items_for_words(db, word_ids=ids) if ids else {}
            return [
                {
                    "word_id": str(w.id),
                    "name": w.name,
                    "explanations": [e.get("chineseExplanation") or "" for e in explanations.get(w.id, [])],
                    "has_audio": bool(audio.get(w.id)),
                    # 只給詞條卡片用（entries.py），不會進工具結果；run_tool 只挑特定欄位給模型
                    "audio_file_id": _first_file_id(audio.get(w.id)),
                }
                for w in words
            ]
        finally:
            db.close()

    def names(self, forms):
        from dictionary_db.connect import SessionLocal
        from dictionary_db.model import Word

        db = SessionLocal()
        try:
            rows = db.query(Word.name).filter(Word.name.in_(forms), Word.tribe_id == self.tribe_id).distinct().all()
            return {row[0] for row in rows}
        finally:
            db.close()

    def get(self, word_id):
        from dictionary_db.connect import SessionLocal
        from dictionary_db.model import Word
        from dictionary_db.word_data import load_audio_items_for_words, load_explanation_items_for_words

        db = SessionLocal()
        try:
            word = db.query(Word).filter(Word.id == word_id, Word.tribe_id == self.tribe_id).first()
            if word is None:
                return None
            items = load_explanation_items_for_words(db, word_ids=[word.id]).get(word.id, [])
            audio = load_audio_items_for_words(db, word_ids=[word.id]).get(word.id)
            return {
                "word_id": str(word.id),
                "name": word.name,
                "audio_file_id": _first_file_id(audio),
                "explanations": [
                    {
                        "chinese": item.get("chineseExplanation") or "",
                        "part_of_speech": item.get("partOfSpeech") or [],
                        "examples": [
                            {"original": s.get("originalSentence"), "chinese": s.get("chineseSentence")}
                            for s in item.get("sentenceItems") or []
                        ],
                    }
                    for item in items
                ],
            }
        finally:
            db.close()
