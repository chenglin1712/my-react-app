"""詞綴類型白名單單一資料來源。

原本只有 fastAPI/routes/dictionary/grammar.py 的 _VALID_AFFIX_TYPES 這一份
清單。P4.2 後台的詞綴主檔 CRUD（backend/adminapi/dictionary_taxonomy_views.py）
也需要驗證同一組值——後台建出來的詞綴，如果 affix_type 不在這份白名單內，
公開 API（grammar.py 的 get_grammar_affixes）會直接 400 拒絕，兩邊各自寫一份
容易漏改而對不上，比照 config/tribes.py／config/roles.py 同一種集中做法。
"""

VALID_AFFIX_TYPES = frozenset({
    "prefix", "suffix", "infix", "circumfix", "reduplication", "auxiliary",
})
