from django.db import models


class AiUsageLog(models.Model):
    """每一次呼叫 Anthropic API 的用量紀錄（後台「AI 用量」頁的資料來源）。

    跟 UsageEvent 不同：UsageEvent 記的是使用者行為，這裡記的是付費 API 的
    token、延遲與結果，用來回答「花了多少錢、哪個功能最貴、快取有沒有命中、
    多常失敗」。**不記 prompt 與模型輸出**（內含使用者輸入的內容），只記數字、
    模型名稱與 request id（出問題時可拿去對照 Anthropic 端的紀錄）。

    寫入來源有兩條路，跟 UsageEvent 相同的理由：
    (1) Django（AIModel 的聊天與補充說明）：adminapi.ai_usage.record_ai_usage，
        透過 config.llm.set_usage_recorder 註冊，用 ORM 寫入；
    (2) FastAPI（翻譯）：backend/fastAPI/ai_usage_events.py 用 SQLAlchemy Core
        直接 INSERT。**這張表的欄位一旦異動，那邊手動組的 Table 定義要同步更新**，
        兩邊沒有共用的 schema 定義來源。

    token 欄位在失敗（逾時、限流、斷路器開啟）時沒有數字，一律存 0。
    uid 允許空字串（翻譯支援訪客試用）。
    """
    created_at = models.DateTimeField(auto_now_add=True)
    feature = models.CharField(max_length=20)
    uid = models.CharField(max_length=128, blank=True)
    model = models.CharField(max_length=80)
    status = models.CharField(max_length=20)
    request_id = models.CharField(max_length=80, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cache_read_tokens = models.PositiveIntegerField(default=0)
    cache_write_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['feature', 'created_at']),
            models.Index(fields=['uid', 'created_at']),
        ]

    def __str__(self):
        return f"{self.feature}/{self.status}@{self.created_at:%Y-%m-%d %H:%M}"
