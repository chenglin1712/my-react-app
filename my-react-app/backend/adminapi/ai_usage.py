"""AI 用量紀錄：寫入端（Django process 的 LLM 呼叫）與後台「AI 用量」頁的彙總查詢。

config/llm.py 同時被 Django 與 FastAPI import，不能直接依賴任何一邊的資料庫存取，
所以用 set_usage_recorder 掛鉤反轉依賴：Django 啟動時（AdminapiConfig.ready）把
這裡的 record_ai_usage 註冊進去；FastAPI 端另有自己的寫入端（fastAPI/ai_usage_events.py）。

費用是依下方價目表**估算**，不是帳單：價格會調整、批次與優先層級有不同費率、
超長輸入有加價，實際金額以 Anthropic Console 為準。
"""
import logging
from collections import defaultdict
from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from .models import AiUsageLog

logger = logging.getLogger(__name__)

# 每百萬 token 的美金價格 (輸入, 輸出)。快取讀取以輸入價的 0.1 倍、快取寫入（預設 5 分鐘）
# 以 1.25 倍估算。價格來源：Anthropic 官方價目（2026-10 時的數字），調整時改這裡。
MODEL_PRICES_PER_MTOK = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-fable-5": (10.00, 50.00),
    "claude-fable-5-1": (10.00, 50.00),
}
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25

MAX_DAYS = 90
# 百分位數只取最近這麼多筆成功呼叫的延遲，避免大範圍查詢把整張表讀進記憶體。
_LATENCY_SAMPLE_LIMIT = 20000
_TOP_USERS = 10


def record_ai_usage(entry: dict) -> None:
    """config.llm 註冊的寫入端：把一次呼叫的用量寫成一筆 AiUsageLog。
    欄位名稱見 config/llm.py 的 _record_usage；token 缺值（失敗的呼叫）存 0。"""
    # savepoint：寫入失敗只會回滾這一筆，不會讓呼叫端所在的交易（例如測試或
    # ATOMIC_REQUESTS）整個進入「已中斷」狀態，連帶讓後面的查詢全部失敗。
    with transaction.atomic():
        AiUsageLog.objects.create(
            feature=entry["feature"][:20],
            uid=(entry.get("uid") or "")[:128],
            model=(entry.get("model") or "")[:80],
            status=entry["status"][:20],
            request_id=(entry.get("request_id") or "")[:80],
            input_tokens=entry.get("input_tokens") or 0,
            output_tokens=entry.get("output_tokens") or 0,
            cache_read_tokens=entry.get("cache_read_tokens") or 0,
            cache_write_tokens=entry.get("cache_write_tokens") or 0,
            latency_ms=entry.get("latency_ms") or 0,
        )


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int,
                      cache_read_tokens: int = 0, cache_write_tokens: int = 0):
    """估算一組 token 的費用（美金）。不認得的模型回傳 None，呼叫端要把它標示為「價格未知」，
    不能當成 0 元加總。"""
    prices = MODEL_PRICES_PER_MTOK.get(model)
    if prices is None:
        return None
    in_price, out_price = prices
    return (
        input_tokens * in_price
        + cache_read_tokens * in_price * CACHE_READ_MULTIPLIER
        + cache_write_tokens * in_price * CACHE_WRITE_MULTIPLIER
        + output_tokens * out_price
    ) / 1_000_000


def _percentile(sorted_values, p):
    if not sorted_values:
        return None
    index = max(0, min(len(sorted_values) - 1, int(round(p * (len(sorted_values) - 1)))))
    return sorted_values[index]


class _Bucket:
    """一組分組的累計值（日、功能、模型、使用者共用）。"""
    __slots__ = ("calls", "errors", "input", "output", "cache_read", "cache_write", "cost", "unpriced")

    def __init__(self):
        self.calls = self.errors = 0
        self.input = self.output = self.cache_read = self.cache_write = 0
        self.cost = 0.0
        self.unpriced = False

    def add(self, row):
        self.calls += row["calls"]
        if row["status"] != "ok":
            self.errors += row["calls"]
        self.input += row["input"]
        self.output += row["output"]
        self.cache_read += row["cache_read"]
        self.cache_write += row["cache_write"]
        cost = estimate_cost_usd(row["model"], row["input"], row["output"], row["cache_read"], row["cache_write"])
        if cost is None:
            if row["input"] or row["output"] or row["cache_read"] or row["cache_write"]:
                self.unpriced = True
        else:
            self.cost += cost

    def as_dict(self, **extra):
        return {
            **extra,
            "calls": self.calls,
            "errors": self.errors,
            "inputTokens": self.input,
            "outputTokens": self.output,
            "cacheReadTokens": self.cache_read,
            "cacheWriteTokens": self.cache_write,
            "costUsd": round(self.cost, 4),
            "costIncomplete": self.unpriced,
        }


