from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


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


class ExamScheduleOverride(models.Model):
    """考試時程人工覆寫——某一期程若爬蟲抓錯、或官網還沒更新，可以人工填入
    並鎖定（is_active=True 時蓋過爬蟲抓到的同一個 phase，見
    crawler/views.py 的 _apply_exam_schedule_overrides）。

    phase 是短代稱（對應 crawler/views.py EXAM_SCHEDULE_PHASE_MAP 的值，
    例如「報名」「測驗」），刻意不限制只能是目前這幾個值——官網之後如果
    新增了 phase map 還沒收錄的期程類型，管理者一樣能用完全手動的 phase
    代稱建一筆蓋過去（或補一筆爬蟲沒抓到的期程）。

    phase 直接當 primary_key（不另外長一個自動遞增 id）：這張表每一列本來
    就是以 phase 為單位的「這個期程目前有沒有被覆寫」，URL／稽核紀錄的
    target_id 也都是用 phase 當自然鍵在查，讓 phase 直接是 pk 兩邊才會
    對得上，不然 AuditLog.target_id（取自 model 的 .pk）會變成內部數字
    id，稽核紀錄裡完全看不出是哪個期程被改了。
    """
    phase = models.CharField(max_length=50, primary_key=True)
    label = models.CharField(max_length=100, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_date', 'phase']

    def clean(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValidationError({'end_date': '結束日期不能早於開始日期'})

    def __str__(self):
        return f"{self.phase}（{'生效中' if self.is_active else '已停用'}）"


class ExamScheduleCrawlStatus(models.Model):
    """考試時程爬蟲的執行狀態，單例（永遠只有一筆，pk 固定用 1，見 load()）。
    給後台「上次成功時間／上次失敗原因／連續失敗幾次」用。只有真的觸發一次
    爬取（公開端點快取沒命中，或後台手動重爬）才會更新，不是每次公開端點
    被打就更新——這樣數字反映的才是「爬蟲上次真的執行的結果」，不是
    「上次有人剛好開了首頁」。
    """
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_failure_reason = models.TextField(blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def record_success(self):
        self.last_success_at = timezone.now()
        self.consecutive_failures = 0
        self.save(update_fields=['last_success_at', 'consecutive_failures'])

    def record_failure(self, reason):
        self.last_failure_at = timezone.now()
        self.last_failure_reason = (reason or '')[:2000]
        self.consecutive_failures += 1
        self.save(update_fields=['last_failure_at', 'last_failure_reason', 'consecutive_failures'])

    def __str__(self):
        return f"考試時程爬蟲狀態（連續失敗 {self.consecutive_failures} 次）"


class HomepageConfig(models.Model):
    """首頁版位設定，單例（永遠只有一筆，pk 固定用 1，見 load()）。

    首頁目前是完全客製化的 V2 視覺設計（見規劃文件重新確認過的現況），不是
    單純的「Banner 圖＋三個按鈕」版型，所以這裡刻意只開放真正安全、不會讓
    後台亂填壞掉版面的欄位：主視覺卡片的圖片／連結／標題可覆蓋（三者皆留空
    時前端維持現有的逐族語文字展示，不會顯示壞掉的空白區塊），三顆功能
    按鈕只能開關顯示、不能改內容或導向（避免打錯字變成連到不存在的路由），
    消息/時程區塊只能整體顯示或隱藏、消息筆數可調。
    """
    hero_image_url = models.URLField(max_length=500, blank=True)
    # 允許內部路由（例如 "/quiz/select"）或外部網址，所以不能用 URLField
    # （它的驗證器只接受有 scheme 的絕對網址）；scheme 白名單驗證放在
    # serializer（見 serializers.py 的 validate_hero_link_url），避免存進
    # 一個 javascript: 之類的值——這個欄位最終會變成公開首頁上的 <a href>，
    # 任何訪客的瀏覽器都會執行到，不是後台內部才看得到的東西。
    hero_link_url = models.CharField(max_length=500, blank=True)
    hero_title_override = models.CharField(max_length=100, blank=True)
    show_news_section = models.BooleanField(default=True)
    show_calendar_section = models.BooleanField(default=True)
    news_display_count = models.PositiveSmallIntegerField(default=6)
    button1_enabled = models.BooleanField(default=True)
    button2_enabled = models.BooleanField(default=True)
    button3_enabled = models.BooleanField(default=True)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "首頁版位設定"


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
