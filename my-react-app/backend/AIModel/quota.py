"""AI 助手每人每日提問額度（路線圖 #5）。

額度的單位是「一次提問」（一次送出訊息，不論背後呼叫了幾次模型、查了幾次辭典），
依台灣時間午夜重置，次數存在資料庫（adminapi.AiDailyUsage），見該模型的說明。

額度數字沿用後台「限流規則」頁：key 是 ai_daily_quota，值寫成 "100/d"（每天 100 次）。
管理者在那一頁改數字最慢 30 秒內生效（adminapi/rate_limits.py 的快取）。起始值刻意寬鬆，
看一週的用量（後台「AI 用量」頁的前 10 名使用者）再調。

失敗的方向：資料庫存取出錯（例如 migration 還沒跑）時【放行】並記錄錯誤，因為這一關擋的是
「使用過量」，不是安全邊界；擋錯了會讓所有學生都不能用。真正的費用保護是月預算（adminapi/ai_budget.py）。
"""
import logging
import random
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from django.db import IntegrityError, transaction
from django.db.models import F

from adminapi.rate_limits import get_configured_rate

logger = logging.getLogger(__name__)

QUOTA_RULE_KEY = "ai_daily_quota"
DEFAULT_DAILY_RATE = "100/d"
DEFAULT_DAILY_LIMIT = 100
RETENTION_DAYS = 3
_PURGE_PROBABILITY = 0.01

# 台灣沒有日光節約時間，固定 +8；與 fastAPI/guest_trial.py 相同作法，不依賴 tzdata。
_TAIPEI = timezone(timedelta(hours=8))
_RATE_RE = re.compile(r"^\s*(\d+)\s*/\s*(d|day)\s*$")


@dataclass
class Quota:
    allowed: bool
    limit: int
    remaining: int
    resets_at: str
    day: date | None = None
    tracked: bool = True       # False：計數失敗而放行，剩餘次數不可信，不顯示給學生

    def retry_after_seconds(self, now: datetime | None = None) -> int:
        """距離重置還有幾秒（Retry-After 標頭用），至少 1。"""
        delta = datetime.fromisoformat(self.resets_at) - (now or datetime.now(timezone.utc))
        return max(int(delta.total_seconds()), 1)

    def as_dict(self) -> dict:
        return {"limit": self.limit, "remaining": self.remaining, "resetsAt": self.resets_at, "tracked": self.tracked}


def taipei_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(_TAIPEI).date()


def next_reset_at(today: date) -> str:
    """下一個台灣午夜（ISO 8601，含 +08:00），給前端顯示「幾點重置」。"""
    midnight = datetime(today.year, today.month, today.day, tzinfo=_TAIPEI) + timedelta(days=1)
    return midnight.isoformat()


def daily_limit() -> int:
    """目前生效的每日上限。規則表裡的值不是「N/d」格式（例如被改成 "5/m"）就退回預設，並記錄。"""
    rate = get_configured_rate(QUOTA_RULE_KEY, DEFAULT_DAILY_RATE)
    match = _RATE_RE.match(rate or "")
    if not match:
        logger.error("[AIModel] 限流規則 %s 的值 %r 不是「N/d」格式，改用預設 %d", QUOTA_RULE_KEY, rate, DEFAULT_DAILY_LIMIT)
        return DEFAULT_DAILY_LIMIT
    return int(match.group(1))


def _model():
    from adminapi.models import AiDailyUsage

    return AiDailyUsage


def _unlimited_when_broken(limit: int, today: date) -> Quota:
    return Quota(allowed=True, limit=limit, remaining=limit, resets_at=next_reset_at(today), day=today, tracked=False)


def peek(uid: str, now: datetime | None = None) -> Quota:
    """只讀取，不扣次數（前端顯示「今天還可以問 N 次」用）。"""
    today, limit = taipei_today(now), daily_limit()
    try:
        used = _model().objects.filter(day=today, uid=uid).values_list("count", flat=True).first() or 0
    except Exception:
        logger.error("[AIModel] 讀取每日額度失敗，視為未計數", exc_info=True)
        return _unlimited_when_broken(limit, today)
    remaining = max(limit - used, 0)
    return Quota(allowed=remaining > 0, limit=limit, remaining=remaining, resets_at=next_reset_at(today), day=today)


def consume(uid: str, now: datetime | None = None) -> Quota:
    """原子地扣一次。已達上限時不扣，allowed=False。

    判斷與遞增在同一個 UPDATE 完成（count < limit 才加一），兩個同時送出的請求不會雙雙放行。
    今天第一次提問時這一列還不存在：先嘗試建立（INSERT），撞到唯一限制代表別的請求剛建立，再 UPDATE 一次。"""
    today, limit = taipei_today(now), daily_limit()
    try:
        Usage = _model()
        bumped =Usage.objects.filter(day=today, uid=uid, count__lt=limit).update(count=F("count") + 1)
        if not bumped:
            if limit <= 0:
                return Quota(allowed=False, limit=limit, remaining=0, resets_at=next_reset_at(today), day=today)
            try:
                with transaction.atomic():
                    Usage.objects.create(day=today, uid=uid, count=1)
                bumped = 1
            except IntegrityError:
                bumped = Usage.objects.filter(day=today, uid=uid, count__lt=limit).update(count=F("count") + 1)
        used = Usage.objects.filter(day=today, uid=uid).values_list("count", flat=True).first() or 0
        if random.random() < _PURGE_PROBABILITY:
            Usage.objects.filter(day__lt=today - timedelta(days=RETENTION_DAYS)).delete()
    except Exception:
        logger.error("[AIModel] 每日額度計數失敗，這次放行", exc_info=True)
        return _unlimited_when_broken(limit, today)
    remaining = max(limit - used, 0)
    return Quota(allowed=bool(bumped), limit=limit, remaining=remaining, resets_at=next_reset_at(today), day=today)


def refund(uid: str, day: date | None) -> None:
    """請求在呼叫模型之前或過程中失敗（不是學生的錯）時退還這一次。盡力而為，失敗只記錄。"""
    if day is None:
        return
    try:
        _model().objects.filter(day=day, uid=uid, count__gt=0).update(count=F("count") - 1)
    except Exception:
        logger.error("[AIModel] 退還每日額度失敗", exc_info=True)
