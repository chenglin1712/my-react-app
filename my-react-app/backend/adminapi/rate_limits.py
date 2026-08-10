"""與任何特定內容型別無關的限流設定查表工具，供 adminapi/_shared.py 及
AIModel／CrosswordPuzzle／crawler 三個 app 各自的本地限流工具共用（那三個
app 各自都有一份跟 adminapi/_shared.py 邏輯相同的 _rate_limited_response，
是這次要動態化的既有重複實作，不是新增）。

獨立成這個小檔案而不是放進 _shared.py：_shared.py 還 import 了 AuditLog、
django_ratelimit 的 is_ratelimited 呼叫邏輯本身，這裡只需要「給一個 key
查目前生效的 rate 字串」這一件事，讓外部 app 不用連帶引入不相關的依賴，
也避免 AIModel／CrosswordPuzzle 這兩個原本完全沒 import 過 adminapi 任何
東西的 app，一次多背上一堆不相關的 import。
"""
from django.core.cache import cache

# 限流檢查發生在每一次請求，不能每次都查一次資料庫；短 TTL 記憶化讓後台
# 改動的限流值最慢在這個秒數內生效——跟 FastAPI 端 GameConfig／
# RateLimitRule 輪詢用的 300 秒比更即時，因為這裡是同一個 process 內
# 直接查資料庫，不是跨服務 HTTP 輪詢，可以負擔更短的 TTL。
_CACHE_TTL_SECONDS = 30
_CACHE_KEY_PREFIX = "adminapi:rate_limit_rule:"
# cache.get() 對「沒有這個 key」跟「這個 key 存的值就是 None」回傳的結果
# 無法區分，用一個限流規則的 rate 字串不可能長這樣的哨兵值來代表
# 「查過了，資料庫裡沒有這筆規則」，藉此把兩種情況分開。
_NOT_FOUND_SENTINEL = "__not_found__"


def get_configured_rate(key: str, default: str) -> str:
    """回傳資料庫裡 RateLimitRule.rate（key 對應的紀錄存在時），否則回傳
    呼叫端傳入的 default（原本寫死在程式碼裡的值）——找不到紀錄不是錯誤，
    是「還沒被 seed_rate_limit_rules 登錄過／後台選擇維持預設」，效果
    等同完全不查表，呼叫端不需要事先在資料庫登錄過才能運作。"""
    cache_key = _CACHE_KEY_PREFIX + key
    cached = cache.get(cache_key)
    if cached is not None:
        return default if cached == _NOT_FOUND_SENTINEL else cached

    try:
        from .models import RateLimitRule
        rate = RateLimitRule.objects.filter(key=key).values_list("rate", flat=True).first()
    except Exception:
        # 資料庫暫時連不上／migration 還沒跑到這張表時，不能讓限流檢查本身
        # 变成 500——安全退回呼叫端原本寫死的值，不快取這次查詢失敗的結果
        # （下次請求就有機會正常查到，不用等 TTL 過期）。
        return default

    cache.set(cache_key, rate if rate is not None else _NOT_FOUND_SENTINEL, _CACHE_TTL_SECONDS)
    return rate if rate is not None else default
