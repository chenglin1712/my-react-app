"""AI 全站月預算（路線圖 #5）：用量達 80% 提醒管理者，達 100% 自動關閉 AI 助手。

預算金額來自環境變數 AI_MONTHLY_BUDGET_USD（美金）；沒設定或不是正數就是「不設預算」，什麼都不做。
後台直接編輯預算留待路線圖 #35（模型與設定的後台頁）。

已花費是用量表裡本月（台灣時間）的 token 乘上價目表的【估算】（見 ai_usage.MODEL_PRICES_PER_MTOK），不是帳單：
價目表沒有的模型改用表中最貴的單價保守估算並標示 incomplete（寧可早關，不可漏算），實際金額以 Anthropic Console 為準。所以預算要留緩衝，
並且在 Anthropic Console 另外設定自己的支出上限，這裡只是第二道防線。

兩個動作：
- 80%：寫一筆錯誤等級的 log（有接 Sentry 的環境會變成告警），每個月只寫一次；後台「AI 用量」頁一直顯示提醒。
- 100%：把 FeatureFlag ai_assistant_enabled 關掉並寫一筆稽核紀錄（action=ai_budget_auto_disable）。
  【每個月只自動關一次】：管理者之後手動重新開啟，就是接受繼續超出（或已調高預算），不會下一個請求又被關掉。
  翻譯（translation_enabled）不會被這裡關閉，但它的花費也計入總額。

評估結果快取 60 秒，避免每個請求都彙總一次用量表；剛超過預算的那段時間（最長約 60 秒）內仍有請求通過，
所以這不是精確的硬上限，超出的金額上界約是「60 秒內的最大流量 × 單次費用」，預算要預留這個緩衝。
"""
import logging
import os
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.core.cache import cache
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from .ai_usage import BREAKER_FEATURE, MODEL_PRICES_PER_MTOK, estimate_cost_usd
from .models import AiUsageLog, AuditLog, FeatureFlag

logger = logging.getLogger(__name__)

WARN_RATIO = 0.8
FLAG_KEY = "ai_assistant_enabled"
AUDIT_ACTION = "ai_budget_auto_disable"
_CACHE_KEY = "adminapi:ai_budget:evaluation"
_CACHE_SECONDS = 60
_WARNED_KEY = "adminapi:ai_budget:warned:"


_invalid_budget_reported: set[str] = set()


