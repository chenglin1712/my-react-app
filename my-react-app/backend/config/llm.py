"""LLM client 的單一來源——Django 的 tayal_chat／review_tayal_chat 兩個 AI 對話端點
(backend/AIModel/) 與族語翻譯功能 (backend/fastAPI/routes/translation/) 共用同一個
Anthropic client、同一組逾時／重試／斷路器設定（比照 config/tribes.py／
core/firebase_auth.py 的既有模式，放在兩邊都能 import 的共用套件）。

呼叫端直接使用官方 `anthropic` SDK 的原生形狀（`client.messages.create`），
但一律透過這裡的 `call_claude()`：斷路器、request id／用量紀錄、拒答檢查都在
這一個函式裡，繞過它就繞過了斷路器。回傳的是 SDK 原生的 `Message`，文字用
`extract_text()` 取出。

2026-08：GitHub Models（原本代理 GPT-4o 的服務）已於 2026-07-30 正式關閉，
改接 Anthropic 官方 Claude API。改接當時為了讓呼叫端不用改，曾經在 SDK 外面
包一層 OpenAI 形狀（`chat.completions.create(...).choices[0].message.content`）的
轉接層；該層只轉「文字進、文字出」，串流、工具、快取、引用、結構化輸出與用量都
過不去，已移除。
"""
import logging
import os
import threading
import time

import anthropic
from dotenv import load_dotenv

load_dotenv()

# Claude Sonnet 5——此專案的用途是短句翻譯／學生對話回覆，不需要 Opus 5 的
# 最強推理能力；Sonnet 5 品質已足夠，成本約為 Opus 5 的 4 折（經使用者確認）。
DEFAULT_MODEL = "claude-sonnet-5"

# 呼叫端目前的輸出都是短內容（50 字內中文說明、簡短讀書計畫 JSON、翻譯 JSON），
# 4096 tokens 留有餘裕又不至於放大意外重試的成本。
_MAX_TOKENS = 4096

_client = None

logger = logging.getLogger(__name__)

# 供應商變慢或限流時的保護：原本 Anthropic client 沒有明確的 timeout／重試策略，
# 只能吃 SDK 預設值（單次請求可能等上十分鐘），延遲期間 Django worker／FastAPI
# 執行緒會被一個個占住，最後連跟 AI 無關的請求也排不進來。
#   LLM_TIMEOUT_SECONDS    單次請求逾時（預設 25 秒）
#   LLM_MAX_RETRIES        SDK 內建的退避重試次數（預設 1）
#   LLM_BREAKER_THRESHOLD  連續失敗幾次後暫停呼叫（預設 5）
#   LLM_BREAKER_COOLDOWN_SECONDS  暫停多久後才再放行一次試探（預設 30 秒）
#
# 逾時預算必須「由內而外」逐層放大，否則內層的逾時處理來不及執行就被外層強制中斷：
#   LLM 最長等待 = (重試次數 + 1) × 單次逾時 + 退避 ≈ 2 × 25 + 數秒 ≈ 55 秒
#   < gunicorn --timeout（docker-compose.prod.yml，75 秒）
#   < nginx proxy_read_timeout（deploy/nginx.conf，90 秒）
# 調高這裡的任何一個數字，都要同步檢查另外兩個；test_llm_resilience.py 會檢查這個關係。
_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "25"))
_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "1"))
_BREAKER_THRESHOLD = int(os.getenv("LLM_BREAKER_THRESHOLD", "5"))
_BREAKER_COOLDOWN_SECONDS = float(os.getenv("LLM_BREAKER_COOLDOWN_SECONDS", "30"))

# 屬於「供應商端暫時性問題」的例外：這類連續發生才值得暫停呼叫。請求本身有誤
# （400/401/422 之類）重試或暫停都沒有意義，不計入。
_TRANSIENT_ERRORS = (
    anthropic.APITimeoutError,
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
    anthropic.InternalServerError,
)


class LLMUnavailableError(RuntimeError):
    """斷路器開啟中：供應商連續失敗，這段冷卻期間直接拒絕，不再占用 worker 等逾時。"""


