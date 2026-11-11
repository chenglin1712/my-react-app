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
from .internal_headers import DJANGO_INTERNAL_HEADERS

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


# 後台回應的欄位名稱 → 本模組的全域變數名稱。
_FIELD_TO_GLOBAL = {
    "listening_questions_per_round": "LISTENING_QUESTIONS_PER_ROUND",
    "listening_options_per_question": "LISTENING_OPTIONS_PER_QUESTION",
    "sentence_questions_per_round": "SENTENCE_QUESTIONS_PER_ROUND",
    "sentence_options_per_question": "SENTENCE_OPTIONS_PER_QUESTION",
    "pronunciation_max_audio_mb": "PRONUNCIATION_MAX_AUDIO_MB",
    "pronunciation_excellent_threshold": "PRONUNCIATION_EXCELLENT_THRESHOLD",
    "pronunciation_good_threshold": "PRONUNCIATION_GOOD_THRESHOLD",
    "pronunciation_fair_threshold": "PRONUNCIATION_FAIR_THRESHOLD",
    "pronunciation_pass_threshold": "PRONUNCIATION_PASS_THRESHOLD",
    "crossword_grid_size": "CROSSWORD_GRID_SIZE",
    "crossword_min_word_length": "CROSSWORD_MIN_WORD_LENGTH",
    "crossword_max_word_length": "CROSSWORD_MAX_WORD_LENGTH",
    "crossword_words_per_round": "CROSSWORD_WORDS_PER_ROUND",
    "crossword_compute_time_limit_seconds": "CROSSWORD_COMPUTE_TIME_LIMIT_SECONDS",
}


def _parse_game_config(data) -> dict:
    """把後台回應整份解析成 {全域變數名稱: 數值}；缺欄位、不是整數（含 None、布林、小數）就丟 ValueError，
    呼叫端因此一個全域變數都不會改——不能先改前幾個、再在中間失敗而留下「半新半舊」的設定。"""
    if not isinstance(data, dict):
        raise ValueError("game-config 回應不是物件")
    parsed = {}
    for field, name in _FIELD_TO_GLOBAL.items():
        value = data.get(field)
        # 後台每個欄位都是整數（PositiveSmallIntegerField）；題數、格數會拿去當 random.sample／range 的參數，
        # 所以小數、NaN、Infinity、布林、字串、None 一律整份拒絕。
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"game-config 欄位 {field} 缺少或不是整數")
        parsed[name] = value
    return parsed


def refresh_game_config_if_stale() -> None:
    global _game_config_last_fetch

    if time.monotonic() - _game_config_last_fetch < _GAME_CONFIG_TTL_SECONDS:
        return

    with _game_config_lock:
        if time.monotonic() - _game_config_last_fetch < _GAME_CONFIG_TTL_SECONDS:
            return
        try:
            resp = requests.get(_GAME_CONFIG_URL, timeout=5, headers=DJANGO_INTERNAL_HEADERS)
            resp.raise_for_status()
            parsed = _parse_game_config(resp.json())  # 整份驗證完才動全域變數
            globals().update(parsed)
        except Exception:
            logger.warning("[game_config] 無法從後台讀取遊戲參數，沿用目前值", exc_info=True)
        finally:
            _game_config_last_fetch = time.monotonic()
