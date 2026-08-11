import re

from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.utils import timezone

from config.tribes import TRIBES

_TRIBE_CHOICES = [(t.slug, t.full_name) for t in TRIBES]


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

    SOURCE_ADMIN = 'admin'
    SOURCE_CRAWLER = 'crawler'
    SOURCE_CHOICES = [
        (SOURCE_ADMIN, '後台建立'),
        (SOURCE_CRAWLER, '爬蟲匯入'),
    ]

    title = models.CharField(max_length=100)
    body = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default=CATEGORY_ANNOUNCEMENT)
    # 這篇是後台人員自己寫的，還是 crawler_sync.sync_crawler_announcements()
    # 從外部爬蟲資料自動匯入的——只是標記，不影響狀態機或任何權限判斷，純粹
    # 給後台列表篩選／徽章顯示用。序列化時務必只讀（見 serializers.py），
    # 不能讓一般 create/update 直接寫這個欄位。
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_ADMIN)
    # 爬蟲匯入專用的去重鍵，格式為「來源:原始 id」（例如 "tacp:12345"、
    # "ntnu-abst:https://..."），確保跨資料來源不會撞鍵。null=True 是刻意的：
    # 後台自建的公告這個欄位一律是 NULL，unique 約束底下多個 NULL 彼此不算
    # 衝突（Postgres／SQLite 皆然），只有非 NULL 值才真的互斥比對。
    # 絕對不能開放給 serializer 寫入——否則兩篇後台自建公告的這個欄位都會
    # 是序列化器預設值（可能是空字串 ''），第二篇存檔時就會撞上唯一約束。
    external_id = models.CharField(max_length=255, null=True, blank=True, unique=True, default=None)
    # 爬蟲來源本身的顯示用日期文字（例如活動起訖日、考試新聞的公告日期），
    # 純顯示、不參與任何排程或篩選邏輯——不能塞進 publish_at／unpublish_at，
    # 那兩個欄位的語意是「後台何時讓這篇在首頁曝光」，跟「這個活動本身哪天
    # 舉辦」是兩件事，硬塞在一起會讓活動還沒開始就因為 publish_at 在未來而
    # 被首頁查詢條件擋住不顯示。後台自建公告不需要這個欄位，留空即可。
    display_date_text = models.CharField(max_length=50, blank=True)
    # 爬蟲來源原始的分類文字（例如 tacp 的「展覽」「園區活動」），只用來讓
    # 首頁消息卡片的標籤顏色維持原本的多樣性（見 static/css/_home/news.css
    # 依 data-tag 內文字比對顏色的規則）；不是後台的分類欄位，不參與任何
    # 篩選或狀態判斷，後台自建公告不需要這個欄位。
    source_tag = models.CharField(max_length=50, blank=True)
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
            models.Index(fields=['source']),
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


class AnnouncementSyncStatus(models.Model):
    """公告爬蟲同步的執行狀態，單例（永遠只有一筆，pk 固定用 1，見 load()）。
    跟 ExamScheduleCrawlStatus 是同一種用途、同一套形狀：給後台「上次同步
    時間／上次失敗原因／連續失敗幾次／上次匯入與略過筆數」顯示用，也順便
    當 _write_audit_log 需要的 target（一次同步動作沒有單一一筆 Announcement
    可以當 target，這個單例物件的 pk 就是稽核紀錄的 target_id）。
    """
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_failure_reason = models.TextField(blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)
    last_imported_count = models.PositiveIntegerField(default=0)
    last_skipped_count = models.PositiveIntegerField(default=0)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def record_success(self, imported_count, skipped_count):
        self.last_success_at = timezone.now()
        self.consecutive_failures = 0
        self.last_imported_count = imported_count
        self.last_skipped_count = skipped_count
        self.save(update_fields=[
            'last_success_at', 'consecutive_failures',
            'last_imported_count', 'last_skipped_count',
        ])

    def record_failure(self, reason):
        self.last_failure_at = timezone.now()
        self.last_failure_reason = (reason or '')[:2000]
        self.consecutive_failures += 1
        self.save(update_fields=['last_failure_at', 'last_failure_reason', 'consecutive_failures'])

    def __str__(self):
        return f"公告爬蟲同步狀態（連續失敗 {self.consecutive_failures} 次）"


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


