"""用真實的呼叫時間，估算提示快取該用 5 分鐘還是 1 小時版本（路線圖 #4 的 TTL 決策）。

資料來源是後台「AI 用量」的 AiUsageLog：把這段期間成功的對話呼叫依時間排好，
依模型分別模擬一份「全站共用」的固定前綴快取（族語、學生的差異都在快取點之後，所以所有人共用同一份）：

  - 距離上一次呼叫不超過 TTL → 讀取（約 0.1 倍）並把計時重設；
  - 否則 → 重新寫入（5 分鐘版 1.25 倍、1 小時版 2 倍）。

結果是固定前綴那部分的相對費用，和「完全不快取」（每次 1 倍）比較，不含變動內容與輸出。
這是模擬，不是帳單：它假設快取一定生效（固定前綴有達到最小長度，先用 check_prompt_cache 確認）、
只有一份前綴、時間用紀錄寫入的時刻（約等於呼叫結束時）。

  python manage.py analyze_cache_ttl            # 最近 30 天的對話呼叫
  python manage.py analyze_cache_ttl --days 7 --feature chat
"""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from adminapi.models import AiUsageLog

READ_COST = 0.1
WRITE_COST = {"5m": 1.25, "1h": 2.0}
TTL_SECONDS = {"5m": 300, "1h": 3600}
MIN_CALLS = 30           # 少於這個數字不下結論


def simulate_ttl(timestamps, ttl_seconds: float, write_cost: float) -> dict:
    """timestamps：已排序的 datetime 清單。回傳 {calls, writes, reads, cost}，cost 以「前綴每次全價 = 1」計。"""
    writes = reads = 0
    last = None
    for moment in timestamps:
        if last is not None and (moment - last).total_seconds() <= ttl_seconds:
            reads += 1
        else:
            writes += 1
        last = moment          # 命中會重設計時；沒命中則是新寫入，同樣從這一刻重新計時
    calls = writes + reads
    return {"calls": calls, "writes": writes, "reads": reads, "cost": writes * write_cost + reads * READ_COST}


BOUNDARY_MARGIN_SECONDS = 30


def near_boundary_count(timestamps, ttl_seconds: float, margin: float = BOUNDARY_MARGIN_SECONDS) -> int:
    """相鄰兩次呼叫的間隔離 TTL 門檻不到 margin 秒的次數：這些判定最容易被時間估計的誤差翻轉。"""
    return sum(
        1 for earlier, later in zip(timestamps, timestamps[1:])
        if abs((later - earlier).total_seconds() - ttl_seconds) <= margin
    )


def recommend(plain: dict, five: dict, hour: dict) -> str:
    best = min(("不快取", plain["cost"]), ("5 分鐘版", five["cost"]), ("1 小時版", hour["cost"]), key=lambda x: x[1])
    return best[0]


class Command(BaseCommand):
    help = "依真實呼叫時間估算提示快取的 TTL（5 分鐘或 1 小時）該選哪個"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30, help="往前看幾天（1~90，預設 30）")
        parser.add_argument("--feature", default="chat", help="哪個功能的呼叫（預設 chat）")

    def handle(self, *args, days, feature, **options):
        if not 1 <= days <= 90:
            raise CommandError("--days 必須在 1~90 之間")
        since = timezone.now() - timedelta(days=days)
        rows = list(
            AiUsageLog.objects.filter(feature=feature, status="ok", created_at__gte=since)
            .order_by("created_at").values_list("created_at", "latency_ms", "model")
        )
        self.stdout.write(f"最近 {days} 天、功能 {feature} 的成功呼叫：{len(rows)} 次（每一次模型呼叫都算，含工具迴圈的每一輪）")
        self.stdout.write(
            f"採用倍率：讀取 {READ_COST} 倍、5 分鐘寫入 {WRITE_COST['5m']} 倍、1 小時寫入 {WRITE_COST['1h']} 倍"
            "（一般提示快取計價；目前模型的實際倍率請以 Anthropic 官方價目與帳單確認）"
        )

        # 不同模型的快取互不相通，不能串成同一條時間序列
        by_model = {}
        for created_at, latency_ms, model in rows:
            by_model.setdefault(model, []).append(created_at - timedelta(milliseconds=latency_ms))   # 估計的請求開始時間
        recommended = []
        for model, started in sorted(by_model.items()):
            started.sort()
            self.stdout.write(f"\n模型 {model}：{len(started)} 次")
            if len(started) < MIN_CALLS:
                self.stdout.write(self.style.WARNING(
                    f"樣本少於 {MIN_CALLS} 次，不下結論。等上線累積一些真實流量後再跑一次。"
                ))
                continue
            plain = {"calls": len(started), "writes": 0, "reads": 0, "cost": float(len(started))}
            five = simulate_ttl(started, TTL_SECONDS["5m"], WRITE_COST["5m"])
            hour = simulate_ttl(started, TTL_SECONDS["1h"], WRITE_COST["1h"])
            for label, result in (("不快取", plain), ("5 分鐘版", five), ("1 小時版", hour)):
                share = result["cost"] / plain["cost"]
                self.stdout.write(
                    f"  {label}：寫入 {result['writes']} 次、讀取 {result['reads']} 次，"
                    f"固定前綴相對費用 {result['cost']:.1f}（不快取的 {share:.0%}）"
                )
            near = near_boundary_count(started, TTL_SECONDS["5m"])
            self.stdout.write(f"  敏感度：{near} 次呼叫的間隔落在 5 分鐘門檻前後 {BOUNDARY_MARGIN_SECONDS} 秒內，估計時間的誤差可能改變它們的判定")
            best = recommend(plain, five, hour)
            recommended.append(best)
            self.stdout.write(self.style.SUCCESS(f"  依這段期間的流量，固定前綴最省的是：{best}"))

        if recommended:
            self.stdout.write(
                "\n這是樂觀的模擬，不是帳單：假設固定前綴一定達到最小長度而生效、同一個模型只有一份前綴、"
                "請求依序處理（忽略多個 worker 同時快取未命中）、每次的前綴大小相同；請求開始時間用「記錄時間減延遲」估計。"
                "結果相近時請以後台「AI 用量」頁的實際命中率與帳單為準。"
            )
