from django.core.exceptions import ValidationError
from django.db import models


class Announcement(models.Model):
    """後台公告——取代目前首頁 100% 依賴外部網站爬蟲的狀態（見規劃文件 §3.2.1）。

    狀態機：draft → pending_review → published → unpublished，
    或 pending_review → rejected（退件後可直接再次 submit_for_review，
    不強制先轉回 draft）；unpublished 也可以直接編輯（PATCH），編輯視同
    重新起草，儲存後會退回 draft，強制重新走一次送審／核准。狀態轉換邏輯
    集中在 views.py，這裡的 STATUS_CHOICES 只定義合法值，不在 model 層做
    轉換檢查（避免 model 跟 view 各自維護一份規則，兩邊對不上）。
    """

    STATUS_DRAFT = 'draft'
    STATUS_PENDING_REVIEW = 'pending_review'
    STATUS_REJECTED = 'rejected'
    STATUS_PUBLISHED = 'published'
    STATUS_UNPUBLISHED = 'unpublished'
    STATUS_CHOICES = [
        (STATUS_DRAFT, '草稿'),
        (STATUS_PENDING_REVIEW, '待審核'),
        (STATUS_REJECTED, '已退件'),
        (STATUS_PUBLISHED, '已發布'),
        (STATUS_UNPUBLISHED, '已下架'),
    ]

    CATEGORY_ANNOUNCEMENT = 'announcement'
    CATEGORY_ACTIVITY = 'activity'
    CATEGORY_EXAM = 'exam'
    CATEGORY_MAINTENANCE = 'maintenance'
    CATEGORY_CHOICES = [
        (CATEGORY_ANNOUNCEMENT, '公告'),
        (CATEGORY_ACTIVITY, '活動'),
        (CATEGORY_EXAM, '考試'),
        (CATEGORY_MAINTENANCE, '系統維護'),
    ]

    title = models.CharField(max_length=100)
    body = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default=CATEGORY_ANNOUNCEMENT)
    # 適用族語：空陣列＝全部族語（比照前台 config/tribes.py 的 slug 值，
    # 例如 ["tayal","amis"]）。這裡沒有做值域檢查（是不是真的存在的 slug），
    # 留給 serializer 驗證，model 層只負責存放。
    tribes = models.JSONField(default=list, blank=True)
    # 圖片走既有的 Cloudinary 前端直傳流程（跟大頭貼、筆記圖片同一套），
    # 後端只存最終網址字串，不經手檔案本身。
    cover_image_url = models.URLField(max_length=500, blank=True)
    link_url = models.URLField(max_length=500, blank=True)
    is_pinned = models.BooleanField(default=False)
    # 置頂到期日：is_pinned=True 時必填（見 clean()），避免永久置頂被遺忘
    # （規劃文件 §3.2.1 的明確要求）。
    pin_until = models.DateField(null=True, blank=True)
    # 排程發布／下架時間；publish_at 為空代表核准當下立即發布。
    publish_at = models.DateTimeField(null=True, blank=True)
    unpublish_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)

    created_by = models.CharField(max_length=128)
    submitted_by = models.CharField(max_length=128, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.CharField(max_length=128, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_comment = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_pinned', '-created_at', '-pk']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['category']),
        ]

    def clean(self):
        # 置頂沒設到期日是規劃文件明確要求要擋的情境（不是「建議」，是硬性
        # 驗證）；同時檢查放在 model.clean() 而不是只放在 serializer，讓任何
        # 未來直接用 ORM 操作（例如管理指令、資料修復腳本）也不會漏掉這個規則。
        if self.is_pinned and not self.pin_until:
            raise ValidationError({'pin_until': '置頂必須設定到期日'})
        if self.unpublish_at and self.publish_at and self.unpublish_at <= self.publish_at:
            raise ValidationError({'unpublish_at': '下架時間必須晚於發布時間'})

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title}"


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
