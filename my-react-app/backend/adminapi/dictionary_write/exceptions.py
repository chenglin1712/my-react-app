"""dictionary_write 各子模組共用的例外型別。這些是呼叫端（views.py）可以
攔截、跟業務邏輯有關的錯誤（word 不存在、跨族語參照等），區別於未預期的
例外——views.py 攔截這個型別轉成 400/404/409，其餘例外讓
dictionary_write_session() 的 rollback 接手、往外拋成 500。"""


class DictionaryWriteError(Exception):
    pass


class WordNotFoundError(DictionaryWriteError):
    pass


class CrossTribeReferenceError(DictionaryWriteError):
    def __init__(self, message, invalid_ids):
        super().__init__(message)
        self.invalid_ids = invalid_ids


class ReferencedError(DictionaryWriteError):
    """刪除操作被引用計數擋下——呼叫端轉成 409 附上引用數與樣本。"""

    def __init__(self, message, counts):
        super().__init__(message)
        self.counts = counts


class TaxonomyNotFoundError(DictionaryWriteError):
    pass


class GrammarSectionNotFoundError(DictionaryWriteError):
    pass


class ConcurrentModificationError(DictionaryWriteError):
    """expected_hash 在拿到列鎖之後重新比對仍然不一致——呼叫端（核准流程）
    轉成 409，見 apply_word_tree()/apply_grammar_section() 的說明。"""
