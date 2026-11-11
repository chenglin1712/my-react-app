"""功能旗標表的短快取（30 秒）。

旗標表很小（幾十列），AI 助手一個請求要看好幾個旗標，各自查資料庫是往返次數跟請求數成正比。
這裡把整張表當一個字典存進 Django 的 cache（有設定 REDIS_URL 時是各 worker 共用的 Redis，沒有就是各 worker 自己的記憶體），
30 秒內重複讀取不再碰資料庫。

一鍵關閉費用出口的延遲上限：
- 管理者在後台切換旗標（Model.save）與預算超標自動關閉（呼叫 invalidate）都會換新版本代號，
  同一個 cache 後端（Redis）下所有 worker 立即生效；
- 沒有共用 cache 的環境（各 worker 自己的記憶體），其他 worker 最多 30 秒後生效。
cache 後端故障時直接退回查資料庫，不擋請求。
"""
from __future__ import annotations

import logging
import uuid

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models.signals import post_delete, post_save

from .models import FeatureFlag

logger = logging.getLogger(__name__)

CACHE_KEY = "feature_flags:v1"        # 實際存資料的 key 會再加上目前的版本代號
VERSION_KEY = "feature_flags:version"


def _seconds() -> int:
    return getattr(settings, "FEATURE_FLAG_CACHE_SECONDS", 30)


def _data_key() -> str:
    version = cache.get(VERSION_KEY)
    return f"{CACHE_KEY}:{version or '0'}"


def invalidate() -> None:
    """換一個新的版本代號，舊版本的資料自然作廢。
    不用「刪除資料 key」是為了擋競態：某個請求在變更提交前讀到舊值、變更後才把舊值寫回快取——
    它寫回的是舊版本代號的 key，沒有人會再讀到。"""
    try:
        cache.set(VERSION_KEY, uuid.uuid4().hex, None)
    except Exception:
        logger.warning("[FlagCache] 清除快取失敗，最多 %s 秒後自動過期", _seconds(), exc_info=True)


def all_flags() -> dict[str, bool]:
    """{key: enabled}（整張表）。呼叫端只能讀、不能改回傳的 dict。"""
    seconds = _seconds()
    if seconds <= 0:
        return dict(FeatureFlag.objects.values_list("key", "enabled"))
    try:
        key = _data_key()          # 先取版本代號，再查資料庫；寫回時用同一個 key
        cached = cache.get(key)
    except Exception:
        logger.warning("[FlagCache] 讀取快取失敗，改查資料庫", exc_info=True)
        key = None
        cached = None
    if cached is not None:
        return cached
    flags = dict(FeatureFlag.objects.values_list("key", "enabled"))
    if key is None:
        return flags
    try:
        cache.set(key, flags, seconds)
    except Exception:
        logger.warning("[FlagCache] 寫入快取失敗", exc_info=True)
    return flags


def _on_change(sender, **kwargs):
    invalidate()
    # 交易提交前若有人讀到舊值並寫回快取，提交後再清一次
    transaction.on_commit(invalidate)


post_save.connect(_on_change, sender=FeatureFlag, dispatch_uid="flag_cache_save")
post_delete.connect(_on_change, sender=FeatureFlag, dispatch_uid="flag_cache_delete")
