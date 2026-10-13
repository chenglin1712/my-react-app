from django.db import models


class GuestTranslationUsage(models.Model):
    """訪客翻譯試用的每日計次表（C-2）。

    一筆 = 一個「台灣日期 × 計次範圍 × 雜湊鍵」的當日使用次數：
    - scope='browser'：key_hash 是瀏覽器代號（前端存在 localStorage 的隨機 ID）的 HMAC，
      每個瀏覽器每日上限 10 次（所有族語合計）。
    - scope='ip'：key_hash 是來源 IP 的 HMAC，是「隱形的高上限保險」（暫定每日 1000 次），
      只擋明顯濫用；學校等共用對外 IP 的環境不會被正常使用誤擋。

    **只存雜湊值，不存明文 IP 或瀏覽器代號。** 雜湊用伺服器端密鑰（GUEST_TRIAL_SECRET）做 HMAC，
    沒有密鑰就無法從資料庫反推 IP。過期資料（超過保存天數）由
    `python manage.py purge_guest_trial_usage` 與 FastAPI 的機會式清理刪除。

    寫入者是 FastAPI（backend/fastAPI/guest_trial.py，用 SQLAlchemy Core 做原子 upsert），
    不是 Django；跟 UsageEvent、FeatureFlag 同一種「兩個服務共用同一個 Postgres」作法。
    **這張表的欄位一旦異動，guest_trial.py 手動組的 Table 定義要記得同步更新。**
    """
    SCOPE_BROWSER = 'browser'
    SCOPE_IP = 'ip'

    day = models.DateField()
    scope = models.CharField(max_length=8)
    key_hash = models.CharField(max_length=64)
    count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['day', 'scope', 'key_hash'], name='uniq_guest_trial_day_scope_key'),
        ]
        indexes = [
            models.Index(fields=['day']),
        ]

    def __str__(self):
        return f"{self.day} {self.scope} {self.key_hash[:8]}… × {self.count}"
