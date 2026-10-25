"""產生每週個人學習摘要（路線圖 #25）。建議每晚用 cron 跑一次：

  python manage.py generate_weekly_digests               # 正式：提交 Batch、等結果、寫入 Firestore
  python manage.py generate_weekly_digests --dry-run     # 只算有幾位學生有活動，不呼叫 API、不寫入

只有最近 7 天有作答的學生會進批次；同一週已經產生過的學生會略過，所以每晚重跑不會重複花錢。
整個流程在一次執行內完成：等不到 Batch 結束（--wait-minutes）就取消它、只取回已經完成的，其餘用固定樣板，
沒有跨次執行的狀態。同一週同時只會有一個執行（租約文件 aiDigestJobs/{週}），重疊的 cron 會直接略過。
需要功能旗標 ai_weekly_digest_enabled 開啟（預設關閉）。使用 Message Batches API（約五折、非即時）；
單一學生失敗、被拒答或摘要不合格，只會讓那位學生改用固定樣板，不影響其他人。
"""
import json
import logging
import time
from datetime import datetime, timedelta, timezone

from django.core.management.base import BaseCommand, CommandError

from AIModel import weekly_digest as wd

logger = logging.getLogger(__name__)

DIGEST_FLAG = "ai_weekly_digest_enabled"
POLL_SECONDS = 30
RETRIEVE_ATTEMPTS = 3                 # 讀 Batch 狀態遇到暫時性錯誤（逾時、429）時的嘗試次數
RETRIEVE_BACKOFF_SECONDS = (2, 5)     # 兩次嘗試之間的等待


def digest_enabled() -> bool:
    from adminapi.models import FeatureFlag

    flag = FeatureFlag.objects.filter(key=DIGEST_FLAG).first()
    return bool(flag is not None and flag.enabled)


def budget_exceeded() -> bool:
    try:
        from adminapi import ai_budget

        return ai_budget.evaluate()["level"] == "exceeded"
    except Exception:  # 這是會花錢的排程：預算檢查壞了就不跑（學生看不到週報不是大事，超支才是）
        logger.error("[digest] 預算檢查失敗，這次不執行", exc_info=True)
        return True


def plan_students(db, now: datetime, max_users: int, max_scan: int = wd.DEFAULT_MAX_SCAN) -> list:
    """回傳 [(uid, stats, words)]：本週有活動、而且這一週還沒產生過摘要的學生。單一學生讀取失敗只略過那位。"""
    this_week = wd.week_id(now)
    activity = wd.collect_week_activity(db, now - timedelta(days=wd.WINDOW_DAYS), until=now, max_scan=max_scan)
    planned = []
    # 超過 max_users 時留給下一次：用「依週編號打散」的順序，每週輪到的人不同，不會固定餓死排在後面的 uid
    for uid, stats in sorted(activity.items(), key=lambda item: wd.custom_id_for(f"{this_week}:{item[0]}")):
        if len(planned) >= max_users:
            logger.warning("[digest] 有活動的學生超過上限 %s，其餘留到下一次", max_users)
            break
        try:
            if wd.already_generated(db, uid, this_week):
                continue
            planned.append((uid, stats, wd.review_words(wd.read_user_doc(db, uid))))
        except Exception:
            logger.warning("[digest] 讀取學生資料失敗，略過這位學生", exc_info=True)
    return planned


def parse_summary(message) -> str | None:
    text = next((block.text for block in message.content if getattr(block, "type", "") == "text"), "")
    try:
        value = json.loads(text)
    except (TypeError, ValueError):
        return None
    return value.get("summary") if isinstance(value, dict) else None


def fetch_summaries(client, batch_id: str, planned: list) -> dict:
    """{uid: 合格的摘要}。沒有結果、失敗、過期、取消、拒答、摘要不合格的學生都不在裡面（呼叫端改用樣板）。"""
    from config.llm import _record_usage
    from config.llm_settings import get_settings

    by_custom_id = {wd.custom_id_for(uid): (uid, stats, words) for uid, stats, words in planned}
    model = get_settings(wd.DIGEST_FEATURE).model
    summaries = {}
    for entry in client.messages.batches.results(batch_id):
        known = by_custom_id.get(entry.custom_id)
        if known is None:
            continue
        uid, stats, words = known
        if entry.result.type != "succeeded":
            # 失敗、過期、取消的請求沒有 token 數，仍留一筆紀錄，後台才看得出這一批有多少請求沒成功
            status = {"expired": "expired", "canceled": "cancelled"}.get(entry.result.type, "error")
            _record_usage(feature=wd.DIGEST_FEATURE, uid=uid, model=model, started=time.monotonic(), status=status)
            continue
        message = entry.result.message
        refused = getattr(message, "stop_reason", None) == "refusal"
        _record_usage(feature=wd.DIGEST_FEATURE, uid=uid, model=model, started=time.monotonic(),
                      status="refusal" if refused else "ok", response=message)
        if refused:
            continue
        summary = wd.accept_summary(parse_summary(message), stats, words)
        if summary:
            summaries[uid] = summary
    return summaries


def retrieve_with_retry(client, batch_id: str):
    """讀 Batch 狀態；暫時性錯誤重試幾次，用盡回傳 None（呼叫端決定怎麼收尾）。"""
    for attempt in range(RETRIEVE_ATTEMPTS):
        try:
            return client.messages.batches.retrieve(batch_id)
        except Exception:
            logger.warning("[digest] 讀取 Batch 狀態失敗（%s/%s）", attempt + 1, RETRIEVE_ATTEMPTS, exc_info=True)
            if attempt + 1 < RETRIEVE_ATTEMPTS:
                time.sleep(RETRIEVE_BACKOFF_SECONDS[min(attempt, len(RETRIEVE_BACKOFF_SECONDS) - 1)])
    return None


