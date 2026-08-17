from django.core.serializers.json import DjangoJSONEncoder
from django.db import models


class DictionaryRevision(models.Model):
    """P4 辭典內容（詞條／文法章節）的送審提案。

    跟 PendingRevision 是同一種精神——提案先存 JSON，核准後才落地，
    target 用鬆散多型參照不建實際 FK——但**不能直接沿用 PendingRevision**：
    (1) PendingRevision.target_id 是 PositiveIntegerField，辭典的 id
    （words.id 等）是 UUID 字串；(2) PendingRevision 沒有 operation 欄位，
    無法表達「這是刪除提案」或「這是還沒有 target 的新建提案」；
    (3) PendingRevision 核准時用 setattr(obj, field, value) + full_clean()
    + save() 套用，這是 Django ORM 專屬寫法，對 SQLAlchemy session（辭典
    資料庫）沒有對應意義——套用邏輯改成呼叫
    adminapi.dictionary_write.apply_word_tree()/apply_grammar_section()。

    辭典資料庫（dictionary_db）是獨立的 SQLAlchemy/Postgres 連線，Django
    ORM 完全不知道那邊的 schema，所以草稿內容全部留在這張表裡、不落地到
    辭典資料庫——這樣「未審核內容外洩」在結構上就不可能發生（辭典的公開
    查詢端點本來就不會篩選 status，因為草稿根本不在那邊的表裡）。

    base_hash 是開啟編輯器當下整棵樹（詞條或文法章節）的內容雜湊，核准時
    重新計算現在的雜湊比對，不一致就 409——這是跨兩個資料庫沒辦法用
    select_for_update() 鎖列（鎖不到 dictionary_db 的列，而且編輯器開著
    是「人的時間」，任何列鎖都不該鎖那麼久）的替代方案，避免「A 編輯到一半
    時 B 已經核准了另一版」的競態被悄悄覆蓋。

    同一個 target 同時間只能有一筆「待審核」的提案，跟 PendingRevision
    同一種 Meta.constraints 設計；target_id='' 代表新建（還沒有 target），
    刻意排除在唯一約束外，允許多人同時各自草擬新詞條。
    """
    TARGET_WORD = 'word'
    TARGET_GRAMMAR_SECTION = 'grammar_section'
    TARGET_CHOICES = [
        (TARGET_WORD, '詞條'),
        (TARGET_GRAMMAR_SECTION, '文法章節'),
    ]

    OPERATION_CREATE = 'create'
    OPERATION_UPDATE = 'update'
    OPERATION_DELETE = 'delete'
    OPERATION_CHOICES = [
        (OPERATION_CREATE, '新建'),
        (OPERATION_UPDATE, '修改'),
        (OPERATION_DELETE, '刪除'),
    ]

    STATUS_DRAFT = 'draft'
    STATUS_PENDING_REVIEW = 'pending_review'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_FAILED = 'failed'
    STATUS_CHOICES = [
        (STATUS_DRAFT, '草稿'),
        (STATUS_PENDING_REVIEW, '待審核'),
        (STATUS_APPROVED, '已核准'),
        (STATUS_REJECTED, '已退件'),
        (STATUS_FAILED, '套用失敗'),
    ]

    target_kind = models.CharField(max_length=32, choices=TARGET_CHOICES)
    target_id = models.CharField(max_length=128, blank=True)
    tribe = models.CharField(max_length=20, blank=True)
    operation = models.CharField(max_length=16, choices=OPERATION_CHOICES)
    payload = models.JSONField(encoder=DjangoJSONEncoder)
    base_hash = models.CharField(max_length=71, blank=True)
    title_cache = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    submitted_by = models.CharField(max_length=128, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.CharField(max_length=128, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_comment = models.TextField(blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    apply_error = models.TextField(blank=True)
    created_by = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-submitted_at', '-pk']
        indexes = [
            models.Index(fields=['target_kind', 'target_id', 'status']),
            models.Index(fields=['status', 'submitted_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['target_kind', 'target_id'],
                condition=models.Q(status='pending_review') & ~models.Q(target_id=''),
                name='unique_pending_dictionary_revision_per_target',
            ),
        ]

    def __str__(self):
        label = self.target_id or '（新建）'
        return f"[{self.get_status_display()}] {self.target_kind}:{label} 辭典提案"


class DictionaryImportJob(models.Model):
    """批次匯入精靈四個步驟之間的狀態載體。

    預檢報告（步驟 3）必須存活到步驟 4 才能套用，不能要求使用者重新上傳
    一次；套用之後每一筆詞條的成功/失敗結果也需要留存讓前端顯示——這兩點
    都需要一個有生命週期的實體，不能只是一個無狀態端點。整個匯入工作是
    送審單位（不是每筆詞條各自建一筆 DictionaryRevision，否則一次匯入
    500 筆會直接洗版送審佇列），核准後才真正執行套用迴圈。
    """
    STATUS_UPLOADED = 'uploaded'
    STATUS_VALIDATED = 'validated'
    STATUS_PENDING_REVIEW = 'pending_review'
    STATUS_APPLYING = 'applying'
    STATUS_APPLIED = 'applied'
    STATUS_APPLIED_WITH_ERRORS = 'applied_with_errors'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_UPLOADED, '已上傳'),
        (STATUS_VALIDATED, '已預檢'),
        (STATUS_PENDING_REVIEW, '待審核'),
        (STATUS_APPLYING, '套用中'),
        (STATUS_APPLIED, '已套用'),
        (STATUS_APPLIED_WITH_ERRORS, '已套用（部分失敗）'),
        (STATUS_REJECTED, '已退件'),
    ]

    filename = models.CharField(max_length=255, blank=True)
    tribe = models.CharField(max_length=20)
    payload = models.JSONField()
    report = models.JSONField(default=dict, blank=True)
    preflight_hash = models.CharField(max_length=71, blank=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_UPLOADED)
    new_count = models.PositiveIntegerField(default=0)
    update_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    applied_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    uploaded_by = models.CharField(max_length=128)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.CharField(max_length=128, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_comment = models.TextField(blank=True)
    applied_by = models.CharField(max_length=128, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-uploaded_at', '-pk']
        indexes = [models.Index(fields=['status', 'uploaded_at'])]

    def __str__(self):
        return f"[{self.get_status_display()}] {self.tribe} 批次匯入（{self.filename or '未命名'}）"
