from django.db import models


class QuizResearchConsent(models.Model):
    """學習者是否同意把「假名化的詞素作答事件」用於改善與研究（見 config/quiz_research.py 的隱私設計）。

    一個假名一筆；撤回只是把 revoked_at 填上並刪掉該假名的全部事件，這筆紀錄本身保留（證明
    曾經同意與何時撤回）。FastAPI 的 backend/fastAPI/routes/quiz/research_events.py 用 SQLAlchemy
    Core 直接讀寫這張表，**欄位一旦異動，那邊手動組的 Table 定義要同步更新**。
    """
    pseudonym = models.CharField(max_length=64, unique=True)
    consent_version = models.CharField(max_length=40)
    granted_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.pseudonym[:8]}… v{self.consent_version}{' (revoked)' if self.revoked_at else ''}"


class QuizSkillEvent(models.Model):
    """一次經過伺服器 token 驗證的句子填空作答，以及當下模型對它的預測（用來事後比較「規則熟練度」
    與單一能力值哪個預測得準）。只存做研究需要的最少資料：沒有 uid、沒有詞形與句子，時間只到整點。

    預測值是「更新之前」算的（真正的前瞻預測，不會洩漏答案）：
    - pred_skill：依這條規則的熟練度估計預測答對的機率；非 probe（這題沒在測某條規則）時是 NULL；
    - pred_ability：既有單一能力值（IRT）對這題預測答對的機率。
    (pseudonym, nonce) 唯一：同一題的 token 重送不會重複記錄。排序用 id（同一個整點內的先後）。

    FastAPI 用 SQLAlchemy Core 直接寫入這張表，欄位異動時要同步更新
    backend/fastAPI/routes/quiz/research_events.py 的 Table 定義。
    """
    pseudonym = models.CharField(max_length=64)
    nonce = models.CharField(max_length=40)
    occurred_at = models.DateTimeField()
    tribe = models.CharField(max_length=20)
    question_type = models.CharField(max_length=20)
    target_rule_id = models.CharField(max_length=200, blank=True)
    selected_rule_id = models.CharField(max_length=200, blank=True)
    diagnosis_status = models.CharField(max_length=20)
    error_type = models.CharField(max_length=20, blank=True)
    correct = models.BooleanField()
    probe = models.BooleanField()
    seconds_bucket = models.SmallIntegerField()
    p_before = models.FloatField(null=True, blank=True)
    p_after = models.FloatField(null=True, blank=True)
    pred_skill = models.FloatField(null=True, blank=True)
    pred_ability = models.FloatField(null=True, blank=True)
    ability_before = models.FloatField(null=True, blank=True)
    model_version = models.CharField(max_length=32)
    kit_version = models.CharField(max_length=40, blank=True)
    selection_policy = models.CharField(max_length=40)
    consent_version = models.CharField(max_length=40)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['pseudonym', 'nonce'], name='uniq_quizskillevent_pseudonym_nonce'),
        ]
        indexes = [
            models.Index(fields=['pseudonym', 'id']),
            models.Index(fields=['tribe', 'occurred_at']),
        ]

    def __str__(self):
        return f"{self.pseudonym[:8]}… {self.target_rule_id or '-'} {'ok' if self.correct else 'x'}"
