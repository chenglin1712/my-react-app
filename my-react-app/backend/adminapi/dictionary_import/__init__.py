"""P4.4 批次匯入／匯出精靈的核心邏輯，依職責拆成子模組（P4 review BE-17，
原本連同 dictionary_import_views.py 的套用迴圈全部塞在單一 405 行的
dictionary_import.py 裡）：

- bundle_schema.py    匯入／匯出共用的分類主檔對照
- import_resolver.py  把 bundle 解析成 apply_word_tree() 認得的 payload
- import_apply.py     核准套用時逐列真正寫入 dictionary_db（從
                       dictionary_import_views.import_job_approve() 抽出）
- exporter.py         把詞條樹轉回匯入 bundle 格式

這個 __init__.py 重新匯出既有呼叫點會用到的名稱，讓
`from .dictionary_import import X`／
`from adminapi.dictionary_import import X` 全部維持原樣。
"""
from .exporter import export_tribe_bundle
from .import_apply import _deterministic_import_row_id, apply_import_job_rows
from .import_resolver import create_missing_taxonomies, import_report_hash, resolve_import_bundle

__all__ = [
    "apply_import_job_rows",
    "create_missing_taxonomies",
    "export_tribe_bundle",
    "import_report_hash",
    "resolve_import_bundle",
]
