"""詞素學習研究事件（quiz_rule_event_logging）共用的純函式：假名化、時間粗化、同意版本。

注意這是【假名化】，不是匿名化：持有鹽、知道 uid 的服務可以重新算出同一個假名——系統也正是靠這點，才能在使用者
撤回或刪除帳號時找到並刪除他的事件。對使用者的說明（前端 ResearchConsentCard）必須如實這樣寫。

FastAPI（寫入、同意端點）與 Django（清除、評估指令）共用這份，確保兩邊算出同一個假名。

隱私設計（事件表只存「做研究需要的最少資料」）：
- 不存 uid、email、姓名；只存 HMAC-SHA256(鹽, uid) 的前 32 個十六進位字元（假名）。鹽放在環境變數
  QUIZ_RESEARCH_SALT，沒設定（或太短）就完全不記錄事件。鹽換掉或遺失之後，舊事件無法再對應到人，
  也就無法依使用者撤回或刪除帳號而刪除，所以鹽是需要備份、不可隨意輪替的資料治理密鑰（見 README）；
- 不存題目的詞形與整句，只存規則 ID、診斷類別與模型的預測值；
- 時間只存到整點，作答秒數只存分級。
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime

SALT_ENV = "QUIZ_RESEARCH_SALT"
MIN_SALT_LEN = 32
MIN_SALT_DISTINCT_CHARS = 10          # 不能只是少數字元的重複（'a' * 40 之類）
CONSENT_VERSION = "2026-10-v2"       # 同意說明文字（前端 ResearchConsentCard）改動時一起升版；舊版的同意會失效，需要重新同意

# 作答秒數分級的上界（秒）；超過最後一個上界是最後一級
_SECONDS_BUCKETS = (3, 6, 10, 20, 40)


def _usable(value: str | None) -> bool:
    return bool(value) and len(value) >= MIN_SALT_LEN and len(set(value)) >= MIN_SALT_DISTINCT_CHARS


def salt() -> str | None:
    value = os.getenv(SALT_ENV, "")
    return value if _usable(value) else None


def pseudonym(uid: str, salt_value: str | None = None) -> str | None:
    """uid 的假名；沒有 uid 或沒有可用的鹽就回傳 None（呼叫端據此不記錄）。"""
    salt_value = salt() if salt_value is None else salt_value
    if not uid or not _usable(salt_value):
        return None
    return hmac.new(salt_value.encode("utf-8"), uid.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def seconds_bucket(seconds: float) -> int:
    """作答秒數的分級：0（<3）… 5（>=40）。負數、非數字、NaN 當成最快的一級。"""
    try:
        value = float(seconds)
    except (TypeError, ValueError):
        return 0
    if value != value or value < 0:
        return 0
    for index, upper in enumerate(_SECONDS_BUCKETS):
        if value < upper:
            return index
    return len(_SECONDS_BUCKETS)


def hour_bucket(moment: datetime) -> datetime:
    """時間只存到整點。"""
    return moment.replace(minute=0, second=0, microsecond=0)
