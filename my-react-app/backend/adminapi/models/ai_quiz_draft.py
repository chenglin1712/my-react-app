from django.db import models


class AiQuizDraft(models.Model):
    """由 AI 產生的題庫草稿的來源紀錄（路線圖 #23）。

    題目本身是一般的題庫列（目前是 QuizSituationItem），走既有的「草稿 → 送審 → 審核者核可」流程，
    審核者與審核時間記在題目本身（ReviewableContent.reviewed_by / reviewed_at）。這張表補上題目沒有的來源資訊：
    用了哪些辭典詞條、哪個模型、誰按下產生，以及辭典查不到的族語詞（unverified_words，供審核者重點檢查）。

    generated_by 同時是「不能核可自己產生的草稿」的依據（見 quizbank_views._content_approve）。
    (content_type, content_id) 唯一：一題只有一筆來源紀錄；題目被刪除時紀錄保留，才查得到曾經有過什麼。
    content_type 沿用稽核的 target_type 字串（例如 "quiz_situation_item"）。
    """
    content_type = models.CharField(max_length=40)
    content_id = models.PositiveIntegerField()
    tribe = models.CharField(max_length=20)
    source_word_ids = models.JSONField(default=list)
    source_words = models.JSONField(default=list)
    unverified_words = models.JSONField(default=list)
    model = models.CharField(max_length=80)
    generated_by = models.CharField(max_length=128)
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['content_type', 'content_id'], name='uniq_ai_quiz_draft_content'),
        ]
        indexes = [models.Index(fields=['generated_by'])]

    def __str__(self):
        return f"{self.content_type}#{self.content_id} by {self.generated_by[:8]}…"