def monthly_budget_usd() -> float | None:
    """空字串＝刻意不設預算；有填但不是正數（拼錯、負值、inf、nan）要大聲說，不能和「不設」看起來一樣。"""
    raw = os.getenv("AI_MONTHLY_BUDGET_USD", "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        value = float("nan")
    if value > 0 and value != float("inf"):
        return value
    if raw not in _invalid_budget_reported:
        _invalid_budget_reported.add(raw)
        logger.error("[AIBudget] 環境變數 AI_MONTHLY_BUDGET_USD=%r 不是正數，月預算保護沒有啟用", raw)
    return None


# 台灣沒有日光節約時間，固定 +8；與每日額度（AIModel/quota.py）相同作法，不依賴部署端的 TIME_ZONE 設定。
_TAIPEI = dt_timezone(timedelta(hours=8))


def month_start(now=None):
    """本月 1 日 00:00（台灣時間）。"""
    today = (now or timezone.now()).astimezone(_TAIPEI).date()
    return datetime.combine(today.replace(day=1), time.min, tzinfo=_TAIPEI)


def month_to_date_cost(now=None) -> tuple[float, bool]:
    """(本月估算花費美金, 是否不完整)。不完整＝有用量但價目表沒有那個模型，實際花費比這個數字高。"""
    rows = (
        AiUsageLog.objects.filter(created_at__gte=month_start(now)).exclude(feature=BREAKER_FEATURE)
        .values("model")
        .annotate(i=Sum("input_tokens"), o=Sum("output_tokens"), r=Sum("cache_read_tokens"), w=Sum("cache_write_tokens"))
    )
    total, incomplete = 0.0, False
    for row in rows:
        i, o, r, w = (row[k] or 0 for k in ("i", "o", "r", "w"))
        cost = estimate_cost_usd(row["model"], i, o, r, w)
        if cost is None:
            if i or o or r or w:
                incomplete = True
                total += _worst_case_cost(i, o, r, w)
        else:
            total += cost
    return total, incomplete


def _worst_case_cost(i: int, o: int, r: int, w: int) -> float:
    """價目表沒有的模型：用表中最貴的輸入價與輸出價估算，高估比漏算安全（漏算會讓預算保護失效）。"""
    from .ai_usage import CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER

    in_price = max(p[0] for p in MODEL_PRICES_PER_MTOK.values())
    out_price = max(p[1] for p in MODEL_PRICES_PER_MTOK.values())
    return (i * in_price + r * in_price * CACHE_READ_MULTIPLIER + w * in_price * CACHE_WRITE_MULTIPLIER + o * out_price) / 1_000_000


def level_for(ratio: float) -> str:
    if ratio >= 1:
        return "exceeded"
    return "warning" if ratio >= WARN_RATIO else "ok"


def evaluate(use_cache: bool = True) -> dict:
    """目前預算狀態：{budgetUsd, spentUsd, ratio, level, incomplete}。沒設預算時 level 是 "none"。"""
    budget = monthly_budget_usd()
    if budget is None:
        return {"budgetUsd": None, "spentUsd": None, "ratio": None, "level": "none", "incomplete": False}
    if use_cache:
        cached = cache.get(_CACHE_KEY)
        # 預算金額被改過就不能沿用舊的評估
        if cached is not None and cached["budgetUsd"] == budget:
            return cached
    spent, incomplete = month_to_date_cost()
    ratio = spent / budget
    result = {
        "budgetUsd": budget, "spentUsd": round(spent, 4), "ratio": round(ratio, 4),
        "level": level_for(ratio), "incomplete": incomplete,
    }
    cache.set(_CACHE_KEY, result, _CACHE_SECONDS)
    return result


def _already_disabled_this_month() -> bool:
    return AuditLog.objects.filter(action=AUDIT_ACTION, created_at__gte=month_start()).exists()


def enforce() -> dict:
    """評估並執行動作，回傳評估結果。任何失敗都只記錄、不丟例外：預算檢查壞了不能讓學生用不了助手。"""
    try:
        status = evaluate()
        if status["level"] == "warning" or status["level"] == "exceeded":
            _warn_once(status)
        if status["level"] == "exceeded":
            _disable_assistant(status)
        return status
    except Exception:
        logger.error("[AIBudget] 預算檢查失敗，這次略過", exc_info=True)
        return {"budgetUsd": None, "spentUsd": None, "ratio": None, "level": "none", "incomplete": False}


def _warn_once(status: dict) -> None:
    marker = f"{_WARNED_KEY}{month_start():%Y-%m}:{status['level']}"
    if cache.add(marker, 1, 40 * 24 * 3600):
        logger.error(
            "[AIBudget] AI 月預算已用 %.0f%%（估算 $%.2f / 預算 $%.2f）",
            status["ratio"] * 100, status["spentUsd"], status["budgetUsd"],
        )


def _disable_assistant(status: dict) -> None:
    flag = FeatureFlag.objects.filter(key=FLAG_KEY).first()
    if flag is None:
        # 旗標紀錄不存在（尚未跑 seed_feature_flags）時，助手本來就沒有開關可關；明講，不要假裝已經關了
        logger.error("[AIBudget] 月預算已超過，但找不到旗標 %s，無法自動關閉（請執行 seed_feature_flags）", FLAG_KEY)
        return
    if not flag.enabled:
        # 管理者已經自己關了：不必動作，也不寫稽核——「每月自動關一次」的名額留給之後真的需要關的時候。
        # 先看旗標再查稽核，關閉後被擋下的每個請求只需要這一次查詢。
        return
    if _already_disabled_this_month():
        return
    with transaction.atomic():
        # 條件式 UPDATE：多個 worker 同時超標時只有一個能把 enabled 由 True 改成 False，只有它寫稽核，
        # 旗標與稽核在同一個交易，不會出現「已關閉卻沒有紀錄」。
        changed = FeatureFlag.objects.filter(key=FLAG_KEY, enabled=True).update(
            enabled=False, updated_by="system:ai_budget", updated_at=timezone.now(),
        )
        if not changed:
            return
        AuditLog.objects.create(
            actor_uid="system", actor_role=None, action=AUDIT_ACTION, target_type="feature_flag", target_id=FLAG_KEY,
            before={"enabled": True},
            after={"enabled": False, "budgetUsd": status["budgetUsd"], "spentUsd": status["spentUsd"]},
        )
    logger.critical(
        "[AIBudget] AI 月預算已超過（估算 $%.2f / 預算 $%.2f），已自動關閉 AI 助手；需管理者在「功能開關」手動重新開啟",
        status["spentUsd"], status["budgetUsd"],
    )