class PendingRevision(models.Model):
    """已發布/已啟用內容的「編輯中修改」。

    使用者發現「所有內容發布過後，畫面上只有下架這個選項」——要修改一篇
    已發布的公告或一筆已啟用的題庫內容，原本得先下架（讓內容從對外查詢
    消失）才能編輯，中間會有一段空窗期。這張表讓「編輯已發布內容」完全
    不碰正在生效的那一列：提案的新內容先存在這裡，核准後才套用到原本的
    列上（狀態不變，仍是 published/已啟用，全程沒有下架、沒有空窗期）；
    退件則整筆捨棄，原本內容完全不受影響，繼續照舊資料顯示。

    target_type/target_id 是多型參照（跟 AuditLog 同一種設計，不建實際
    FK），因為要涵蓋 Announcement 與 5 種題庫內容型別共 6 種不同 model，
    不值得為了一個共用功能各自加一個 revision 表。

    payload 只存「這個內容型別可編輯的欄位」——跟一般 create/update 用的
    同一份 serializer 驗證過，只是驗證完不寫回原本的列，改存進這裡；
    encoder=DjangoJSONEncoder 是因為 Announcement 的 pin_until／publish_at
    這類日期時間欄位驗證後會是 Python date/datetime 物件，預設的 JSON
    encoder 無法序列化。

    同一個 target 同時間只能有一筆「待審核」的修改（見 Meta.constraints）
    ——重複編輯只會更新同一筆待審修改，不會疊出兩筆互相衝突的提案。
    """
    STATUS_PENDING_REVIEW = 'pending_review'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_PENDING_REVIEW, '待審核'),
        (STATUS_APPROVED, '已核准'),
        (STATUS_REJECTED, '已退件'),
    ]

    target_type = models.CharField(max_length=64)
    target_id = models.PositiveIntegerField()
    payload = models.JSONField(encoder=DjangoJSONEncoder)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING_REVIEW)
    submitted_by = models.CharField(max_length=128)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.CharField(max_length=128, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_comment = models.TextField(blank=True)

    class Meta:
        ordering = ['-submitted_at', '-pk']
        indexes = [models.Index(fields=['target_type', 'target_id', 'status'])]
        constraints = [
            models.UniqueConstraint(
                fields=['target_type', 'target_id'],
                condition=models.Q(status='pending_review'),
                name='unique_pending_revision_per_target',
            ),
        ]

    def __str__(self):
        return f"[{self.get_status_display()}] {self.target_type}:{self.target_id} 待審修改"


class ReviewableContent(models.Model):
    """題庫類內容（配合題詞彙／克漏字短文／情境題）共用的送審狀態機欄位。

    跟 Announcement 是同一種狀態機精神（transitions 邏輯集中在 views.py，
    這裡只定義合法值），但拿掉 Announcement 的 published/unpublished「下架」
    語意與 publish_at/unpublish_at 排程欄位——這幾個 model 沒有「首頁曝光
    時間窗」的需求，published 這裡的語意單純是「已啟用，會被選題邏輯抽到」，
    要停用一筆已啟用的內容，直接退回 draft 即可，不需要一個獨立的
    unpublished 狀態。
    """
    STATUS_DRAFT = 'draft'
    STATUS_PENDING_REVIEW = 'pending_review'
    STATUS_REJECTED = 'rejected'
    STATUS_PUBLISHED = 'published'
    STATUS_CHOICES = [
        (STATUS_DRAFT, '草稿'),
        (STATUS_PENDING_REVIEW, '待審核'),
        (STATUS_REJECTED, '已退件'),
        (STATUS_PUBLISHED, '已啟用'),
    ]

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
        abstract = True


class QuizVocabItem(ReviewableContent):
    """中高級題庫「配合題」的單一詞彙項目，取代原本 backend/crawler/*_bank.py
    寫死的 VOCAB_BANK（tayal）／CATEGORY_TARGETS + 即時查 dictionary.db
    （amis/bunun/kavalan/paiwan）。category 沿用 build_matching_test() 既有的
    5 個分類，跟 crawler/views.py 的 CATEGORY_QUOTA 配額比例一致。

    遷移後選題邏輯改成完全讀這張表（見 migrate_quiz_bank_to_db 管理指令），
    不再對 amis/bunun/kavalan/paiwan 做即時 dictionary.db 查詢——這是刻意的
    架構轉變：族語老師審定的意義在於「審過的內容才會被學生看到」，如果
    內容還會隨辭典異動即時變化、繞過審定，這個審定流程就沒有意義。
    """
    CATEGORY_NOUN = 'noun'
    CATEGORY_VERB = 'verb'
    CATEGORY_TIME = 'time'
    CATEGORY_FUNCTION = 'function'
    CATEGORY_KIN = 'kin'
    CATEGORY_CHOICES = [
        (CATEGORY_NOUN, '名詞'),
        (CATEGORY_VERB, '動詞'),
        (CATEGORY_TIME, '時間'),
        (CATEGORY_FUNCTION, '功能詞'),
        (CATEGORY_KIN, '親屬稱謂'),
    ]

    tribe = models.CharField(max_length=20, choices=_TRIBE_CHOICES)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    foreign_word = models.CharField(max_length=100)
    chinese_gloss = models.CharField(max_length=100)
    # 現況所有既有資料這個欄位都是空字串（*_bank.py 的配合題從來沒有音檔），
    # 保留欄位供未來補音檔用，不強制填寫。
    audio_file_id = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['tribe', 'category', 'status'])]

    def __str__(self):
        return f"[{self.get_status_display()}] {self.tribe}/{self.foreign_word}"


