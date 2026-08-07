"""辭典媒體（音檔／圖片）來源模式單一資料來源。

P5 辭典媒體自主化：把 ILRDF 音檔／圖片搬到自己的 Firebase Storage 之後，
audio_proxy.py／search.py 這些讀取路徑需要知道現在該不該還信任 ILRDF 當
fallback。用一個環境變數集中控制，而不是散在各檔案各自判斷，換模式時只
需要改一個地方。

hybrid（遷移期，預設值）：media_asset 有 verified 紀錄就用自己的 Storage，
    沒有就照舊回退 ILRDF——遷移還沒跑到的詞條不會壞掉。
storage_only（遷移驗證完成、正式切換後）：media_asset 沒有 verified 紀錄
    直接回明確錯誤，不再嘗試連線 ILRDF。這是「不再依賴外部 API 存活」這個
    目標唯一算數的狀態——只要還留在 hybrid，本質上就還沒有真正做到。
"""
import os

_VALID_MODES = frozenset({"hybrid", "storage_only"})
_DEFAULT_MODE = "hybrid"


def get_media_source_mode() -> str:
    mode = os.getenv("MEDIA_SOURCE_MODE", _DEFAULT_MODE).strip().lower()
    return mode if mode in _VALID_MODES else _DEFAULT_MODE
