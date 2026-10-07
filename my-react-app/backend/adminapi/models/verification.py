"""待專家驗證佇列（M5）的資料表。獨立的 Django 表，刻意不放 dictionary_db：這裡的內容是「待專家看的候選」與「工作人員／外部審核者
的意見」，審核流程、權限與稽核都在 Django；意見【不會】寫回辭典或測驗干擾項（見 adminapi/verification_service.py 開頭的邊界說明）。

名詞（刻意避開「已驗證」）：項目 VerificationItem 永遠是「待專家驗證」的候選；VerificationReview 是某人對它的一筆意見
（agree／disagree／uncertain），不是驗證結果。項目本身不存狀態，狀態由意見即時推導（見 verification_service.review_state）。

key 的語意：項目是「概念」（同一個族語＋種類＋詞形＋提案），key 由它們的規範化內容算出，與來源無關；同一個項目在不同次報告
再次出現時，不會重複建立，而是在 VerificationObservation 新增（或更新）一筆觀測，保留每一份來源報告的統計。
"""
from django.db import models
from django.db.models import Q

KIND_UNMATCHED_FORM = "unmatched_form"      # 例句裡高頻、辭典詞條對不到的詞形：這是不是正確的族語詞？
KIND_MORPH_ANALYSIS = "morph_analysis"      # 詞形分析器對某個衍生詞給的詞根：這個分析正確嗎？
KINDS = (KIND_UNMATCHED_FORM, KIND_MORPH_ANALYSIS)

VERDICT_AGREE = "agree"
VERDICT_DISAGREE = "disagree"
VERDICT_UNCERTAIN = "uncertain"
VERDICTS = (VERDICT_AGREE, VERDICT_DISAGREE, VERDICT_UNCERTAIN)

OBSERVATION_SOURCES = ("coverage", "benchmark")

REVIEWER_STAFF = "staff"        # 登入後台的工作人員，subject 是 Firebase uid
REVIEWER_EXTERNAL = "external"  # CSV 匯入的外部審核者，subject 是標籤正規化後的雜湊（不是身分證明）
REVIEWER_TYPES = (REVIEWER_STAFF, REVIEWER_EXTERNAL)


class VerificationItem(models.Model):
    key = models.CharField(max_length=64, unique=True, editable=False)
    tribe = models.CharField(max_length=20)
    kind = models.CharField(max_length=20)
    form = models.CharField(max_length=200)
    # unmatched_form：永遠 null；morph_analysis：{"predicted_root", "rule", "gold_roots"}（已檢查格式、gold_roots 已排序去重）
    proposal = models.JSONField(null=True, blank=True)
    created_by_uid = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['tribe', 'kind', 'created_at', 'id']),
            models.Index(fields=['kind', 'created_at', 'id']),
            models.Index(fields=['created_at', 'id']),      # 不篩選時的預設排序（新到舊）
        ]
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=KINDS), name='verificationitem_kind_valid'),
        ]

    def __str__(self):
        return f"{self.tribe}/{self.kind}/{self.form}"


class VerificationObservation(models.Model):
    """項目在某一份來源報告裡的統計（只有詞形與計數；不存句子、句子 ID 或任何可回推句子的內容）。"""
    item = models.ForeignKey(VerificationItem, on_delete=models.CASCADE, related_name='observations')
    source = models.CharField(max_length=20)             # coverage｜benchmark
    report_version = models.PositiveSmallIntegerField()
    report_label = models.CharField(max_length=40)       # 來源檔內容雜湊的前綴，用來分辨不同次報告
    occurrence_count = models.PositiveIntegerField()     # 詞次
    sentence_count = models.PositiveIntegerField()       # 出現在幾個句子（是「數量」，不是句子本身）
    list_size = models.PositiveIntegerField()            # 來源報告當時列出了幾筆（報告只列樣本，不是完整母體；不是設定的上限）
    observed_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-observed_at', '-id']
        constraints = [
            models.UniqueConstraint(fields=['item', 'source', 'report_label'], name='uniq_verificationobservation'),
            models.CheckConstraint(condition=Q(source__in=OBSERVATION_SOURCES), name='verificationobservation_source_valid'),
            models.CheckConstraint(condition=Q(report_version__gt=0) & Q(list_size__gt=0), name='verificationobservation_positive'),
            models.CheckConstraint(condition=~Q(report_label=''), name='verificationobservation_label_nonempty'),
            models.CheckConstraint(condition=Q(sentence_count__lte=models.F('occurrence_count')), name='verificationobservation_counts'),
        ]


class VerificationReview(models.Model):
    item = models.ForeignKey(VerificationItem, on_delete=models.CASCADE, related_name='reviews')
    reviewer_type = models.CharField(max_length=10)
    reviewer_subject = models.CharField(max_length=128)
    reviewer_label = models.CharField(max_length=64)        # 顯示用（外部審核者是 CSV 的原始標籤）；不是身分證明
    entered_by_uid = models.CharField(max_length=128)       # 實際操作的登入者（匯入時是匯入者，不是外部審核者）
    verdict = models.CharField(max_length=10)
    correction = models.CharField(max_length=200, blank=True)
    # NFC＋casefold＋空白收斂，用來在資料庫端判斷建議是否互斥。casefold 會讓字串變長（例如 ß → ss、İ → i̇，最多約 3 倍），
    # 所以長度上限是原文上限的 3 倍，不能與 correction 同為 200，否則 PostgreSQL 會在寫入時拒絕。
    correction_norm = models.CharField(max_length=600, blank=True)
    dialect = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        indexes = [
            models.Index(fields=['item', 'verdict']),
            models.Index(fields=['reviewer_type', 'reviewer_subject']),
        ]
        constraints = [
            models.UniqueConstraint(fields=['item', 'reviewer_type', 'reviewer_subject'], name='uniq_verificationreview_reviewer'),
            models.CheckConstraint(condition=Q(verdict__in=VERDICTS), name='verificationreview_verdict_valid'),
            models.CheckConstraint(condition=Q(reviewer_type__in=REVIEWER_TYPES), name='verificationreview_type_valid'),
            models.CheckConstraint(condition=~Q(reviewer_subject=''), name='verificationreview_subject_nonempty'),
        ]