class QuizClozePassage(ReviewableContent):
    """高級題庫「閱讀克漏字」的短文，取代原本 *_bank.py 寫死的 CLOZE_PASSAGES。

    passage_foreign 內含 {blank1}/{blank2}/... 這種標記；build_cloze_test()
    出題時，當次抽到的那一格換成 ＿＿＿，短文裡其餘格填入正解（比照原本
    *_bank.py 的邏輯）。標記格式必須跟 blanks 的 key 完全對應，見 clean()。
    """
    tribe = models.CharField(max_length=20, choices=_TRIBE_CHOICES)
    passage_foreign = models.TextField()
    passage_chinese = models.TextField()
    # {"blank1": {"options": [4 項], "answer": 1~4, "distractor_type": "", "note": ""}}
    # distractor_type／note 只是審定備註，不會送到前端，見 crawler/views.py。
    blanks = models.JSONField(default=dict)

    class Meta:
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['tribe', 'status'])]

    def clean(self):
        # *_bank.py 原本的 CLOZE_PASSAGES 完全沒有這層驗證（見 P2 規劃調查
        # 結論），格式錯誤的資料一路跑到出題當下才會炸；這裡在存檔當下就擋，
        # 不讓錯誤資料進資料庫。
        if not isinstance(self.blanks, dict) or not self.blanks:
            raise ValidationError({'blanks': '至少需要一個空格'})

        # 標記檢查要雙向：原本只確認 blanks 的每個 key 都出現在
        # passage_foreign 裡，沒有反向確認 passage_foreign 裡的每個標記都
        # 對應到 blanks——多寫或拼錯的標記（例如 {blnak2}）會通過驗證，
        # 出題時原封不動洩漏給學生（獨立審查找到的問題）。用 regex 抓出
        # 短文裡實際出現的全部標記，跟 blanks 的 key 集合做雙向比對；同時
        # 檢查有沒有重複標記（同一格出現兩次，畫面會顯示兩個空格但只有
        # 一組答案）。
        markers = re.findall(r'\{([^{}]+)\}', self.passage_foreign or '')
        marker_set = set(markers)
        blank_keys = set(self.blanks.keys())

        missing_in_passage = sorted(blank_keys - marker_set)
        if missing_in_passage:
            raise ValidationError({'passage_foreign': f'短文內容缺少對應的 {{{missing_in_passage[0]}}} 標記'})

        unknown_markers = sorted(marker_set - blank_keys)
        if unknown_markers:
            raise ValidationError({'passage_foreign': f'短文內容出現不在 blanks 裡的標記 {{{unknown_markers[0]}}}'})

        if len(markers) != len(marker_set):
            seen = set()
            duplicated = next(m for m in markers if m in seen or seen.add(m))
            raise ValidationError({'passage_foreign': f'標記 {{{duplicated}}} 在短文中重複出現'})

        for key, blank in self.blanks.items():
            if not isinstance(blank, dict):
                raise ValidationError({'blanks': f'{key} 格式錯誤'})
            options = blank.get('options')
            if not isinstance(options, list) or len(options) != 4:
                raise ValidationError({'blanks': f'{key} 的選項必須恰好 4 個'})
            answer = blank.get('answer')
            if not isinstance(answer, int) or not (1 <= answer <= 4):
                raise ValidationError({'blanks': f'{key} 的正解索引必須介於 1 到 4'})

    def __str__(self):
        return f"[{self.get_status_display()}] {self.tribe} 克漏字短文 #{self.pk}"


