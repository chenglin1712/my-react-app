"""從辭典資料庫抽樣產生詞彙題（路線圖 #29）。

標準答案（中文釋義）直接取自辭典；題目是「這個詞是什麼意思」，判分看助手有沒有查辭典、
有沒有說出辭典的釋義、回覆裡的族語詞是否都在辭典裡。抽樣用固定的 seed，同一個 seed 在辭典沒變時
抽到同樣的詞，前後比較才公平；辭典有大幅更新時分數會跟著變，報告會記下這次抽到的詞條編號。
"""
import random
import re

_MAX_GLOSS_CHARS = 10
_MIN_GLOSS_CHARS = 2
_SPLIT = re.compile(r"[；;，,、/]")
_PARENS = re.compile(r"[（(][^）)]*[）)]")
_CJK = re.compile(r"[一-鿿]")


def short_gloss(chinese: str) -> str:
    """辭典的中文釋義常是一長串；取第一段、去掉括號註記，太長或不是中文的就放棄（回傳空字串）。"""
    first = _SPLIT.split(_PARENS.sub("", chinese or ""))[0].strip()
    if not (_MIN_GLOSS_CHARS <= len(first) <= _MAX_GLOSS_CHARS) or not _CJK.search(first):
        return ""
    return first


def build_case(word_id: str, name: str, gloss: str) -> dict:
    return {
        "id": f"dict-{word_id}"[:64],
        "category": "grounding",
        "message": f"請問「{name}」是什麼意思？",
        "checks": [
            {"type": "used_tool"}, {"type": "no_unverified"}, {"type": "mentions_gloss"}, {"type": "not_refused"},
        ],
        "judge": "回答與辭典的釋義一致，沒有加入辭典沒有的詞義、例句或用法。",
        "gold": {"word_id": str(word_id), "word": name, "gloss": gloss},
    }


def sample_dictionary_cases(tribe_id: str, count: int, seed: int = 1) -> list[dict]:
    """抽 count 題。辭典連不上或可用的詞不夠時，回傳能抽到的部分（呼叫端把數量寫進報告）。"""
    from dictionary_db.connect import SessionLocal
    from dictionary_db.model import Word
    from dictionary_db.word_data import load_explanation_items_for_words

    db = SessionLocal()
    try:
        rows = db.query(Word.id, Word.name).filter(Word.tribe_id == tribe_id).order_by(Word.id).all()
        usable = [(r[0], " ".join(str(r[1]).split())) for r in rows if len(" ".join(str(r[1]).split())) >= 3]
        random.Random(seed).shuffle(usable)
        cases = []
        # 一次多取一些，因為有些詞沒有可用的短釋義
        for start in range(0, len(usable), max(count * 3, 30)):
            batch = usable[start:start + max(count * 3, 30)]
            explanations = load_explanation_items_for_words(db, word_ids=[w[0] for w in batch])
            for word_id, name in batch:
                items = explanations.get(word_id) or []
                gloss = short_gloss(items[0].get("chineseExplanation", "")) if items else ""
                if gloss:
                    cases.append(build_case(word_id, name, gloss))
                if len(cases) == count:
                    return cases
        return cases
    finally:
        db.close()
