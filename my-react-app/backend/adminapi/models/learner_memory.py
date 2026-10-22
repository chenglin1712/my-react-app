from django.db import models


class LearnerMemoryConsent(models.Model):
    """學習者同意讓 AI 助手保存「學習記憶」（路線圖 #21）。

    有這一列 = 目前同意；撤回就刪掉這一列與該使用者全部記憶檔（見 AIModel/memory_store.clear_all），
    所以不保留任何撤回後的痕跡。預設沒有這一列（關閉）。改了同意文字就升 CONSENT_VERSION，
    舊版本的同意視為未同意，要重新勾選。uid 是 Firebase uid。
    """
    uid = models.CharField(max_length=128, unique=True)
    consent_version = models.CharField(max_length=40)
    granted_at = models.DateTimeField()

    def __str__(self):
        return f"{self.uid[:8]}… v{self.consent_version}"


class LearnerMemoryFile(models.Model):
    """記憶工具（memory_20250818）的一個檔案。每個 uid 各自一份，查詢一律帶 uid 條件，互相看不到。

    path 是相對於虛擬根目錄 /memories 的路徑（例如 "learning/notes.txt"），不含 uid，也不是真的檔案系統路徑；
    目錄是虛擬的（由檔案路徑推得）。updated_at 用來做保存期限（超過期限的檔案由 purge_learner_memory 清除）。
    """
    uid = models.CharField(max_length=128)
    path = models.CharField(max_length=200)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['uid', 'path'], name='uniq_learner_memory_uid_path'),
        ]
        indexes = [models.Index(fields=['updated_at'])]

    def __str__(self):
        return f"{self.uid[:8]}… {self.path}"
