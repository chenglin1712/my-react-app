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
        # 狀態轉換事件（opened／half_open／probe_failed／closed）。在鎖裡只把事件放進這個清單，
        # 由呼叫端離開鎖之後用 drain_events() 取出再寫入紀錄——鎖裡不能做資料庫寫入。
        self._events: list[dict] = []

    def _note(self, event: str, **detail):
        self._events.append({"event": event, **detail})

    def drain_events(self) -> list[dict]:
        with self._lock:
            events, self._events = self._events, []
        return events

    def snapshot(self) -> dict:
        """這個 process（worker）目前的斷路器狀態；多個 worker 各有一份，互相看不到。"""
        with self._lock:
            state = self._state
            remaining = 0.0
            if state == self.OPEN:
                remaining = max(self._cooldown - (time.monotonic() - self._opened_at), 0.0)
            return {
                "state": state, "consecutiveFailures": self._failures,
                "threshold": self._threshold, "cooldownSeconds": self._cooldown,
                "retryInSeconds": round(remaining, 1),
            }

    def before_call(self) -> bool:
        """回傳這次呼叫是否為試探請求；斷路器不允許通過時丟出 LLMUnavailableError。"""
        with self._lock:
            if self._state == self.CLOSED:
                return False
            if self._state == self.OPEN and time.monotonic() - self._opened_at >= self._cooldown:
                self._state = self.HALF_OPEN
                self._probe_in_flight = False
                self._note("half_open")
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
                self._note("closed")
            elif self._state == self.CLOSED:
                self._failures = 0
            # 其餘情況（OPEN／HALF_OPEN 時回來的普通請求）忽略

    def record_failure(self, is_probe: bool):
        with self._lock:
            if is_probe:
                self._state = self.OPEN
                self._opened_at = time.monotonic()
                self._probe_in_flight = False
                self._note("probe_failed")
                logger.error("[config.llm] LLM 試探請求失敗，再暫停呼叫 %.0f 秒", self._cooldown)
            elif self._state == self.CLOSED:
                self._failures += 1
                if self._failures >= self._threshold:
                    self._state = self.OPEN
                    self._opened_at = time.monotonic()
                    self._note("opened", failures=self._failures)
                    logger.error("[config.llm] LLM 連續失敗 %d 次，暫停呼叫 %.0f 秒", self._failures, self._cooldown)

    def abort_probe(self):
        """試探請求因「非供應商暫時性問題」的例外結束（例如請求本身有誤）：
        不代表供應商恢復或仍壞，釋放試探權，讓下一個請求再試。"""
        with self._lock:
            self._probe_in_flight = False


_breaker = _CircuitBreaker(_BREAKER_THRESHOLD, _BREAKER_COOLDOWN_SECONDS)

# 意圖路由與閒聊用的是另一個模型（Haiku）。它的故障不該讓主模型（Sonnet）的斷路器跳開，
# 否則「分類失敗就退回原流程」的退路會被自己的失敗堵死，所以分開計算。
_LIGHT_FEATURES = frozenset({"route", "light"})
_light_breaker = _CircuitBreaker(_BREAKER_THRESHOLD, _BREAKER_COOLDOWN_SECONDS)


def _breaker_for(feature: str):
    return _light_breaker if feature in _LIGHT_FEATURES else _breaker


def classify_llm_error(exc: BaseException) -> tuple[int, str]:
    """把 LLM 呼叫失敗對應成 (HTTP 狀態碼, 給使用者看的訊息)。原本一律 502，
    前端分不出「稍後再試有用」（逾時、限流、暫停中）與「真的壞了」。
    內部例外訊息不外流，只回固定文字。"""
    if isinstance(exc, LLMUnavailableError):
        return 503, "AI 服務目前忙碌，請稍後再試"
    if isinstance(exc, LLMRefusalError):
        # 拒答是模型的決定，不是服務壞了；AI 對話在 services 層就已改回 200 與固定說明，
        # 走到這裡的是沒有自己處理拒答的呼叫端（例如翻譯），回 422 比通用 502 準確。
        return 422, REFUSAL_MESSAGE
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


