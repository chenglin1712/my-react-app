from django.db import models


class AuditLog(models.Model):
    actor_uid = models.CharField(max_length=128)
    actor_role = models.CharField(max_length=32, null=True, blank=True)
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=64)
    target_id = models.CharField(max_length=128)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # 稽核紀錄必須保留原貌供事後追查，因此一般 API 只允許讀取，不提供修改或刪除。
    class Meta:
        # 加 -pk 當第二排序鍵：auto_now_add 的時間解析度在同一批次快速寫入時
        # 可能撞在一起（例如批次匯入一次寫多筆），單靠 -created_at 排序在時間
        # 相同時順序未定義；-pk 確保「同一時間戳記」的紀錄仍能穩定排出新到舊。
        ordering = ['-created_at', '-pk']
        indexes = [
            models.Index(fields=['target_type', 'target_id']),
            models.Index(fields=['actor_uid']),
        ]

    def __str__(self):
        return (
            f"{self.created_at} {self.actor_uid} {self.action} "
            f"{self.target_type}:{self.target_id}"
        )
