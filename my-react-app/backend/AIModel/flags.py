"""功能旗標的批次讀取。

AI 助手一個請求常要看好幾個旗標（總開關、題目講解、圖片、回饋…），各自 filter(key=...).first()
就是每個旗標一次資料庫往返。需要同時看多個旗標的地方，用 load_flags() 一次取回（一句 key__in 查詢），
再把結果傳給各個 *_enabled(flags)；不傳的話各函式照舊自己查，行為不變。

旗標表有 30 秒的短快取（adminapi/flag_cache.py）：後台切換旗標與預算超標自動關閉都會立刻清除快取，
最壞情況（沒有共用 cache 的多 worker 環境）其他 worker 最多 30 秒後生效。
"""
from __future__ import annotations

from typing import Iterable, Mapping


def load_flags(keys: Iterable[str]) -> dict[str, bool]:
    """回傳 {key: enabled}；資料庫裡沒有該列的 key 不會出現在結果中（呼叫端自己決定缺少時算開或關）。"""
    from adminapi import flag_cache

    table = flag_cache.all_flags()
    return {key: table[key] for key in dict.fromkeys(keys) if key in table}


def enabled_fail_closed(key: str, flags: Mapping[str, bool] | None = None) -> bool:
    """預設關閉、查不到也視為關閉。flags 有給就直接用，沒給就查一次資料庫。"""
    if flags is None:
        flags = load_flags([key])
    return bool(flags.get(key, False))