def _exception_request_id(exc: BaseException) -> str | None:
    """失敗的呼叫沒有 response，但 SDK 的 API 錯誤帶有 request_id；有了它才能拿去對照 Anthropic 端的紀錄。
    逾時與連線錯誤沒有（請求可能根本沒送達），回傳 None。"""
    request_id = getattr(exc, "request_id", None)
    return request_id if isinstance(request_id, str) else None


def _record_usage(*, feature, uid, model, started, status, response=None, request_id=None):
    """記錄 request id、token 用量與延遲：寫 log，並交給已註冊的寫入端。
    只記數字、id 與狀態，不記 prompt 或模型輸出（內含使用者內容）。這是附帶的
    紀錄，任何欄位缺漏或寫入端出錯，都不能讓 LLM 呼叫的結果改變。
    request_id：失敗時由呼叫端從例外取出（成功時取自 response）。"""
    try:
        usage = getattr(response, "usage", None)
        request_id = getattr(response, "_request_id", None) or request_id
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


REFUSAL_MESSAGE = "這個問題我沒辦法回答，換個方式問問看。"


class LLMRefusalError(RuntimeError):
    """模型拒絕回應（stop_reason == refusal）。是模型的決定而不是供應商故障，
    呼叫端可以選擇回友善訊息而不是 502；仍是 RuntimeError，原本的處理不受影響。
    category：API 的 stop_details.category（拒答的分類，沒有就是空字串），只用於紀錄，不顯示給使用者。"""

    def __init__(self, message: str = "", category: str = ""):
        super().__init__(message)
        self.category = category


def _refusal_category(response) -> str:
    details = getattr(response, "stop_details", None)
    category = getattr(details, "category", None)
    return category if isinstance(category, str) else ""


def _emit_breaker_events(breaker, model: str) -> None:
    """把斷路器剛發生的狀態轉換寫進 log 與用量表（feature="breaker"，status 為事件名稱）。
    離開斷路器的鎖之後才呼叫：寫入端會做資料庫存取。紀錄失敗不影響 LLM 呼叫。"""
    for event in breaker.drain_events():
        try:
            logger.warning("[config.llm] 斷路器事件 event=%s detail=%s", event["event"], {k: v for k, v in event.items() if k != "event"})
            recorder = _usage_recorder
            if recorder is not None:
                recorder({
                    "feature": "breaker", "uid": "", "model": model, "status": event["event"], "request_id": "",
                    "input_tokens": None, "output_tokens": None, "cache_read_tokens": None, "cache_write_tokens": None,
                    "latency_ms": 0,
                })
        except Exception:
            logger.warning("[config.llm] 斷路器事件紀錄失敗（不影響 LLM 呼叫）", exc_info=True)


def breaker_state() -> dict:
    """這個 process 的斷路器目前狀態（後台「AI 用量」頁顯示用）。"""
    return _breaker.snapshot()


# 一次請求整體的截止時間（time.monotonic() 的絕對值），由串流端點設定。設了之後每次 LLM 呼叫的逾時
# 都被壓在剩餘時間內並且不重試，所以不論路由、工具輪次或慢速串流，整體都不會超過 gunicorn 的 --timeout。
llm_deadline: contextvars.ContextVar = contextvars.ContextVar("llm_deadline", default=None)
_MIN_BUDGET_SECONDS = 2.0


class LLMDeadlineError(TimeoutError):
    """整體截止時間快到了，不再發出新的 LLM 請求。不計入斷路器（不是供應商的錯）。"""


def _with_deadline(client):
    deadline = llm_deadline.get()
    if deadline is None:
        return client
    remaining = deadline - time.monotonic()
    if remaining < _MIN_BUDGET_SECONDS:
        raise LLMDeadlineError("[config.llm] 已接近整體截止時間，不再呼叫 LLM")
    return client.with_options(timeout=min(_TIMEOUT_SECONDS, remaining), max_retries=0)


