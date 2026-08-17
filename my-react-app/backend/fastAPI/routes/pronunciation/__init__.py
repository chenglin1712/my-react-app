"""發音比對（wav2vec2）子系統，從原本的 fastAPI/routes/quiz.py 拆出來
（P4 review BE-12）：quiz.py 原本同時焊著「適性選題」（IRT 演算法）跟
「發音辨識模型」（wav2vec2 音檔嵌入比對）兩個完全不相關的子系統，共用
一份 import／全域狀態，改一邊要冒動到另一邊的風險。拆成：

- audio_fetch.py：官方／真人參考音檔從哪裡下載（含 SSRF 白名單防護）
- model.py：音檔轉 WAV／tensor、wav2vec2 懶載入、嵌入相似度計算
- api.py：/compare_audio/ 端點，只負責串接上面兩個子模組

對外仍掛在跟原本相同的 /api/v1/quiz 前綴下（見 ..quiz 套件的
`router.include_router(pronunciation.router)`），/compare_audio/ 這個
URL 完全不變。
"""
from .api import router

__all__ = ["router"]
