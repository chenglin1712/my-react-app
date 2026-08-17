"""P4 辭典管理：對 dictionary_db（SQLAlchemy 直連）的實際讀寫邏輯，依職責
拆成子模組（P4 review BE-13，原本 1039 行全部塞在單一 dictionary_write.py
裡）。跟 Announcement／題庫類內容完全不同的地方：辭典資料不是 Django ORM
model，沒有 transaction.atomic()／select_for_update()／full_clean() 可用。
這裡的函式全部吃一個已經在 dictionary_write_session()（見
dictionary_db/connect.py）context 裡的 SQLAlchemy Session，呼叫端負責
交易邊界。

依風險由低到高拆分、逐步驗證（見各檔案開頭說明）：
    exceptions.py       共用例外型別（無依賴）
    content_hash.py      詞條／文法章節樹的內容雜湊（純函式，無依賴）
    tree_reconcile.py    聚合寫入共用的對帳工具＋跨族語連結驗證
    tree_reader.py        詞條／文法章節的聚合唯讀組裝
    taxonomy_service.py  主檔管理（source/category/part_of_speech/focus/
                          grammar_affix）CRUD＋合併
    grammar_service.py   文法章節聚合讀寫
    word_service.py      詞條聚合讀寫（風險最集中，最後才拆）

核心設計是「整個詞條當一個聚合單位讀寫」（見規劃文件 P4 §2）：一次 GET
回傳整棵樹（詞條→解釋→例句→音檔/圖片/標註），一次寫入用「對帳」而非
「先刪全部再整個重建」的方式套用整棵樹——對帳保留沒變動的子節點的
資料庫 id，讓 AuditLog 的 before/after diff 有意義，也讓前端存檔後不需要
整個重新拉一次才能繼續編輯。

`sort_order` 永遠不接受前端送來的值——一律用陣列位置覆寫。這是刻意的
設計（呼應 QuizBank.jsx `blanks` 物件用字串 key 兼職順序/身分/內容標記
三種角色、刪除中間項會產生 key 衝突的已知脆弱點）：把「順序」跟「身分」
兩件事徹底分開，順序永遠是陣列位置的單一事實來源。

這個 __init__.py 把全部子模組的 public 名稱重新匯出，讓既有呼叫點
`from . import dictionary_write as dw` / `from adminapi import
dictionary_write as dw` 完全維持原樣（呼叫端一律用 `dw.X` 屬性存取，
不是 `from .dictionary_write import X`，見稽核當下的呼叫點清查）。
"""
from .content_hash import grammar_section_content_hash, word_content_hash
from .exceptions import (
    ConcurrentModificationError,
    CrossTribeReferenceError,
    DictionaryWriteError,
    GrammarSectionNotFoundError,
    ReferencedError,
    TaxonomyNotFoundError,
    WordNotFoundError,
)
from .grammar_service import apply_grammar_section, delete_grammar_section, reorder_grammar_sections
from .taxonomy_service import (
    count_taxonomy_references,
    create_taxonomy_term,
    delete_taxonomy_term,
    merge_taxonomy_terms,
    taxonomy_reference_spec,
    update_taxonomy_term,
)
from .tree_reader import get_grammar_section_tree, get_word_tree, get_word_trees_for_tribe
from .word_service import apply_word_tree, count_word_references, delete_word_tree, sample_word_references

__all__ = [
    "ConcurrentModificationError",
    "CrossTribeReferenceError",
    "DictionaryWriteError",
    "GrammarSectionNotFoundError",
    "ReferencedError",
    "TaxonomyNotFoundError",
    "WordNotFoundError",
    "apply_grammar_section",
    "apply_word_tree",
    "count_taxonomy_references",
    "count_word_references",
    "create_taxonomy_term",
    "delete_grammar_section",
    "delete_taxonomy_term",
    "delete_word_tree",
    "get_grammar_section_tree",
    "get_word_tree",
    "get_word_trees_for_tribe",
    "grammar_section_content_hash",
    "merge_taxonomy_terms",
    "reorder_grammar_sections",
    "sample_word_references",
    "taxonomy_reference_spec",
    "update_taxonomy_term",
    "word_content_hash",
]