class QuizSituationItem(ReviewableContent):
    """情境式選擇題——獨立的族語對話練習入口，刻意不掛在 level 1~4 認證等級
    系統裡：那 4 個等級直接對應官方族語認證考試的實際等級，加一個「第 5 級」
    會跟官方等級編號混淆（官方根本沒有第 5 級）。

    給一段情境描述（scenario_chinese），4 個族語對話選項（options）裡選出
    最適合的回應（answer，1~4）。
    """
    tribe = models.CharField(max_length=20, choices=_TRIBE_CHOICES)
    scenario_chinese = models.TextField()
    # [{"foreign": "...", "chinese": "..."}, ...]，恰好 4 項，見 clean()。
    options = models.JSONField(default=list)
    answer = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['tribe', 'status'])]

    def clean(self):
        if not isinstance(self.options, list) or len(self.options) != 4:
            raise ValidationError({'options': '選項必須恰好 4 個'})
        if not (1 <= self.answer <= 4):
            raise ValidationError({'answer': '正解索引必須介於 1 到 4'})

    def __str__(self):
        return f"[{self.get_status_display()}] {self.tribe} 情境題 #{self.pk}"


class QuizTrueFalseItem(ReviewableContent):
    """初級題庫「是非題」的單一題項，取代原本 get_quiz_data 對 level=1 即時代理
    第三方政府合作單位 API（https://api.lokahsu.org.tw ）的做法。

    origin_key 是遷移時用來跟外部來源題目去重的鍵（取自對方音檔路徑檔名，例如
    "1_8"，同一個 dialect_id 底下這組檔名對應同一道固定題目，見
    migrate_quiz_level12_to_db 的調查結論：對方伺服器端每次回傳的題目組合是
    隨機抽樣，同一個 origin_key 出現多次代表同一道題，需要去重才不會建出大量
    重複列）。null=True 是因為後台人員之後自建的新題項不會有這個鍵，只有遷移
    匯入的資料才會填；跟 Announcement.external_id 是同一種「多個 NULL 不算撞
    unique 約束」設計。

    audio_url／image_url 存的是重新上傳到本專案自有 Cloudinary 空間後的網址，
    不是原始的 lokahsu.org.tw 網址——原始網址屬於第三方且來源不保證長期穩定，
    一次性匯入時就地转存成自己的副本，之後即使對方網站改版或下架也不受影響。
    """
    ANSWER_TRUE = 1
    ANSWER_FALSE = 2
    ANSWER_CHOICES = [
        (ANSWER_TRUE, 'O（符合）'),
        (ANSWER_FALSE, 'X（不符合）'),
    ]

    tribe = models.CharField(max_length=20, choices=_TRIBE_CHOICES)
    question_ab = models.CharField(max_length=300)
    question_ch = models.CharField(max_length=300)
    audio_url = models.URLField(max_length=500)
    image_url = models.URLField(max_length=500)
    answer = models.PositiveSmallIntegerField(choices=ANSWER_CHOICES)
    origin_key = models.CharField(max_length=100, null=True, blank=True, default=None)

    class Meta:
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['tribe', 'status'])]
        constraints = [
            models.UniqueConstraint(fields=['tribe', 'origin_key'], name='unique_true_false_tribe_origin_key'),
        ]

    def __str__(self):
        return f"[{self.get_status_display()}] {self.tribe} 是非題 #{self.pk}"


