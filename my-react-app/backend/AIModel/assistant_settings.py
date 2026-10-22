"""管理者可調整的助手設定（路線圖 #35、#28）：離題處理寬鬆程度、離題固定說明、開場白、建議問題、
聊天的補充指示。每次儲存都新增一個版本（AiAssistantSettingsVersion），回滾也是新增版本。

可調整的範圍刻意有限：安全規則、辭典規則、輸出格式、注入防護這些核心提示詞留在程式裡，由程式碼審查把關；
管理者只能在最後面「補充風格指示」，而且不能覆蓋前面的規則（提示詞裡明講）。這是為了不讓任何人
在後台改一個字就解除防護；要改核心提示詞仍然走程式碼與評測題組（#29）。

讀取有 30 秒快取，儲存時清掉自己這個 process 的快取；多個 worker 最久 30 秒後都會看到新版本。
資料庫讀不到時用預設值，助手照常運作。
"""
import contextlib
import contextvars
import logging
import re
import threading
import time

logger = logging.getLogger(__name__)

POLICY_STRICT = "strict"        # 離題：固定說明，不呼叫模型
POLICY_GENTLE = "gentle"        # 離題：輕量模型簡短回應並引導回學習（不用大模型）
POLICIES = (POLICY_STRICT, POLICY_GENTLE)

DEFAULT_OFF_TOPIC_MESSAGE = "這個問題超出我能幫忙的範圍。我可以幫你查族語詞彙、解釋文法、介紹族群文化，或分析你的學習狀況。"
DEFAULT_GREETING = "你好！我是您的{tribe} AI 助手，有什麼我可以幫您的嗎？"
DEFAULT_SUGGESTIONS = ("我想了解我的學習狀況", "介紹這個族語的文化特色", "幫我排一週讀書計畫")

MAX_OFF_TOPIC_MESSAGE = 200
MAX_GREETING = 120
MAX_SUGGESTION = 40
MAX_CHAT_EXTRA = 800
NOTE_MAX = 100
FIELDS = ("offtopic_policy", "off_topic_message", "greeting", "suggestions", "chat_extra")

DEFAULTS = {
    "offtopic_policy": POLICY_STRICT,
    "off_topic_message": DEFAULT_OFF_TOPIC_MESSAGE,
    "greeting": DEFAULT_GREETING,
    "suggestions": list(DEFAULT_SUGGESTIONS),
    "chat_extra": "",
}

_CACHE_TTL = 30
_cache: dict = {"until": 0.0, "value": None, "version": 0, "gen": 0}
_lock = threading.Lock()
# 後台「試跑」用：只在這一個請求內用草稿設定取代生效的設定，不寫資料庫、不影響其他請求
_override: contextvars.ContextVar = contextvars.ContextVar("assistant_settings_override", default=None)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_URL = re.compile(r"https?://|www\.", re.IGNORECASE)
# 補充風格指示只能調語氣；明顯想解除規則的措辭直接擋下。這只能防誤操作與隨手的惡意，不是安全邊界：
# 真正的把關是只有 owner／admin 能改、每次修改留版本與稽核紀錄、儲存前可試跑。核心規則改動仍走程式碼審查與評測題組。
_OVERRIDE_PHRASES = re.compile(
    r"忽略|無視|忽視|不要理會|不理會|取消.{0,6}(規則|限制|防護)|解除|繞過|覆蓋|不要拒絕|不用拒絕|不必拒絕|"
    r"系統提示|system prompt|jailbreak|越獄|ignore|disregard|override",
    re.IGNORECASE,
)


class SettingsError(ValueError):
    """儲存內容不合法；訊息可直接顯示給管理者。"""


def _text(value, name: str, limit: int, *, multiline: bool = False, required: bool = True) -> str:
    if not isinstance(value, str):
        raise SettingsError(f"{name}必須是文字")
    clean = _CONTROL.sub("", value).strip()
    if not multiline and ("\n" in clean or "\r" in clean):
        raise SettingsError(f"{name}不能換行")
    if required and not clean:
        raise SettingsError(f"{name}不能是空的")
    if len(clean) > limit:
        raise SettingsError(f"{name}不能超過 {limit} 字")
    if "<" in clean or ">" in clean:
        raise SettingsError(f"{name}不能包含角括號（< >）")
    if _URL.search(clean):
        raise SettingsError(f"{name}不能放網址")
    if name == "補充風格指示" and _OVERRIDE_PHRASES.search(clean):
        raise SettingsError("補充風格指示只能調整語氣與說明方式，不能出現「忽略、無視、解除、覆蓋、不要拒絕」這類改變規則的措辭")
    return clean


