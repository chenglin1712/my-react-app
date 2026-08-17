"""給其他 Django app 讀取遊戲參數用的 domain service，不暴露 adminapi 的
ORM/model 細節（P4 review BE-8）。

GameConfig 這張表四個遊戲共用一筆設定（見 models.py 的說明），但每個消費端
只在乎自己那個遊戲的欄位——CrosswordPuzzle 不需要知道 GameConfig 這個 model
存在、不需要知道欄位叫 crossword_grid_size 還是別的名字、更不需要知道這是
一筆用 get_or_create(pk=1) 撐出來的單例。這裡回傳的是 immutable dataclass，
呼叫端拿到的是「填字遊戲需要哪些設定」這個穩定介面，不是一個可以任意
.save()、任意存取其他三個遊戲欄位的 Django model instance。

之所以不直接把 model 搬到獨立的 app（原始 review 建議的完整版）：GameConfig
已經跑過 migration、可能已經有正式資料，搬 app_label 涉及 ContentType／
migration dependency graph／db_table 保留等風險，不是今天要在可能有真實
資料的系統上做的等級（見 review 報告 BE-8 的風險評估），這裡先解決「外部
app 直接依賴 adminapi 內部 schema」這個實際耦合問題，model 真正搬家留給
有資料庫備份與 migration 演練的獨立任務。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class CrosswordConfig:
    grid_size: int
    min_word_length: int
    max_word_length: int
    words_per_round: int
    compute_time_limit_seconds: int


def get_crossword_config() -> CrosswordConfig:
    from .models import GameConfig

    obj = GameConfig.load()
    return CrosswordConfig(
        grid_size=obj.crossword_grid_size,
        min_word_length=obj.crossword_min_word_length,
        max_word_length=obj.crossword_max_word_length,
        words_per_round=obj.crossword_words_per_round,
        compute_time_limit_seconds=obj.crossword_compute_time_limit_seconds,
    )
