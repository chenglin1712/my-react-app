from django.db import models

RATING_UP = "up"
RATING_DOWN = "down"
REASONS = ("wrong_tribal", "irrelevant", "too_hard", "too_long", "other")
RETENTION_DAYS = 180


class AiFeedback(models.Model):
    """學生對 AI 助手單則回覆的讚／倒讚（路線圖 #30）。

    隱私設計：
      - 只有學生按下讚或倒讚時才存，且只存「這一則問答」（問題、回覆、可選的說明），不存整段對話。
      - 不存 uid，只存單向雜湊（uid_hash）：管理者能看出「同一個人的幾則」，但看不出是誰。
      - 問題與說明是學生自己寫的，可能含個資，所以只有 owner／admin 看得到，保存 180 天後清除
        （purge_ai_feedback 指令）。回覆文字由伺服器簽章驗證過確實是助手說的。
    追溯：model、prompt_version、request_id 是產生這則回覆當時記下的，倒讚可以對回當次的模型與提示詞版本。
    (uid_hash, reply_sig) 唯一：同一個人對同一則回覆只有一筆，改變心意是更新而不是新增。
    """
    uid_hash = models.CharField(max_length=32)
    reply_sig = models.CharField(max_length=64)
    rating = models.CharField(max_length=8)
    reason = models.CharField(max_length=20, blank=True, default="")
    comment = models.CharField(max_length=300, blank=True, default="")
    question_text = models.CharField(max_length=1000)
    reply_text = models.CharField(max_length=2000)
    tribe = models.CharField(max_length=20)
    model = models.CharField(max_length=80, blank=True, default="")
    prompt_version = models.CharField(max_length=16, blank=True, default="")
    request_id = models.CharField(max_length=80, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # 管理者把這則倒讚標成「加入評測題組」候選（run_ai_eval --include-feedback 會讀取）
    eval_candidate = models.BooleanField(default=False)
    eval_note = models.CharField(max_length=300, blank=True, default="")
    # 管理者審過、去掉個資後的重播問題。評測只用這一欄，不直接用學生原文（原文不受信任，也可能含個資）
    eval_question = models.CharField(max_length=300, blank=True, default="")
    eval_marked_by = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=['uid_hash', 'reply_sig'], name='uniq_ai_feedback_reply')]
        indexes = [
            models.Index(fields=['rating', '-created_at']),
            models.Index(fields=['eval_candidate']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"{self.rating} {self.reason or '-'} #{self.pk}"
