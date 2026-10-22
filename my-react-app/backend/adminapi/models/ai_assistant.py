from django.db import models

INTENT_OFF_TOPIC = "off_topic"
INTENT_UNSAFE = "unsafe"
INTENT_REFUSED = "model_refusal"
INTENTS = (INTENT_OFF_TOPIC, INTENT_UNSAFE, INTENT_REFUSED)
ACTION_FIXED = "fixed"        # 回固定說明，沒有呼叫大模型
ACTION_GENTLE = "gentle"      # 離題但管理者設為寬鬆：由輕量模型簡短回應並引導回學習
ACTION_REFUSED = "refused"    # 大模型自己拒答
ACTIONS = (ACTION_FIXED, ACTION_GENTLE, ACTION_REFUSED)
MODERATION_RETENTION_DAYS = 30


class AiModerationEvent(models.Model):
    """被內容審核攔下或引導的訊息（路線圖 #28），供後台檢視誤攔與漏攔。

    隱私設計（對象可能是未成年人）：
      - 不存 uid，只存單向雜湊（與 AiFeedback 同一套），管理者只能看出「同一個人的幾則」。
      - 只存訊息開頭的短摘錄（excerpt，最多 80 字，長數字與電子郵件已遮掉），不存整段對話與模型回覆。
      - 只有 owner／admin 看得到；保存 30 天後清除（purge_ai_moderation 指令）。
    正常通過的訊息不會有任何紀錄。
    """
    created_at = models.DateTimeField(auto_now_add=True)
    uid_hash = models.CharField(max_length=32)
    intent = models.CharField(max_length=16)
    action = models.CharField(max_length=8)
    excerpt = models.CharField(max_length=120, blank=True, default="")
    tribe = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        indexes = [
            models.Index(fields=['intent', '-created_at']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"{self.intent}/{self.action} #{self.pk}"


class AiAssistantSettingsVersion(models.Model):
    """管理者可調整的助手設定（路線圖 #35、#28）：每次儲存都新增一個版本，從不修改舊版本。

    目前生效的是編號最大的那一筆；沒有任何一筆時用程式裡的預設值（AIModel/assistant_settings.py）。
    回滾 = 複製舊版本的內容再存成一個新版本，所以歷史完整、可以回滾「回滾」。
    content 的欄位與驗證規則見 assistant_settings.validate()。
    """
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=128, blank=True, default="")
    note = models.CharField(max_length=100, blank=True, default="")
    source = models.CharField(max_length=20, default="edit")      # edit 或 rollback:<版本>
    content = models.JSONField()

    class Meta:
        ordering = ['-id']

    def __str__(self):
        return f"v{self.pk} ({self.source})"