class QuizChoiceItem(ReviewableContent):
    """中級題庫「三選一圖片選擇題」的單一題項，取代原本 get_quiz_data 對 level=2
    即時代理外部 API 的做法。跟 QuizTrueFalseItem 是同一批遷移、同一套去重與
    自有 Cloudinary 轉存邏輯（見該 model 的說明）。

    刻意不存音檔：對方 API 雖然這個題型也回傳 audio 欄位，但前端
    quiz_panel.jsx 對 type==="choice" 只顯示 question_ab 文字＋三張圖片，
    從未播放過音檔（見 P2.5 規劃調查），保留一個永遠用不到的欄位沒有意義。
    """
    tribe = models.CharField(max_length=20, choices=_TRIBE_CHOICES)
    question_ab = models.CharField(max_length=300)
    question_ch = models.CharField(max_length=300)
    image_a_url = models.URLField(max_length=500)
    image_b_url = models.URLField(max_length=500)
    image_c_url = models.URLField(max_length=500)
    answer = models.PositiveSmallIntegerField()
    origin_key = models.CharField(max_length=100, null=True, blank=True, default=None)

    class Meta:
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['tribe', 'status'])]
        constraints = [
            models.UniqueConstraint(fields=['tribe', 'origin_key'], name='unique_choice_tribe_origin_key'),
        ]

    def clean(self):
        if not (1 <= self.answer <= 3):
            raise ValidationError({'answer': '正解索引必須介於 1 到 3'})

    def __str__(self):
        return f"[{self.get_status_display()}] {self.tribe} 選擇題 #{self.pk}"


class QuizSourceConfig(models.Model):
    """取代 crawler/views.py 寫死的 TRIBE_CONFIG——族語對應官方練習介面的
    dialect_id 與顯示名稱。

    P2 階段（中高級／高級）只用這張表即時代理外部 API；P2.5 階段起，初級／
    中級也已經改成跟中高級／高級一樣讀本地題庫（QuizTrueFalseItem／
    QuizChoiceItem），這張表的 dialect_id 不再被任何即時測驗請求使用，
    改為 migrate_quiz_level12_to_db 一次性匯入時的來源依據（哪個族語對應
    對方哪個 dialect_id）與歷史紀錄——之後若要重新匯入或補題，仍然依賴這裡
    記錄的 dialect_id 才知道要打對方哪個族語的介面。
    """
    tribe = models.CharField(max_length=20, unique=True, choices=_TRIBE_CHOICES)
    dialect_id = models.PositiveIntegerField()
    display_name = models.CharField(max_length=100)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['tribe']

    def __str__(self):
        return f"{self.tribe}（dialect_id={self.dialect_id}）"