def validate(raw) -> dict:
    """把管理者送來的設定整理成乾淨的 dict；任何欄位不合法就丟 SettingsError。缺的欄位用預設值。"""
    if not isinstance(raw, dict):
        raise SettingsError("設定格式不正確")
    unknown = set(raw) - set(FIELDS)
    if unknown:
        raise SettingsError(f"不認得的欄位：{', '.join(sorted(unknown))}")
    merged = {**DEFAULTS, **raw}
    policy = merged["offtopic_policy"]
    if policy not in POLICIES:
        raise SettingsError("離題處理只能選「嚴格」或「寬鬆」")
    suggestions = merged["suggestions"]
    if not isinstance(suggestions, (list, tuple)) or len(suggestions) != 3:
        raise SettingsError("建議問題必須剛好三句")
    cleaned = [_text(item, "建議問題", MAX_SUGGESTION) for item in suggestions]
    if len(set(cleaned)) != 3:
        raise SettingsError("三句建議問題不能重複")
    greeting = _text(merged["greeting"], "開場白", MAX_GREETING)
    if greeting.count("{tribe}") > 1 or re.search(r"\{(?!tribe\})[^}]*\}", greeting):
        raise SettingsError("開場白只能用一個 {tribe} 代表族語名稱，不能有其他大括號")
    return {
        "offtopic_policy": policy,
        "off_topic_message": _text(merged["off_topic_message"], "離題說明", MAX_OFF_TOPIC_MESSAGE),
        "greeting": greeting,
        "suggestions": cleaned,
        "chat_extra": _text(merged["chat_extra"], "補充風格指示", MAX_CHAT_EXTRA, multiline=True, required=False),
    }


def _load_from_db() -> tuple:
    from adminapi.models import AiAssistantSettingsVersion

    row = AiAssistantSettingsVersion.objects.order_by("-id").first()
    if row is None:
        return dict(DEFAULTS), 0
    try:
        return validate(row.content), row.pk
    except SettingsError:
        # 資料被直接改壞（不是透過後台）：寧可用預設值，也不要讓助手帶著壞設定跑
        logger.error("[AIModel] 助手設定 v%s 內容不合法，改用預設值", row.pk)
        return dict(DEFAULTS), 0


def active() -> dict:
    """目前生效的設定（乾淨的 dict，呼叫端可以直接用，不要修改它）。"""
    return active_with_version()[0]


@contextlib.contextmanager
def override(content):
    """在這個區塊內，active() 回傳驗證過的草稿 content（試跑用）。"""
    token = _override.set(validate(content))
    try:
        yield
    finally:
        _override.reset(token)


def active_with_version() -> tuple:
    draft = _override.get()
    if draft is not None:
        return draft, -1                  # -1＝草稿（尚未儲存）
    now = time.time()               # 不用 monotonic：測試常把它換成固定序列
    with _lock:
        if _cache["value"] is not None and _cache["until"] > now:
            return _cache["value"], _cache["version"]
        gen = _cache["gen"]
    try:
        value, version = _load_from_db()
        ttl = _CACHE_TTL
    except Exception:
        logger.warning("[AIModel] 讀取助手設定失敗，改用預設值", exc_info=True)
        value, version, ttl = dict(DEFAULTS), 0, 5
    with _lock:
        # 讀資料庫期間若有人儲存（invalidate 會加一代），這份結果可能是舊的：只回傳、不寫回快取，下次重讀
        if _cache["gen"] == gen:
            _cache.update(until=now + ttl, value=value, version=version)
    return value, version


def invalidate() -> None:
    with _lock:
        _cache.update(until=0.0, value=None, version=0, gen=_cache["gen"] + 1)


def save_version(content: dict, *, created_by: str, note: str = "", source: str = "edit"):
    """驗證後新增一個版本並立刻生效（這個 process）。回傳新版本的資料列。"""
    from adminapi.models import AiAssistantSettingsVersion

    clean = validate(content)
    note = _text(note or "", "備註", NOTE_MAX, required=False)
    row = AiAssistantSettingsVersion.objects.create(content=clean, created_by=created_by[:128], note=note, source=source)
    invalidate()
    return row
