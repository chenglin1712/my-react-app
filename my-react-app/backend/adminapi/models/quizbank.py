import re

from django.core.exceptions import ValidationError
from django.db import models

from config.tribes import TRIBES

_TRIBE_CHOICES = [(t.slug, t.full_name) for t in TRIBES]


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
