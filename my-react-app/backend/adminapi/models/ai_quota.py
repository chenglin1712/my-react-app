from django.db import models


class AiDailyUsage(models.Model):
    """AI 助手每人每日的提問次數（路線圖 #5）。

    為什麼存資料庫而不是快取：次數歸零等於額度失效，而正式環境重啟、多個 gunicorn worker、
    Redis 被清空都會讓快取計數消失；跟訪客翻譯試用（GuestTranslationUsage）同樣的理由。
    每人每天一列，遞增用資料庫的原子更新（AIModel/quota.py），兩個同時送出的請求不會雙雙看到「還剩一次」。

    day 是台灣日期（午夜重置）。uid 是 Firebase uid；只存計數，不存問了什麼。
    """
    day = models.DateField()
    uid = models.CharField(max_length=128)
    count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['day', 'uid'], name='uniq_ai_daily_usage_day_uid'),
        ]
        indexes = [models.Index(fields=['day'])]

    def __str__(self):
        return f"{self.day} {self.uid[:8]} x{self.count}"