def _build_request(settings, system, messages, output_schema=None, tools=None, tool_choice=None) -> dict:
    """call_claude 與 stream_claude 共用的請求內容（兩者只差在 create 或 stream）。"""
    request = {
        "model": settings.model,
        "max_tokens": settings.max_tokens,
        "system": system,
        "messages": messages,
    }
    output_config = {}
    if settings.effort:
        output_config["effort"] = settings.effort
    if output_schema is not None:
        output_config["format"] = {"type": "json_schema", "schema": output_schema}
    if output_config:
        request["output_config"] = output_config
    if tools:
        request["tools"] = tools
        if tool_choice:
            request["tool_choice"] = tool_choice
    return request


def call_claude(client, *, feature: str, system: str | list, messages: list, uid: str | None = None,
                output_schema: dict | None = None, tools: list | None = None, tool_choice: dict | None = None):
    """所有 LLM 請求的唯一出口：斷路器 → 請求 → 紀錄 → 拒答檢查，回傳 SDK 原生的 Message。

    system：字串，或帶 cache_control 的 text 區塊清單（提示快取，見 AIModel/services.py 的 system_blocks）。

    模型、effort 與 max_tokens 由 feature 對應的設定決定（見 config/llm_settings.py），
    呼叫端不再各自指定。取樣參數（temperature 等）刻意不開放：是否支援因模型而異，
    之前的轉接層也一律不轉發，這裡維持同樣行為，避免換模型時變成呼叫端要煩惱的事。

    output_schema：給 JSON Schema 時走結構化輸出（output_config.format），回應文字保證是
    符合 schema 的 JSON；與 effort 並存於同一個 output_config。

    tools／tool_choice：用戶端工具的定義與選擇方式。回應可能是 stop_reason == "tool_use"，
    由呼叫端執行工具後把結果放回 messages 再呼叫一次（見 AIModel/services.py 的工具迴圈）。
    Sonnet 5.5 不能強制指定某個工具，tool_choice 只用 auto（不傳）或 {"type": "none"}。

    順序很重要：供應商請求一成功就立刻 record_success，之後的紀錄與拒答檢查出任何
    狀況都不能反過來影響斷路器；拒答（refusal）是模型的決定，不代表供應商故障，
    所以不計入失敗。"""
    settings = get_settings(feature)
    uid = current_uid.get() if uid is None else uid
    started = time.monotonic()
    request = _build_request(settings, system, messages, output_schema, tools, tool_choice)
    client = _with_deadline(client)
    breaker = _breaker_for(feature)

    try:
        is_probe = breaker.before_call()
    except LLMUnavailableError as exc:
        _record_usage(feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc))
        raise
    finally:
        _emit_breaker_events(breaker, settings.model)
    try:
        response = client.messages.create(**request)
    except _TRANSIENT_ERRORS as exc:
        breaker.record_failure(is_probe)
        _emit_breaker_events(breaker, settings.model)
        _record_usage(
            feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc),
            request_id=_exception_request_id(exc),
        )
        raise
    except Exception as exc:
        if is_probe:
            breaker.abort_probe()
        _record_usage(
            feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc),
            request_id=_exception_request_id(exc),
        )
        raise
    except BaseException:
        # KeyboardInterrupt／SystemExit 等：程序正在關閉，只釋放探測名額，不做資料庫寫入。
        if is_probe:
            breaker.abort_probe()
        raise
    breaker.record_success(is_probe)
    _emit_breaker_events(breaker, settings.model)

    refused = response.stop_reason == "refusal"
    _record_usage(
        feature=feature, uid=uid, model=settings.model, started=started,
        status="refusal" if refused else "ok", response=response,
    )

    if refused:
        category = _refusal_category(response)
        logger.warning(
            "[config.llm] 模型拒答 feature=%s model=%s request_id=%s category=%s",
            feature, settings.model, getattr(response, "_request_id", "") or "", category or "unknown",
        )
        raise LLMRefusalError("[config.llm] Claude 拒絕回應此請求（refusal）", category=category)

    return response