def cancel_quietly(client, batch_id: str) -> None:
    try:
        client.messages.batches.cancel(batch_id)
    except Exception:
        logger.warning("[digest] 取消 Batch 失敗", exc_info=True)


def submit_and_wait(client, planned: list, wait_minutes: int, out) -> str | None:
    """提交 Batch 並等到結束；等太久就取消（已完成的請求仍取得到結果）。回傳 batch_id，提交失敗回傳 None。
    狀態一直讀不到（重試用盡）也回傳 None 並取消 Batch：遠端不能繼續花錢，學生改用固定樣板。"""
    requests = [wd.build_batch_request(uid, stats, words) for uid, stats, words in planned]
    try:
        batch = client.messages.batches.create(requests=requests)
    except Exception:
        logger.error("[digest] 提交 Batch 失敗，這次全部改用固定樣板", exc_info=True)
        return None
    out.write(f"已提交 Batch {batch.id}（{len(requests)} 位學生），最多等 {wait_minutes} 分鐘")
    batch_id = batch.id
    deadline = time.monotonic() + wait_minutes * 60
    while time.monotonic() < deadline:
        status = retrieve_with_retry(client, batch_id)
        if status is None:
            out.write(f"無法讀取 Batch {batch_id} 的狀態，取消並全部改用固定樣板")
            cancel_quietly(client, batch_id)
            return None
        if status.processing_status == "ended":
            return batch_id
        time.sleep(POLL_SECONDS)
    out.write(f"Batch {batch_id} 等太久，取消並只取回已完成的部分")
    cancel_quietly(client, batch_id)
    for _ in range(20):                           # 取消通常很快結束；最多再等約 10 分鐘
        status = retrieve_with_retry(client, batch_id)
        if status is None or status.processing_status == "ended":
            break
        time.sleep(POLL_SECONDS)
    return batch_id


def write_all(db, planned: list, summaries: dict, now: datetime) -> dict:
    counts = {"model": 0, "template": 0, "failed": 0, "skipped": 0}
    for uid, stats, words in planned:
        summary = summaries.get(uid)
        source = "model" if summary else "template"
        document = wd.digest_document(
            summary=summary or wd.template_summary(stats, words), source=source, stats=stats, words=words, now=now,
        )
        try:
            if wd.write_digest(db, uid, document):
                counts[source] += 1
            else:
                counts["skipped"] += 1
        except Exception:
            logger.error("[digest] 寫入摘要失敗（只影響這位學生）", exc_info=True)
            counts["failed"] += 1
    return counts


class Command(BaseCommand):
    help = "產生每週個人學習摘要（只處理最近 7 天有作答的學生，用 Batch API）"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="只統計，不呼叫 API、不寫入")
        parser.add_argument("--max-users", type=int, default=2000, help="一次最多處理幾位學生（預設 2000）")
        parser.add_argument("--max-scan", type=int, default=wd.DEFAULT_MAX_SCAN,
                            help="最多讀幾筆作答紀錄（預設 200000）；超過就不執行，避免用不完整的統計產生摘要")
        parser.add_argument("--wait-minutes", type=int, default=120, help="最多等 Batch 幾分鐘（預設 120）")

    def handle(self, *args, **options):
        if options["max_users"] < 1 or options["wait_minutes"] < 1:
            raise CommandError("--max-users 與 --wait-minutes 要大於 0")
        if not options["dry_run"] and not digest_enabled():
            self.stdout.write(f"功能旗標 {DIGEST_FLAG} 未開啟，略過")
            return
        if not options["dry_run"] and budget_exceeded():
            self.stdout.write("本月 AI 預算已用完，略過")
            return

        now = datetime.now(timezone.utc)
        db = wd._client()
        this_week = wd.week_id(now)
        owner = None
        if not options["dry_run"]:
            owner = wd.acquire_lease(db, this_week, now)
            if owner is None:
                self.stdout.write(f"{this_week} 已有另一個執行在跑（或剛跑完），略過")
                return
        try:
            self._run(db, now, options)
        finally:
            if owner is not None:
                try:
                    wd.release_lease(db, this_week, owner, datetime.now(timezone.utc))
                except Exception:
                    logger.warning("[digest] 釋放租約失敗（租期過後會自動失效）", exc_info=True)

    def _run(self, db, now, options):
        try:
            planned = plan_students(db, now, options["max_users"], options["max_scan"])
        except wd.ScanLimitExceeded as exc:
            self.stdout.write(f"{exc}，這次不產生摘要；請調高 --max-scan 後再跑")
            return
        self.stdout.write(f"本週有活動、還沒產生摘要的學生：{len(planned)} 位")
        if options["dry_run"] or not planned:
            return

        from config.llm import get_llm_client

        client = get_llm_client()
        batch_id = submit_and_wait(client, planned, options["wait_minutes"], self.stdout)
        summaries = {}
        if batch_id:
            try:
                summaries = fetch_summaries(client, batch_id, planned)
            except Exception:
                logger.error("[digest] 取回 Batch 結果失敗，全部改用固定樣板", exc_info=True)
        counts = write_all(db, planned, summaries, now)
        self.stdout.write(
            f"完成：模型摘要 {counts['model']}、固定樣板 {counts['template']}、"
            f"本週已有而略過 {counts['skipped']}、寫入失敗 {counts['failed']}"
        )
