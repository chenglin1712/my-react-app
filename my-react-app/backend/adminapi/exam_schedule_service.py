"""給 crawler app 讀寫「考試時程」相關 adminapi 資料用的 domain service，
不暴露 ExamScheduleCrawlStatus／ExamScheduleOverride 這兩個 model 本身
（P4 review BE-8）。

跟 quizbank_service.py 的唯讀 DTO 不同，crawl status 這部分本質上是寫入
操作（記錄這次爬蟲執行成功/失敗），不是「查資料轉 DTO」就能滿足的形狀，
所以這裡改成暴露「記一次成功／記一次失敗」這兩個動作本身，呼叫端不需要
拿到 model instance、更不需要知道 load()／get_or_create(pk=1) 這套單例
慣例。

override 部分維持唯讀 DTO（跟 quizbank_service 同款），因為 crawler 只是
把它疊加進爬蟲抓到的資料，不需要寫入。
"""
from dataclasses import dataclass


def record_crawl_success() -> None:
    from .models import ExamScheduleCrawlStatus

    ExamScheduleCrawlStatus.load().record_success()


def record_crawl_failure(reason: str) -> None:
    from .models import ExamScheduleCrawlStatus

    ExamScheduleCrawlStatus.load().record_failure(reason)


@dataclass(frozen=True)
class ScheduleOverride:
    phase: str
    label: str
    start_date: object  # datetime.date
    end_date: object | None  # datetime.date | None


def get_active_schedule_overrides() -> list[ScheduleOverride]:
    from .models import ExamScheduleOverride

    qs = ExamScheduleOverride.objects.filter(is_active=True)
    return [
        ScheduleOverride(phase=o.phase, label=o.label, start_date=o.start_date, end_date=o.end_date)
        for o in qs
    ]
