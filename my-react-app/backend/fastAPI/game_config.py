"""聽力／句型／發音／填字四個遊戲的可調參數——跨服務輪詢 Django adminapi
的 GameConfig 單例（見 backend/adminapi/game_config_views.py 的
public_game_config）。

完全比照 routes/quiz.py 既有的 IRT 參數輪詢模式（_refresh_irt_config_if_stale）：
TTL 到期前重複呼叫是 no-op、雙重檢查鎖定、失敗時記警告並沿用目前值（可能是
上次成功抓到的值，也可能是這裡寫死的預設值）、finally 一定更新時間戳記避免
Django 掛掉時每個請求都重新嘗試連線。獨立成這支模組（而不是直接塞進
routes/quiz.py）是因為聽力／句型／填字三個消費端都不在 quiz.py 裡，讓它們
各自 import quiz.py 只為了讀幾個全域變數不合理；發音（quiz.py 的
compare_audio）一樣從這裡 import，不特別區分。
"""
import logging
import os
import threading
import time

import requests

logger = logging.getLogger(__name__)

# 這裡的預設值刻意跟 GameConfig model 的欄位預設值完全一致（見
# adminapi/models.py 的 GameConfig）——確保後台從未設定過、或 Django 暫時
# 連不上時，四個遊戲的行為維持原本這些數字寫死時的樣子，不會突然跳成別的值。
LISTENING_QUESTIONS_PER_ROUND = 10
LISTENING_OPTIONS_PER_QUESTION = 4
SENTENCE_QUESTIONS_PER_ROUND = 5
SENTENCE_OPTIONS_PER_QUESTION = 4
PRONUNCIATION_MAX_AUDIO_MB = 10
PRONUNCIATION_EXCELLENT_THRESHOLD = 80
PRONUNCIATION_GOOD_THRESHOLD = 60
PRONUNCIATION_FAIR_THRESHOLD = 40
PRONUNCIATION_PASS_THRESHOLD = 70
CROSSWORD_GRID_SIZE = 13
CROSSWORD_MIN_WORD_LENGTH = 4
CROSSWORD_MAX_WORD_LENGTH = 10
CROSSWORD_WORDS_PER_ROUND = 30
CROSSWORD_COMPUTE_TIME_LIMIT_SECONDS = 2

_GAME_CONFIG_URL = os.getenv("DJANGO_INTERNAL_BASE_URL", "http://127.0.0.1:8000") + "/adminapi/public/game-config/"
# 四個遊戲的參數改了之後不影響任何已快取內容（不像辭典寫入那樣需要主動
# 通知快取失效，見規劃文件的說明），300 秒的輪詢間隔跟 IRT 參數同一種
# 取捨：不是秒等的即時性需求，不需要每個請求都打一次 Django。
_GAME_CONFIG_TTL_SECONDS = 300
_game_config_last_fetch = 0.0
_game_config_lock = threading.Lock()


def refresh_game_config_if_stale() -> None:
    global LISTENING_QUESTIONS_PER_ROUND, LISTENING_OPTIONS_PER_QUESTION
    global SENTENCE_QUESTIONS_PER_ROUND, SENTENCE_OPTIONS_PER_QUESTION
    global PRONUNCIATION_MAX_AUDIO_MB, PRONUNCIATION_EXCELLENT_THRESHOLD
    global PRONUNCIATION_GOOD_THRESHOLD, PRONUNCIATION_FAIR_THRESHOLD, PRONUNCIATION_PASS_THRESHOLD
    global CROSSWORD_GRID_SIZE, CROSSWORD_MIN_WORD_LENGTH, CROSSWORD_MAX_WORD_LENGTH
    global CROSSWORD_WORDS_PER_ROUND, CROSSWORD_COMPUTE_TIME_LIMIT_SECONDS
    global _game_config_last_fetch

    if time.monotonic() - _game_config_last_fetch < _GAME_CONFIG_TTL_SECONDS:
        return

    with _game_config_lock:
        if time.monotonic() - _game_config_last_fetch < _GAME_CONFIG_TTL_SECONDS:
            return
        try:
            resp = requests.get(_GAME_CONFIG_URL, timeout=5)
            resp.raise_for_status()
            data = resp.json()

            LISTENING_QUESTIONS_PER_ROUND = data["listening_questions_per_round"]
            LISTENING_OPTIONS_PER_QUESTION = data["listening_options_per_question"]
            SENTENCE_QUESTIONS_PER_ROUND = data["sentence_questions_per_round"]
            SENTENCE_OPTIONS_PER_QUESTION = data["sentence_options_per_question"]
            PRONUNCIATION_MAX_AUDIO_MB = data["pronunciation_max_audio_mb"]
            PRONUNCIATION_EXCELLENT_THRESHOLD = data["pronunciation_excellent_threshold"]
            PRONUNCIATION_GOOD_THRESHOLD = data["pronunciation_good_threshold"]
            PRONUNCIATION_FAIR_THRESHOLD = data["pronunciation_fair_threshold"]
            PRONUNCIATION_PASS_THRESHOLD = data["pronunciation_pass_threshold"]
            CROSSWORD_GRID_SIZE = data["crossword_grid_size"]
            CROSSWORD_MIN_WORD_LENGTH = data["crossword_min_word_length"]
            CROSSWORD_MAX_WORD_LENGTH = data["crossword_max_word_length"]
            CROSSWORD_WORDS_PER_ROUND = data["crossword_words_per_round"]
            CROSSWORD_COMPUTE_TIME_LIMIT_SECONDS = data["crossword_compute_time_limit_seconds"]
        except Exception:
            logger.warning("[game_config] 無法從後台讀取遊戲參數，沿用目前值", exc_info=True)
        finally:
            _game_config_last_fetch = time.monotonic()