class _CircuitBreaker:
    """三態斷路器：CLOSED（正常）→ OPEN（連續失敗後暫停）→ HALF_OPEN（冷卻結束，
    只放行「一個」試探請求）→ 試探成功回 CLOSED，失敗回 OPEN 並從失敗當下重新計時。

    重點是試探請求要有明確身分（before_call 的回傳值）：
    - 同一時間只會有一個試探在進行，試探耗時超過冷卻時間也不會放行第二個
    - 只有試探請求的結果能讓斷路器關閉或重新開啟；在斷路器開啟之前就送出、
      之後才回來的普通請求，結果一律忽略，不能把狀態誤判成已恢復
    """

    CLOSED, OPEN, HALF_OPEN = "closed", "open", "half_open"

    def __init__(self, threshold: int, cooldown: float):
        self._threshold = threshold
        self._cooldown = cooldown
        self._failures = 0
        self._state = self.CLOSED
        self._opened_at = 0.0
        self._probe_in_flight = False
        self._lock = threading.Lock()

    def before_call(self) -> bool:
        """回傳這次呼叫是否為試探請求；斷路器不允許通過時丟出 LLMUnavailableError。"""
        with self._lock:
            if self._state == self.CLOSED:
                return False
            if self._state == self.OPEN and time.monotonic() - self._opened_at >= self._cooldown:
                self._state = self.HALF_OPEN
                self._probe_in_flight = False
            if self._state == self.HALF_OPEN and not self._probe_in_flight:
                self._probe_in_flight = True
                return True
        raise LLMUnavailableError("[config.llm] LLM 服務連續失敗，暫時停止呼叫")

    def record_success(self, is_probe: bool):
        with self._lock:
            if is_probe:
                self._state = self.CLOSED
                self._failures = 0
                self._probe_in_flight = False
            elif self._state == self.CLOSED:
                self._failures = 0
            # 其餘情況（OPEN／HALF_OPEN 時回來的普通請求）忽略

    def record_failure(self, is_probe: bool):
        with self._lock:
            if is_probe:
                self._state = self.OPEN
                self._opened_at = time.monotonic()
                self._probe_in_flight = False
                logger.error("[config.llm] LLM 試探請求失敗，再暫停呼叫 %.0f 秒", self._cooldown)
            elif self._state == self.CLOSED:
                self._failures += 1
                if self._failures >= self._threshold:
                    self._state = self.OPEN
                    self._opened_at = time.monotonic()
                    logger.error("[config.llm] LLM 連續失敗 %d 次，暫停呼叫 %.0f 秒", self._failures, self._cooldown)

    def abort_probe(self):
        """試探請求因「非供應商暫時性問題」的例外結束（例如請求本身有誤）：
        不代表供應商恢復或仍壞，釋放試探權，讓下一個請求再試。"""
        with self._lock:
            self._probe_in_flight = False


_breaker = _CircuitBreaker(_BREAKER_THRESHOLD, _BREAKER_COOLDOWN_SECONDS)


def classify_llm_error(exc: BaseException) -> tuple[int, str]:
    """把 LLM 呼叫失敗對應成 (HTTP 狀態碼, 給使用者看的訊息)。原本一律 502，
    前端分不出「稍後再試有用」（逾時、限流、暫停中）與「真的壞了」。
    內部例外訊息不外流，只回固定文字。"""
    if isinstance(exc, LLMUnavailableError):
        return 503, "AI 服務目前忙碌，請稍後再試"
    if isinstance(exc, anthropic.APITimeoutError):
        return 504, "AI 服務回應逾時，請稍後再試"
    if isinstance(exc, anthropic.RateLimitError):
        return 429, "AI 服務使用人數較多，請稍後再試"
    return 502, "AI 服務暫時無法回應，請稍後再試"


def _log_call(response, model: str):
    """記錄 request id 與 token 用量，出問題時可以用 request id 對照 Anthropic 端的紀錄。
    只記數字與 id，不記 prompt 或模型輸出（內含使用者內容）。這是附帶的紀錄，
    任何欄位缺漏都不能讓已經成功的 LLM 呼叫變成失敗。"""
    try:
        usage = getattr(response, "usage", None)
        logger.info(
            "[config.llm] model=%s request_id=%s input_tokens=%s output_tokens=%s cache_read_tokens=%s",
            model,
            getattr(response, "_request_id", None),
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
            getattr(usage, "cache_read_input_tokens", None),
        )
    except Exception:
        pass


def call_claude(client, *, model: str, system: str, messages: list, max_tokens: int = _MAX_TOKENS):
    """所有 LLM 請求的唯一出口：斷路器 → 請求 → 紀錄 → 拒答檢查，回傳 SDK 原生的 Message。

    取樣參數（temperature 等）刻意不開放：是否支援因模型而異，之前的轉接層也一律
    不轉發，這裡維持同樣行為，避免換模型時變成呼叫端要煩惱的事。

    順序很重要：供應商請求一成功就立刻 record_success，之後的紀錄與拒答檢查出任何
    狀況都不能反過來影響斷路器；拒答（refusal）是模型的決定，不代表供應商故障，
    所以不計入失敗。"""
    is_probe = _breaker.before_call()
    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
    except _TRANSIENT_ERRORS:
        _breaker.record_failure(is_probe)
        raise
    except BaseException:
        if is_probe:
            _breaker.abort_probe()
        raise
    _breaker.record_success(is_probe)

    _log_call(response, model)

    if response.stop_reason == "refusal":
        raise RuntimeError("[config.llm] Claude 拒絕回應此請求（refusal）")

    return response


def extract_text(response) -> str:
    """串接回應中所有文字區塊（過濾掉 thinking、tool_use 等其他類型的區塊）。"""
    return "".join(
        getattr(block, "text", "")
        for block in response.content
        if getattr(block, "type", None) == "text"
    )


def get_llm_client():
    """延遲初始化 Anthropic client，第一次真的呼叫 AI 功能時才檢查
    ANTHROPIC_API_KEY。

    這個函式會被兩個進入點 import：Django 的 core/urls.py 一定會 import 到
    AIModel.urls，FastAPI 的 main.py 一定會 import 到 translation 路由——兩邊
    都不該在「模組載入」當下就檢查金鑰，缺一把金鑰不該讓整個 process 啟動
    失敗、連跟 AI 功能無關的其他端點都連帶壞掉。延後到實際呼叫時才檢查，
    缺金鑰只會讓用到 AI 的端點回 503，其餘功能不受影響。"""
    global _client
    if _client is not None:
        return _client
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "[config.llm] 環境變數 ANTHROPIC_API_KEY 未設定，AI 對話／翻譯功能無法使用。"
            "請在 .env 填入 Anthropic API key。"
        )
    _client = anthropic.Anthropic(api_key=api_key, timeout=_TIMEOUT_SECONDS, max_retries=_MAX_RETRIES)
    return _client
