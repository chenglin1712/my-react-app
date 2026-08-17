"""詞條樹／文法章節樹的內容雜湊——純函式，不做任何 I/O。"""
import hashlib
import json


def _tree_content_hash(tree: dict) -> str:
    """整棵樹的內容雜湊，忽略 content_hash／meta 這兩個「衍生欄位」本身，
    避免雜湊值影響雜湊值。用 sha256 而非 Python 內建 hash()——後者每次
    process 重啟 seed 都不同，不能拿來跨請求比對。詞條樹跟文法章節樹共用
    同一支雜湊函式，形狀（dict 去掉衍生欄位後序列化）完全一樣。"""
    payload = {k: v for k, v in tree.items() if k not in ("content_hash", "meta")}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def word_content_hash(tree: dict) -> str:
    return _tree_content_hash(tree)


def grammar_section_content_hash(tree: dict) -> str:
    return _tree_content_hash(tree)
