"""把 crawler 抓到的活動/族語認證消息，同步匯入成後台可編輯的 Announcement。

獨立成這支檔案（不是塞進 views.py）是因為它需要兩個呼叫端：adminapi/views.py
的手動同步端點，以及 management/commands/sync_crawler_announcements.py（給
之後接排程用，見該檔案說明）——management command 直接 import views.py 裡的
一堆角色檢查/限流/HTTP 相關的東西並不合適，這裡只放不依賴 request 的純邏輯。
"""
import logging
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from crawler.views import get_news_data

from .models import Announcement, AnnouncementSyncStatus

logger = logging.getLogger(__name__)


def _parse_aware_datetime(value):
    """嘗試把外部資料的日期／時間字串解析成 aware datetime，解析不出來
    （格式不明、根本不是日期字串）一律回傳 None——呼叫端必須能接受 None，
    不能假設外部資料格式穩定（tacp 是 JSON API，但沒有文件保證日期格式
    永遠不變）。"""
    if not value or not isinstance(value, str):
        return None
    dt = parse_datetime(value)
    if dt is None:
        d = parse_date(value)
        if d is None:
            return None
        dt = datetime.combine(d, datetime.min.time())
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_default_timezone())
    return dt


def _truncate(value, max_length):
    """截斷過長字串並在尾端加上刪節號提示「這裡被截斷過」，而不是靜默截斷
    看起來像本來就這麼短。政府公告標題常常超過 Announcement.title 的 100
    字上限，SQLite 不會擋（VARCHAR 長度限制在 SQLite 只是參考值），但
    Postgres 正式環境會直接丟 DataError——本機測試發現不了這個問題，
    上線後才會炸，所以在存進去之前就要主動截斷。"""
    value = value or ""
    if len(value) > max_length:
        return value[:max_length - 1] + "…"
    return value


def _format_display_date(start_raw, end_raw):
    """把爬蟲原始的起訖日期字串轉成一行純顯示文字。tacp 給的是機讀日期，
    能解析就統一格式化成 YYYY-MM-DD；族語認證消息給的是網頁上的原始文字
    （可能是民國年中文日期，這裡沒有對應的解析器，也不需要——直接原樣
    顯示就好，不能因為解析不出來就整段捨棄不顯示）。"""
    def _fmt(raw):
        if not raw:
            return None
        dt = _parse_aware_datetime(raw)
        return dt.strftime('%Y-%m-%d') if dt else str(raw)
    start = _fmt(start_raw)
    end = _fmt(end_raw)
    if start and end and end != start:
        return _truncate(f"{start} ~ {end}", 50)
    return _truncate(start or end or '', 50)


def build_announcement_defaults(item):
    """把 crawler 回傳的單筆新聞資料，轉成可以直接餵給
    Announcement.objects.get_or_create(defaults=...) 的欄位字典。純函式、
    不碰資料庫，方便單獨測試。呼叫端（sync_crawler_announcements）已經先
    確認 item 有 title 與 source_key，這裡不重複檢查。

    - category：isExam="T" 對應「考試」，其餘一律「活動」——tacp 自己的
      分類文字種類很多，跟後台目前只有 4 個固定分類對不上，不強行細分；
      原始分類文字改存進 source_tag，只給首頁卡片標籤顏色用（見
      models.py 的欄位說明），不影響 category 判斷。
    - publish_at 固定是「匯入當下」，不是活動本身的起始日——這兩者語意
      不同，活動還沒開始不代表現在不能公告這件事，塞進 publish_at 會讓
      首頁查詢條件（views.py 的 public_announcement_list）在活動開始前
      直接擋住不顯示，本末倒置。活動本身的日期改存進 display_date_text
      純顯示用，不參與任何查詢判斷。
    - unpublish_at 只在 end_date 能解析成功「且」在未來時才設定；已經
      過去的 end_date 存進去，這筆資料一寫進去就已經是「已下架」的查詢
      結果，跟「這次同步匯入成功」自相矛盾。
    """
    is_exam = item.get("isExam") == "T"
    category = Announcement.CATEGORY_EXAM if is_exam else Announcement.CATEGORY_ACTIVITY

    now = timezone.now()
    end_dt = _parse_aware_datetime(item.get("end_date"))
    unpublish_at = end_dt if (end_dt and end_dt > now) else None

    return {
        "title": _truncate(item.get("title") or "", 100),
        "body": "",
        "category": category,
        "cover_image_url": _truncate(item.get("image") or "", 500),
        "link_url": _truncate(item.get("detail") or "", 500),
        "display_date_text": _format_display_date(item.get("start_date"), item.get("end_date")),
        "source_tag": _truncate(item.get("tag") or "", 50),
        "publish_at": now,
        "unpublish_at": unpublish_at,
        "status": Announcement.STATUS_PUBLISHED,
        "source": Announcement.SOURCE_CRAWLER,
        "created_by": "system:crawler_sync",
    }


def sync_crawler_announcements(force_refresh=True):
    """把爬蟲抓到的活動/考試消息，同步成後台可編輯的 Announcement。

    只新增、不覆蓋——用 external_id（＝爬蟲項目的 source_key）當去重鍵，
    已經存在的項目一律略過，不會用爬蟲最新抓到的內容蓋掉後台人員已經做過
    的編輯。這也代表：後台人員把某筆匯入的項目下架（unpublish）之後，
    重新同步不會讓它復活——下架在這個機制下等同「永久不要再顯示這則」，
    不需要另外設計一份「封鎖清單」。

    不用單一個 transaction.atomic() 包住整個迴圈：單筆資料的意外失敗
    不應該讓這次同步已經成功匯入的其他筆全部回滾，這裡的失敗容忍策略
    跟 get_tayal_imformation 原本 tacp_ok/exam_ok 的部分成功精神一致。
    """
    status = AnnouncementSyncStatus.load()
    data = get_news_data(force_refresh=force_refresh)
    if data is None:
        status.record_failure("爬蟲來源目前無法取得資料")
        return {
            "available": False,
            "imported": 0,
            "skipped_existing": 0,
            "skipped_invalid": 0,
            "failed": 0,
        }

    imported = 0
    skipped_existing = 0
    skipped_invalid = 0
    failed = 0

    for item in data:
        source_key = item.get("source_key")
        if not source_key or not item.get("title"):
            skipped_invalid += 1
            continue
        try:
            _, created = Announcement.objects.get_or_create(
                external_id=source_key,
                defaults=build_announcement_defaults(item),
            )
            if created:
                imported += 1
            else:
                skipped_existing += 1
        except Exception:
            logger.exception("同步爬蟲公告失敗，source_key=%s", source_key)
            failed += 1

    status.record_success(imported, skipped_existing)
    return {
        "available": True,
        "imported": imported,
        "skipped_existing": skipped_existing,
        "skipped_invalid": skipped_invalid,
        "failed": failed,
    }