def stream_claude(client, *, feature: str, system: str | list, messages: list, uid: str | None = None,
                  tools: list | None = None, tool_choice: dict | None = None):
    """call_claude 的串流版（路線圖 #9）：generator，邊收邊 yield 文字片段（str），
    結束時【回傳】SDK 原生的最終 Message（用 `final = yield from ...` 取得）。

    斷路器、用量紀錄、拒答檢查與 call_claude 完全一致，差別只在：
    - 串流中途失敗（連線中斷等）同樣計入斷路器失敗，並記錄實際失敗原因；已 yield 出去的文字收不回來，
      呼叫端要負責讓使用者知道這則回覆不完整。
    - 呼叫端提早放棄（使用者按停止、連線關閉）時 generator 被關閉：供應商本身沒問題，所以不計入斷路器失敗；
      用量以 status="cancelled" 記錄，token 取串流到目前為止的快照（輸出只算到中斷那一刻）。
    - 不支援結構化輸出（那是整段 JSON，串流給使用者看沒有意義）。

    拒答仍是在串流結束後才知道（stop_reason == refusal），此時文字可能已經 yield 出去一部分，
    呼叫端要以 LLMRefusalError 為準，用固定說明取代已顯示的內容。"""
    settings = get_settings(feature)
    uid = current_uid.get() if uid is None else uid
    started = time.monotonic()
    request = _build_request(settings, system, messages, tools=tools, tool_choice=tool_choice)
    client = _with_deadline(client)
    breaker = _breaker_for(feature)

    try:
        is_probe = breaker.before_call()
    except LLMUnavailableError as exc:
        _record_usage(feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc))
        raise
    finally:
        _emit_breaker_events(breaker, settings.model)

    stream = None
    try:
        with client.messages.stream(**request) as stream:
            for text in stream.text_stream:
                yield text
            response = stream.get_final_message()
    except GeneratorExit:
        # 呼叫端不要了。generator 只會在 yield 的地方被關閉，也就是至少已經收到並送出一段文字：供應商是通的。
        # （還沒收到第一個字時 generator 阻塞在 SDK 裡，收不到關閉訊號，那種情況由逾時處理。）
        breaker.record_success(is_probe)
        _emit_breaker_events(breaker, settings.model)
        _record_usage(
            feature=feature, uid=uid, model=settings.model, started=started, status="cancelled",
            response=_snapshot(stream),
        )
        raise
    except _TRANSIENT_ERRORS as exc:
        breaker.record_failure(is_probe)
        _emit_breaker_events(breaker, settings.model)
        _record_usage(
            feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc),
            request_id=_exception_request_id(exc),
        )
        raise
    except Exception as exc:
        if is_probe:
            breaker.abort_probe()
        _record_usage(
            feature=feature, uid=uid, model=settings.model, started=started, status=_error_status(exc),
            request_id=_exception_request_id(exc),
        )
        raise
    except BaseException:
        if is_probe:
            breaker.abort_probe()
        raise
    breaker.record_success(is_probe)
    _emit_breaker_events(breaker, settings.model)

    refused = response.stop_reason == "refusal"
    _record_usage(
        feature=feature, uid=uid, model=settings.model, started=started,
        status="refusal" if refused else "ok", response=response,
    )
    if refused:
        category = _refusal_category(response)
        logger.warning(
            "[config.llm] 模型拒答 feature=%s model=%s request_id=%s category=%s",
            feature, settings.model, getattr(response, "_request_id", "") or "", category or "unknown",
        )
        raise LLMRefusalError("[config.llm] Claude 拒絕回應此請求（refusal）", category=category)
    return response


def _snapshot(stream):
    """串流到目前為止的訊息快照（含 usage）；還沒收到任何事件或取不到就回傳 None，用量欄位留空。"""
    try:
        return stream.current_message_snapshot if stream is not None else None
    except Exception:
        return None


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
