"""系統維運「快取管理」頁面用的清除函式——跟 dictionary_cache.py 是同一種
「Django 呼叫 FastAPI 內部端點」模式，但刻意不共用那支函式：
dictionary_cache.py 的 invalidate_dictionary_cache() 是寫入觸發、
fire-and-forget（吞例外、不回傳結果，因為呼叫端是辭典寫入流程，快取通知
失敗不該讓使用者的寫入操作看起來失敗）；這裡是管理者主動點擊「清除」
按鈕，失敗與否正是這個操作唯一要回報的結果，不能吞掉。
"""
import logging
import os

import requests
from django.core.cache import cache

logger = logging.getLogger(__name__)

_DEFAULT_FASTAPI_BASE_URL = "http://127.0.0.1:8001"
# 5 秒一開始看似夠用（單純的 dict pop 操作），但實測發現會跟背景重新
# 預熱執行緒（見 fastAPI/routes/internal.py 的 _rewarm，五個族語 x 四種
# 快取依序重新查詢，全部跑完可能要一兩分鐘）搶同一把 KeyedCache 鎖——
# invalidate() 為了不破壞雙重檢查鎖定，會跟正在進行中的 compute() 用
# 同一把鎖（見 keyed_cache.py 的說明），若剛好撞上另一個還在跑的重新
# 預熱，這次呼叫會被卡住直到那個 key 的計算跑完，而不是瞬間回應。放寬
# 到 60 秒是為了涵蓋這種「不巧撞上前一次重新預熱」的真實情況——操作本身
# 沒有卡死，只是變慢，60 秒內幾乎必定會完成。
_TIMEOUT_SECONDS = 60

# crawler/views.py 裡目前實際存在的具名快取（見該檔案 EXAM_SITE_HTML_CACHE_KEY／
# NEWS_CACHE_KEY／EXAM_SCHEDULE_CACHE_KEY），寫死清單而非動態列舉——本機/單機
# 部署是 LocMemCache，沒有辦法列舉全部 key；正式環境若設定 REDIS_URL 才會是
# 可列舉的 RedisCache，這裡不假設一定是哪一種 backend，只針對這幾個已知 key
# 逐一清除。
DJANGO_NAMED_CACHE_KEYS = {
    "crawler_exam_site_html": "考試時程原始 HTML（15 分鐘）",
    "crawler_news_data": "首頁消息（15 分鐘）",
    "crawler_exam_schedule_data": "考試時程解析結果（15 分鐘）",
}


def clear_django_caches():
    """逐一清除已知具名 Django 快取，回傳實際清除的 key 清單。"""
    cleared = []
    for key in DJANGO_NAMED_CACHE_KEYS:
        cache.delete(key)
        cleared.append(key)
    return cleared


def clear_fastapi_caches():
    """呼叫 FastAPI 既有的 /internal/cache/invalidate（scopes=["all"]），
    這支端點早就會連帶清除 listening/sentence/quiz 三個遊戲的詞彙快取
    （不只是辭典搜尋快取，見 fastAPI/routes/internal.py），直接沿用即可，
    不需要新增或擴大它的 scope。回傳 (成功與否, 訊息或 FastAPI 回應內容)。"""
    secret = os.getenv("INTERNAL_API_SECRET")
    if not secret:
        return False, "INTERNAL_API_SECRET 未設定，無法通知 FastAPI 清除快取"

    base_url = os.getenv("FASTAPI_INTERNAL_BASE_URL", _DEFAULT_FASTAPI_BASE_URL)
    try:
        resp = requests.post(
            f"{base_url}/internal/cache/invalidate",
            json={"scopes": ["all"], "tribes": None},
            headers={"X-Internal-Secret": secret},
            timeout=_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        return True, resp.json()
    except Exception as exc:
        logger.exception("清除 FastAPI 快取失敗")
        return False, f"呼叫 FastAPI 失敗：{exc}"