def summarize(days: int) -> dict:
    """彙總最近 days 天的用量（含今天）。days 超出 1~MAX_DAYS 時夾回範圍。"""
    days = max(1, min(int(days), MAX_DAYS))
    now = timezone.now()
    # 起點與「依日」分組都用 Django 目前時區（台灣）的午夜，否則當日 00:00~08:00 的資料會被漏掉。
    tz = timezone.get_current_timezone()
    today = timezone.localdate(now, tz)
    since = timezone.make_aware(datetime.combine(today - timedelta(days=days - 1), time.min), tz)
    logs = AiUsageLog.objects.filter(created_at__gte=since)

    rows = (
        logs.annotate(day=TruncDate("created_at", tzinfo=tz))
        .values("day", "feature", "model", "status", "uid")
        .annotate(
            calls=Count("id"),
            input=Sum("input_tokens"), output=Sum("output_tokens"),
            cache_read=Sum("cache_read_tokens"), cache_write=Sum("cache_write_tokens"),
        )
    )

    total = _Bucket()
    by_day, by_feature, by_model, by_user = defaultdict(_Bucket), defaultdict(_Bucket), defaultdict(_Bucket), defaultdict(_Bucket)
    by_status = defaultdict(int)
    for r in rows:
        row = {
            "calls": r["calls"], "status": r["status"], "model": r["model"],
            "input": r["input"] or 0, "output": r["output"] or 0,
            "cache_read": r["cache_read"] or 0, "cache_write": r["cache_write"] or 0,
        }
        total.add(row)
        by_day[r["day"]].add(row)
        by_feature[r["feature"]].add(row)
        by_model[r["model"]].add(row)
        by_user[r["uid"]].add(row)
        by_status[r["status"]] += r["calls"]

    latencies = sorted(
        logs.filter(status="ok").order_by("-created_at").values_list("latency_ms", flat=True)[:_LATENCY_SAMPLE_LIMIT]
    )

    # 快取命中率 = 從快取讀到的輸入 token ÷ 全部輸入 token（一般輸入 + 快取讀 + 快取寫）。
    all_input = total.input + total.cache_read + total.cache_write
    cache_hit_rate = round(total.cache_read / all_input, 4) if all_input else None

    # 補齊沒有任何呼叫的日子，圖表的橫軸才會連續。
    daily = []
    for offset in range(days):
        day = today - timedelta(days=days - 1 - offset)
        bucket = by_day.get(day)
        daily.append((bucket or _Bucket()).as_dict(date=day.isoformat()))

    top_users = sorted(by_user.items(), key=lambda kv: (-kv[1].calls, kv[0]))[:_TOP_USERS]

    return {
        "days": days,
        "since": since.isoformat(),
        "totals": {
            **total.as_dict(),
            "cacheHitRate": cache_hit_rate,
            "latencyP50Ms": _percentile(latencies, 0.50),
            "latencyP95Ms": _percentile(latencies, 0.95),
            "latencySampleSize": len(latencies),
        },
        "daily": daily,
        "byFeature": [b.as_dict(feature=k) for k, b in sorted(by_feature.items(), key=lambda kv: -kv[1].cost)],
        "byModel": [b.as_dict(model=k) for k, b in sorted(by_model.items(), key=lambda kv: -kv[1].cost)],
        "byStatus": [{"status": k, "calls": v} for k, v in sorted(by_status.items(), key=lambda kv: -kv[1])],
        "topUsers": [b.as_dict(uid=k or "（訪客）") for k, b in top_users],
        "priceNote": "費用依公開價目估算（快取讀取 0.1 倍、快取寫入 1.25 倍），實際金額以 Anthropic Console 為準。",
    }