class IrtConfig(models.Model):
    """FastAPI Recommon 適性測驗（backend/fastAPI/routes/quiz.py）的超參數，
    單例（永遠只有一筆，pk 固定用 1，見 load()）。這裡只是把原本模組頂部
    寫死的數字外部化成可調參數，不改動 IRT 計算公式本身——預設值原樣照抄
    quiz.py 現有的硬編碼值，確保新增這張表當下，實際算分行為完全不變。

    FastAPI 沒有直接連到這張表所在的資料庫——辭典 DB（dictionary_db）是
    另一個獨立的 Postgres database（見 backend/dictionary_db/connect.py），
    同一個 Postgres 執行個體下的不同 database 互不相通，不能直接 JOIN。
    FastAPI 改成呼叫公開的 GET /adminapi/irt-config/effective/ 端點、自己
    做短 TTL 快取（不是即時 push）——調整 IRT 參數不是秒等的即時性需求，
    跟 REDIS_URL 共用限流計數是完全不同等級的即時性要求。
    """
    total_questions = models.PositiveSmallIntegerField(default=10)
    alpha0 = models.FloatField(default=1.0)
    beta0 = models.FloatField(default=1.0)
    default_guess = models.FloatField(default=0.25)
    learning_rate = models.FloatField(default=0.08)
    dq_alpha = models.FloatField(default=0.45)
    dq_beta = models.FloatField(default=0.35)
    dq_gamma = models.FloatField(default=0.20)
    type_aq_word_translate = models.FloatField(default=1.2)
    type_aq_word_match = models.FloatField(default=1.0)
    type_aq_sentence_fill = models.FloatField(default=0.9)
    type_aq_sentence_order = models.FloatField(default=1.1)
    # BETA1/BETA2 對應的 F_w（收藏數）／R_w（探索數）目前前端從未回填這兩個
    # 欄位（quiz.py 的 UserModelReq.favorites/explorations 一直是預設值），
    # 調整這兩個參數在正式接上該資料前不會有實際效果——保留欄位是為了未來
    # 一旦補上該資料就能直接生效，不需要再改 schema。
    beta1 = models.FloatField(default=0.2)
    beta2 = models.FloatField(default=0.2)
    beta3 = models.FloatField(default=0.2)
    beta4 = models.FloatField(default=0.2)
    beta5 = models.FloatField(default=0.2)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"IRT 參數設定（每次測驗 {self.total_questions} 題）"


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
    STATUS_APPLIED = 'applied'
    STATUS_APPLIED_WITH_ERRORS = 'applied_with_errors'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_UPLOADED, '已上傳'),
        (STATUS_VALIDATED, '已預檢'),
        (STATUS_PENDING_REVIEW, '待審核'),
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


class GameConfig(models.Model):
    """四個遊戲（聽力/句型/發音/填字）的可調參數，單例（永遠只有一筆，
    pk 固定用 1，見 load()）——比照 IrtConfig 的既有模式：把原本各自模組
    頂部寫死的數字外部化成可調參數，不新增這幾個遊戲原本沒有的選題/篩選
    邏輯（例如聽力的頻率難度分級、句型的句長篩選——這兩個現況都不存在，
    刻意不無中生有，見規劃文件「並行項目」章節的說明）。預設值原樣照抄
    各自模組目前的硬編碼值，確保新增這張表當下，實際行為完全不變。

    四個遊戲共用一張表（不拆四張）——彼此之間沒有一對多關聯，拆開只會讓
    「載入全部設定」變成四次查詢，且四個遊戲的角色權限/生效時機都一致，
    沒有理由分開管理。
    """
    listening_questions_per_round = models.PositiveSmallIntegerField(default=10)
    listening_options_per_question = models.PositiveSmallIntegerField(default=4)
    sentence_questions_per_round = models.PositiveSmallIntegerField(default=5)
    sentence_options_per_question = models.PositiveSmallIntegerField(default=4)
    pronunciation_max_audio_mb = models.PositiveSmallIntegerField(default=10)
    # 優/良/待加強的相似度分界——原本完全在前端（pronunciation_game.jsx
    # 的 RATING()），這裡是這三個級距第一次有後端可調的定義。
    pronunciation_excellent_threshold = models.PositiveSmallIntegerField(default=80)
    pronunciation_good_threshold = models.PositiveSmallIntegerField(default=60)
    pronunciation_fair_threshold = models.PositiveSmallIntegerField(default=40)
    # 後端 compare_audio 的 passed 判定門檻（跟上面三個級距是各自獨立的
    # 判斷——passed 目前只用來決定要不要把這筆錄音存進「社群示範發音」，
    # 不是四個級距的其中一個切點，兩者刻意分開)。
    pronunciation_pass_threshold = models.PositiveSmallIntegerField(default=70)
    crossword_grid_size = models.PositiveSmallIntegerField(default=13)
    crossword_min_word_length = models.PositiveSmallIntegerField(default=4)
    crossword_max_word_length = models.PositiveSmallIntegerField(default=10)
    crossword_words_per_round = models.PositiveSmallIntegerField(default=30)
    crossword_compute_time_limit_seconds = models.PositiveSmallIntegerField(default=2)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "遊戲參數設定"


