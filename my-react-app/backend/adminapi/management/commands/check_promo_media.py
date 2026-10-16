"""媒體遺失告警：確認首頁啟用中的影片、封面、字幕檔案都還在，目錄也安全。

  python manage.py check_promo_media

公開端點在檔案遺失時只會安靜降級（available: false），訪客看到的是「影片無法播放」，
管理者不會知道。這個指令用非 0 結束碼與高優先級日誌（PROMO_MEDIA_MISSING）讓監控抓得到，
建議用 cron 每 15 分鐘跑一次，並把結束碼或這行日誌接到你的告警。
也會檢查媒體根目錄與 homepage 子目錄是否為符號連結（nginx 設定 disable_symlinks 的前提）。
"""
import logging
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from adminapi import promo_upload as upload
from adminapi.models import HomepageConfig, PromoVideo
from adminapi.promo_media import media_file_exists

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "檢查啟用中的宣傳影片與其封面、字幕檔案是否存在（缺失時以非 0 結束）"

    def handle(self, *args, **opts):
        problems = []

        root = upload.media_root()
        if os.path.islink(str(settings.MEDIA_ROOT)):
            problems.append("媒體根目錄是符號連結")
        for part in ("homepage", "homepage/video", "homepage/cover", "homepage/caption"):
            path = os.path.join(root, *part.split("/"))
            if os.path.islink(path):
                problems.append(f"{part} 是符號連結")

        config = HomepageConfig.load()
        video = config.active_promo_video
        if video is not None:
            if not media_file_exists(video.video_path):
                problems.append(f"啟用中的影片檔遺失：{video.video_path or '(沒有影片檔)'}（影片 #{video.pk}）")
            for label, path in (("封面", video.cover_path), ("字幕", video.caption_path)):
                if path and not media_file_exists(path):
                    problems.append(f"啟用中影片的{label}檔遺失：{path}（影片 #{video.pk}）")

        # 沒啟用的影片遺失檔案只提醒，不算告警（結束碼仍為 0）
        missing_inactive = [
            v.pk for v in PromoVideo.objects.exclude(pk=config.active_promo_video_id)
            if v.video_path and not media_file_exists(v.video_path)
        ]

        if missing_inactive:
            self.stdout.write(f"提醒：未啟用的影片 {missing_inactive} 的影片檔遺失。")
        if problems:
            for problem in problems:
                logger.error("PROMO_MEDIA_MISSING %s", problem)
                self.stderr.write(f"!! {problem}")
            raise CommandError(f"{len(problems)} 個媒體問題，請立即處理。")
        self.stdout.write("OK：沒有發現媒體遺失。")
