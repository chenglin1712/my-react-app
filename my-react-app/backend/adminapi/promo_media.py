"""首頁宣傳影片媒體檔的公開網址與存在檢查。

資料庫只存相對路徑（見 validators.py 的固定格式）；公開網址由這裡以 settings.MEDIA_URL 組出，
不是使用者輸入的字串，所以不可能是外部網址（HOMEPAGE_CONTRACT.md 第 7 節）。
"""
import os

from django.conf import settings


def _resolve(path):
    """回傳檔案的絕對路徑；路徑為空、跑出媒體根目錄、是符號連結，或不是一般檔案時回傳 None。"""
    if not path:
        return None
    root = os.path.realpath(str(settings.MEDIA_ROOT))
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return None
    # 不跟隨符號連結：根目錄底下「每一層」（含父目錄）只要是符號連結就視為不存在，
    # 不只檢查最後一段。
    current = root
    for part in parts:
        current = os.path.join(current, part)
        if os.path.islink(current):
            return None
    # fail closed：Windows 跨磁碟機等情況 commonpath 會丟 ValueError，一律當作不存在，
    # 不能讓公開端點因此 500。
    try:
        real = os.path.realpath(current)
        if os.path.commonpath([root, real]) != root:
            return None
    except (ValueError, OSError):
        return None
    return real if os.path.isfile(real) else None


def media_file_exists(path):
    return _resolve(path) is not None


def public_media_url(path):
    """相對路徑對應的公開網址；檔案不存在回傳 None（前台據此進入「影片無法播放」狀態）。"""
    if not media_file_exists(path):
        return None
    return settings.MEDIA_URL.rstrip("/") + "/" + path
