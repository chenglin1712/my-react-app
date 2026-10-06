"""族語詞形分析路由：輸入一個詞形，回傳可能的詞根、詞綴切分、詞綴功能、辭典例句與信心。

- schemas.py：request/response model
- service.py：分析邏輯（規則歸納、詞庫索引、候選排序，全部只用 ORM），每族分析器第一次用到時建立並快取
- api.py：HTTP 端點（/analyze）

跟翻譯的佐證檢核（translation/morph.py）分開：那邊要判斷「詞存不存在」所以極度保守，這裡
是讓使用者探索詞的構成，每個結果都標示來源與信心，見 service.py 的說明。
"""
from fastapi import APIRouter

from . import api, service

router = APIRouter()
router.include_router(api.router)

__all__ = ["router", "service"]
