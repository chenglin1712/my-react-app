from django.db import models


class UsageEvent(models.Model):
    """P5 數據分析的通用使用事件記錄——跟 AuditLog 不同：AuditLog 記的是
    「後台工作人員改了什麼管理資料」，這裡記的是「一般使用者/訪客做了什麼」
    （搜尋了什麼詞、答對/答錯了哪一題、開始了一次測驗…），角色完全不同，
    不能共用同一張表，語意會混在一起。

    寫入來源分兩條路（見規劃文件 P5 §1）：
    (1) 前端透過 POST /adminapi/public/events/ 寫入（頁面瀏覽、測驗開始等，
        呼叫走一般的 Django HTTP 層，這裡沒有特殊考量）；
    (2) FastAPI 端（辭典搜尋查詢字串跟命中數）透過 backend/fastAPI/usage_events.py
        的輕量 SQLAlchemy engine 直接 INSERT 進這張表——這是 FastAPI 第一次
        寫入 Django migration 管理的 Postgres 表，跟既有 dictionary_db（Django
        的 adminapi 用原生 SQLAlchemy session 直接寫進一個不是它自己 migration
        管理的 Postgres 表）是同一種「兩個服務共用同一個 Postgres 執行個體、
        各自用最適合自己框架的方式直接存取」精神，只是方向相反。**因此这张表
        的欄位一旦異動，backend/fastAPI/usage_events.py 裡手動組的 INSERT 語句
        要記得同步更新**，兩邊沒有共用的 schema 定義來源。

    uid 允許空字串——未登入訪客的搜尋/瀏覽行為本身也是分析目標，不能因為
    沒有登入就整筆事件不記錄；tribe 同理允許空字串（不是每個事件都有明確
    的族語脈絡，例如純頁面瀏覽）。
    """
    event_type = models.CharField(max_length=40)
    uid = models.CharField(max_length=128, blank=True)
    tribe = models.CharField(max_length=20, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['event_type', 'created_at']),
            models.Index(fields=['uid', 'created_at']),
        ]

    def __str__(self):
        return f"{self.event_type}@{self.created_at:%Y-%m-%d %H:%M}"
