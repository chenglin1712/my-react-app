from fastapi import APIRouter

from ... import feature_flags

router = APIRouter()

NOTES_CLOUD_SYNC_FLAG = "notes_cloud_sync"


@router.get("")
def get_features():
    """回傳登入使用者可見的功能開關。用 fail-closed：旗標表讀不到或太久沒更新，視為關閉，
    因為「開啟」代表前端會開始往雲端寫資料，資料庫異常時不該放行。"""
    return {"notesCloudSync": feature_flags.is_enabled_fail_closed(NOTES_CLOUD_SYNC_FLAG)}