class RateLimitRule(models.Model):
    """限流設定的通用登錄表——key 對應 Django 端 adminapi/_shared.py／
    crawler/views.py 既有呼叫點傳入的 group 名稱，或 FastAPI 端新增的
    識別字串；rate 格式依 backend 而異（Django django_ratelimit 是
    "30/m" 這種簡寫，FastAPI 的 limits 套件是 "20/minute" 這種全稱，
    兩邊格式本來就不同，不強行統一）。

    Django 端呼叫點完全不需要改寫程式碼本身——rate_limited_response()／
    ip_rate_limited_response() 會先查這張表，查不到 key 對應的紀錄就
    fallback 用呼叫端原本傳入的字面值（不強制每個呼叫點都要先在這張表
    登錄過，找不到記錄＝用原本行為）；FastAPI 端每個 @limiter.limit(...)
    呼叫點則要逐一改成 callable（見 fastAPI/rate_limit_config.py），
    因為裝飾器綁定的字面字串沒有辦法動態替換。

    default_rate 存的是程式碼裡原本寫死的值，給「重設為預設值」按鈕與
    後台列表對照用；seed_rate_limit_rules 管理指令會把目前程式碼裡實際
    找到的全部呼叫點一次性寫入這張表，值設成跟程式碼目前一致（不留白）。
    """
    BACKEND_DJANGO = "django"
    BACKEND_FASTAPI = "fastapi"
    BACKEND_CHOICES = [
        (BACKEND_DJANGO, "Django"),
        (BACKEND_FASTAPI, "FastAPI"),
    ]

    key = models.CharField(max_length=100, unique=True)
    backend = models.CharField(max_length=10, choices=BACKEND_CHOICES)
    rate = models.CharField(max_length=20)
    default_rate = models.CharField(max_length=20)
    description = models.CharField(max_length=200, blank=True)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['backend', 'key']
        indexes = [models.Index(fields=['backend'])]

    def __str__(self):
        return f"[{self.backend}] {self.key} = {self.rate}"


class FeatureFlag(models.Model):
    """功能開關的通用登錄表——key 是呼叫端自訂的識別字串（例如
    "quiz_enabled_tayal"），enabled 預設 True（維持現況行為，管理者主動
    關閉才會改變）。這次唯一真正接上判斷的消費端是 crawler/views.py 的
    get_quiz_data()／get_situation_quiz_data()（族語測驗總開關），其餘
    key 目前只是登錄在這張表裡，還沒有程式碼真的去讀（見規劃文件的說明：
    這次刻意只做一個真實接點，不是把「功能開關」做成什麼都能接的通用
    中介層）。
    """
    key = models.CharField(max_length=100, unique=True)
    label = models.CharField(max_length=100)
    description = models.CharField(max_length=200, blank=True)
    enabled = models.BooleanField(default=True)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['key']

    def __str__(self):
        return f"{self.key}（{'開' if self.enabled else '關'}）"
