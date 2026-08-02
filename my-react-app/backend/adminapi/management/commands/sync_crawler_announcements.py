"""把爬蟲抓到的活動/族語認證消息同步成後台公告（見 adminapi/crawler_sync.py）。

用法：
    python manage.py sync_crawler_announcements

這支指令存在的目的是當「排程觸發」的接口——目前專案沒有 Celery/cron 這類
排程基礎設施，部署平台也還沒定案（見 docker-compose.yml 的說明），與其現在
就選一套排程方案，不如先把同步邏輯包成一個不依賴 HTTP request 的指令，之後
不管是本機 Windows工作排程器、或正式環境的 Render/Cloud Run Cron Job，都只
需要設定「定期執行這行指令」，不需要再改一行程式碼。日常也可以直接用後台
「同步爬蟲活動」按鈕（見 adminapi/views.py 的 announcement_sync_crawler），
這支指令不是唯一入口。
"""
from django.core.management.base import BaseCommand

from adminapi.crawler_sync import sync_crawler_announcements


class Command(BaseCommand):
    help = "把爬蟲抓到的活動/族語認證消息同步成後台公告（Announcement）"

    def handle(self, *args, **options):
        result = sync_crawler_announcements(force_refresh=True)
        if not result["available"]:
            self.stdout.write(self.style.ERROR("爬蟲來源目前無法取得資料，本次同步未執行"))
            return

        self.stdout.write(self.style.SUCCESS(
            f"同步完成：新增 {result['imported']} 筆、"
            f"略過已存在 {result['skipped_existing']} 筆、"
            f"略過無效資料 {result['skipped_invalid']} 筆、"
            f"失敗 {result['failed']} 筆"
        ))
