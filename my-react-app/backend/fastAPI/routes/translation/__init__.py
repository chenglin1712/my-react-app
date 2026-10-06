"""族語翻譯路由：拆成職責單一的子模組（比照 ../dictionary/__init__.py 的
既有分包理由）：

- lexicon.py：正規化／切詞／詞綴規則／佐證分層，純函式，不碰 DB
- retrieve.py：pg_trgm 模糊檢索、headword/attested batch 查詢、共用的多詞
  最長匹配 + 三層佐證比對（corroborate_tokens／corroborate_full_sentence）
- prompts.py：中文⇄族語兩個方向的 prompt 組裝，純函式，不碰 HTTP/LLM
- morph.py：詞形分析器（config/morphology.py）接進佐證檢核的執行期載入層，預設
  關閉、只用直接命中、載入失敗一律停用，詳見該檔說明
- service.py：檢索 -> 語料短路判斷 -> LLM 呼叫 -> 佐證檢核，串成一次翻譯
- schemas.py：Pydantic request/response model
- api.py：HTTP 端點（/translate、/capabilities）

跟 dictionary 套件不同的地方：這裡沒有 warm_cache——檢索直接查 PostgreSQL
的 pg_trgm 索引，不維護應用層側索引，沒有東西需要在啟動時預熱（見 alembic
migration 86d389a704d0_add_translation_support.py 的說明）。唯一的例外是
morph.py 的詞形分析器狀態：它只在旗標打開時才會被載入（lazy），辭典詞條異動時
由 /internal/cache/invalidate 的 words scope 失效。
"""
from fastapi import APIRouter

from . import api

router = APIRouter()
router.include_router(api.router)

__all__ = ["router"]
