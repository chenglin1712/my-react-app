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
import contextvars
import logging
import os
import threading
import time

import anthropic
from dotenv import load_dotenv

# 模型、effort、max_tokens 依功能設定，見 config/llm_settings.py。
from config.llm_settings import DEFAULT_MODEL, get_settings  # noqa: F401  DEFAULT_MODEL 供外部沿用

load_dotenv()

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


# 呼叫端沒有明確傳 uid 時使用（例如翻譯：FastAPI 的 async 端點先設定，
# asyncio.to_thread 會把 contextvars 複製到執行緒裡）。
current_uid: contextvars.ContextVar[str] = contextvars.ContextVar("llm_current_uid", default="")

# 用量紀錄的寫入端，由各個 process 啟動時註冊（Django：adminapi.ai_usage；FastAPI：
# fastAPI.ai_usage_events）。config/llm.py 同時被兩個 process import，不能直接依賴
# 任何一邊的資料庫存取方式，所以用這個掛鉤反轉依賴。沒有註冊就不記錄。
_usage_recorder = None


def set_usage_recorder(recorder):
    """註冊（或傳 None 取消）用量紀錄函式。recorder(entry: dict) 的回傳值被忽略，
    丟出的任何例外都會被吞掉並記 log，不會影響 LLM 呼叫本身。"""
    global _usage_recorder
    _usage_recorder = recorder


def _error_status(exc: BaseException) -> str:
    """把失敗原因對應成用量紀錄的 status 字串（只有固定幾種，方便後台分組）。"""
    if isinstance(exc, LLMUnavailableError):
        return "breaker_open"
    if isinstance(exc, anthropic.APITimeoutError):
        return "timeout"
    if isinstance(exc, anthropic.RateLimitError):
        return "rate_limit"
    if isinstance(exc, anthropic.APIConnectionError):
        return "connection_error"
    if isinstance(exc, anthropic.InternalServerError):
        return "server_error"
    return "error"


def _as_count(value):
    """token 數只接受真正的非負整數；其他（欄位缺漏、型別怪異）一律當沒有數字，
    寫入端因此永遠收到乾淨的 int 或 None。"""
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _record_usage(*, feature, uid, model, started, status, response=None):
    """記錄 request id、token 用量與延遲：寫 log，並交給已註冊的寫入端。
    只記數字、id 與狀態，不記 prompt 或模型輸出（內含使用者內容）。這是附帶的
    紀錄，任何欄位缺漏或寫入端出錯，都不能讓 LLM 呼叫的結果改變。"""
    try:
        usage = getattr(response, "usage", None)
        request_id = getattr(response, "_request_id", None)
        entry = {
            "feature": feature,
            "uid": uid or "",
            "model": model,
            "status": status,
            "request_id": request_id if isinstance(request_id, str) else "",
            "input_tokens": _as_count(getattr(usage, "input_tokens", None)),
            "output_tokens": _as_count(getattr(usage, "output_tokens", None)),
            "cache_read_tokens": _as_count(getattr(usage, "cache_read_input_tokens", None)),
            "cache_write_tokens": _as_count(getattr(usage, "cache_creation_input_tokens", None)),
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
        logger.info(
            "[config.llm] feature=%s model=%s status=%s request_id=%s input_tokens=%s output_tokens=%s "
            "cache_read_tokens=%s latency_ms=%s",
            feature, model, status, entry["request_id"], entry["input_tokens"], entry["output_tokens"],
            entry["cache_read_tokens"], entry["latency_ms"],
        )
        recorder = _usage_recorder
        if recorder is not None:
            recorder(entry)
    except Exception:
        logger.warning("[config.llm] 用量紀錄失敗（不影響 LLM 呼叫）", exc_info=True)


def call_claude(client, *, feature: str, system: str, messages: list, uid: str | None = None):
    """所有 LLM 請求的唯一出口：斷路器 → 請求 → 紀錄 → 拒答檢查，回傳 SDK 原生的 Message。

    模型、effort 與 max_tokens 由 feature 對應的設定決定（見 config/llm_settings.py），
    呼叫端不再各自指定。取樣參數（temperature 等）刻意不開放：是否支援因模型而異，
    之前的轉接層也一律不轉發，這裡維持同樣行為，避免換模型時變成呼叫端要煩惱的事。

    順序很重要：供應商請求一成功就立刻 record_success，之後的紀錄與拒答檢查出任何
    狀況都不能反過來影響斷路器；拒答（refusal）是模型的決定，不代表供應商故障，
    所以不計入失敗。"""
    settings = get_settings(feature)
    uid = current_uid.get() if uid is None else uid
    started = time.monotonic()
    request = {
        "model": settings.model,
        "max_tokens": settings.max_tokens,
        "system": system,
        "messages": messages,
    }
    if settings.effort:
        request["output_config"] = {"effort": settings.effort}

    try:
        is_probe = _breaker.before_call()
    except LLMUnavailableError as exc:
        _record_usage(feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc))
        raise
    try:
        response = client.messages.create(**request)
    except _TRANSIENT_ERRORS as exc:
        _breaker.record_failure(is_probe)
        _record_usage(feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc))
        raise
    except Exception as exc:
        if is_probe:
            _breaker.abort_probe()
        _record_usage(feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc))
        raise
    except BaseException:
        # KeyboardInterrupt／SystemExit 等：程序正在關閉，只釋放探測名額，不做資料庫寫入。
        if is_probe:
            _breaker.abort_probe()
        raise
    _breaker.record_success(is_probe)

    refused = response.stop_reason == "refusal"
    _record_usage(
        feature=feature, uid=uid, model=settings.model, started=started,
        status="refusal" if refused else "ok", response=response,
    )

    if refused:
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
