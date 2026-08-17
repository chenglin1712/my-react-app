"""適性測驗（IRT 選題／作答評分）路由：原本 1000+ 行的單一 quiz.py 把「適性
選題」（IRT 演算法）跟「發音辨識模型」（wav2vec2 音檔嵌入比對）兩個完全不
相關的子系統焊在一起，共用一份 import／全域狀態，改一邊要冒動到另一邊的
風險（P4 review BE-12）。拆成職責單一的子模組：

- schemas.py：出題/作答用的 dataclass、Pydantic request/response model
- irt.py：可由後台調整的 IRT 超參數、從 Django 刷新的機制、計算公式
- repository.py：詞彙資料存取層（依 tribe 分開快取的候選字清單）
- generator.py：候選字排序後怎麼組成四種題型
- api.py：/generate_quiz_frontend、/submit_answer_frontend 端點，並掛上
  ..pronunciation 的 /compare_audio/（wav2vec2 發音比對，見該套件說明），
  維持拆分前「/api/v1/quiz/*」三個端點都在同一個前綴下的對外行為不變

這個 __init__.py 把 router 跟 warm_cache 重新匯出，main.py 的
`app.include_router(quiz.router, prefix="/api/v1/quiz", ...)` 跟
`_warm_caches()` 呼叫的 `quiz.warm_cache` 都不必更動。
"""
from .api import router
from .repository import warm_cache

__all__ = ["router", "warm_cache"]
