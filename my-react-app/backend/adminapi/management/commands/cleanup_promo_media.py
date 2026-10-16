"""清理首頁宣傳影片媒體目錄裡「沒有任何紀錄引用，且已超過保留天數」的檔案。預設只預覽，加 --apply 才刪。

  python manage.py cleanup_promo_media                  # 預覽
  python manage.py cleanup_promo_media --apply          # 實際刪除

被取代或刪除的舊檔，上傳與刪除端點在同一個資料庫交易內登記孤立時間（PromoMediaOrphan），
清理依「孤立時間」而不是檔案修改時間（舊檔可能是幾個月前上傳的）。預設 14 天，大於磁碟快照保留期 7 天：萬一從備份還原資料庫，
還原後仍然引用的檔案還在。暫存目錄裡超過 24 小時的殘留檔也一併清掉（上傳中途失敗的遺留）。
建議用 cron 每天跑一次。
"""
import os
import time

from django.core.management.base import BaseCommand, CommandError

from adminapi import promo_upload as upload
from adminapi.models import PromoMediaOrphan, PromoVideo


class Command(BaseCommand):
    help = "清理沒有被引用且超過保留天數的宣傳影片媒體檔（預設只預覽）"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=upload.ORPHAN_RETENTION_DAYS)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        days = opts["days"]
        if days < upload.ORPHAN_RETENTION_DAYS:
            raise CommandError(f"--days 不可小於 {upload.ORPHAN_RETENTION_DAYS}（必須大於快照保留期）")
        referenced = set()
        for video in PromoVideo.objects.all():
            referenced.update(p for p in (video.video_path, video.cover_path, video.caption_path) if p)

        now = time.time()
        cutoff = now - days * 86400
        orphans = {o.path: o for o in PromoMediaOrphan.objects.all()}
        removed = kept = 0
        for kind, (subdir, _) in upload.KINDS.items():
            directory = os.path.join(upload.media_root(), *subdir.split("/"))
            if not os.path.isdir(directory) or os.path.islink(directory):
                continue
            for name in sorted(os.listdir(directory)):
                path = os.path.join(directory, name)
                relative = f"{subdir}/{name}"
                if os.path.islink(path) or not os.path.isfile(path):
                    continue  # 不碰符號連結與子目錄
                if relative in referenced:
                    kept += 1
                    continue
                # 有孤立紀錄就用孤立時間；沒有紀錄的（上傳後從沒被引用過）才用檔案建立時間
                record = orphans.get(relative)
                since = record.orphaned_at.timestamp() if record else os.path.getmtime(path)
                if since > cutoff:
                    kept += 1
                    continue
                removed += 1
                self.stdout.write(f"{'刪除' if opts['apply'] else '將刪除'} {relative}")
                if opts["apply"]:
                    os.remove(path)
                    PromoMediaOrphan.objects.filter(path=relative).delete()

        staging = upload.staging_root()
        stale = 0
        if os.path.isdir(staging):
            stage_cutoff = now - upload.STAGING_RETENTION_HOURS * 3600
            for name in os.listdir(staging):
                path = os.path.join(staging, name)
                if os.path.isfile(path) and not os.path.islink(path) and os.path.getmtime(path) < stage_cutoff:
                    stale += 1
                    self.stdout.write(f"{'刪除' if opts['apply'] else '將刪除'} 暫存殘留 {name}")
                    if opts["apply"]:
                        os.remove(path)

        # 孤立紀錄指向的檔案已經不存在（被手動刪掉），順手清掉紀錄
        if opts["apply"]:
            for path_key in orphans:
                if path_key not in referenced and not os.path.isfile(os.path.join(upload.media_root(), *path_key.split("/"))):
                    PromoMediaOrphan.objects.filter(path=path_key).delete()

        mode = "已刪除" if opts["apply"] else "預覽（未刪除，加 --apply 才會刪）"
        self.stdout.write(f"{mode}：孤立檔案 {removed} 個、暫存殘留 {stale} 個；保留 {kept} 個。")
