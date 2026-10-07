"""千詞表對照表（唯讀對照，不是辭典）。

這兩張表只記錄「官方 2026 學習詞表的每個詞形，與辭典目前哪些詞條可能是同一個詞」，以及人對候選的決定。
它們【不會】寫入辭典（dictionary_db）：辭典的新增與補資料另走專用、只增不減的流程（見規劃），那個流程只
讀取這裡「已決定」的列。這樣詞表比對的結果可以重算、可以審查，不會因為字形相同就悄悄改到辭典。

語別（dialect_label）採題庫標示：賽考利克泰雅、秀姑巒阿美、郡群布農、噶瑪蘭、中排灣。
match_class 只是「比對當下的快照」：辭典之後可能被改，所以套用前一律用詞條 id 與內容雜湊重新驗證，
不能直接信任這裡的快照。
"""
from django.db import models
from django.db.models import Q

MATCH_SKIP_PLACEHOLDER = "skip_placeholder"      # 詞表占位項（無此詞彙）
MATCH_MANUAL_MULTIPLE = "manual_multiple"        # 辭典同族語有多筆完全同名
MATCH_SAME_DIALECT = "same_dialect_unique"       # 唯一完全同名，且既有語別明確等於目標語別
MATCH_UNKNOWN_DIALECT = "unknown_dialect_unique"  # 唯一完全同名，但既有語別未標（NULL／空字串）：不能證明是目標語別
MATCH_CROSS_DIALECT = "cross_dialect_unique"     # 唯一完全同名，但既有語別是別的語別
MATCH_NEAR_FORM = "manual_near_form"             # 只差空白／撇號／大小寫／^ :，不可自動合併
MATCH_NEW = "new"                                # 辭典完全沒有
MATCH_CLASSES = (
    MATCH_SKIP_PLACEHOLDER, MATCH_MANUAL_MULTIPLE, MATCH_SAME_DIALECT, MATCH_UNKNOWN_DIALECT,
    MATCH_CROSS_DIALECT, MATCH_NEAR_FORM, MATCH_NEW,
)

DECISION_NONE = ""
DECISION_ACCEPT = "accept"
DECISION_REJECT = "reject"
DECISION_DEFER = "defer"
DECISION_CREATE = "create"   # 辭典沒有這個詞（match_class=new），決定新增；decided_word_id 是決定當下就算好的新詞條 id
DECISIONS = (DECISION_NONE, DECISION_ACCEPT, DECISION_REJECT, DECISION_DEFER, DECISION_CREATE)


class WordlistEntry(models.Model):
    """詞表的一列（一個條目；一格可能含多個以 / 分隔的詞形，見 WordlistForm）。"""
    tribe = models.CharField(max_length=20)
    dialect_label = models.CharField(max_length=20)
    entry_code = models.CharField(max_length=20)            # 官方編號，例如 01-01
    seq = models.PositiveIntegerField()
    level = models.CharField(max_length=10)
    category = models.CharField(max_length=60)
    zh = models.CharField(max_length=200)
    raw_cell = models.CharField(max_length=400)             # 族語欄原文（含 /），不改寫
    note = models.CharField(max_length=400, blank=True)     # 備註欄原文
    source_label = models.CharField(max_length=60)          # 檔頭的版本字樣，例如 2026.07.22修正版
    source_sha256 = models.CharField(max_length=64)         # 來源檔內容雜湊，用來辨識是哪一版檔案
    imported_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['tribe', 'dialect_label', 'seq']
        constraints = [
            models.UniqueConstraint(fields=['tribe', 'dialect_label', 'entry_code'], name='wordlistentry_code_unique'),
        ]
        indexes = [models.Index(fields=['tribe', 'dialect_label', 'seq'])]

    def __str__(self):
        return f"{self.dialect_label}/{self.entry_code}"


class WordlistForm(models.Model):
    """條目中的一個詞形，與它對辭典的比對快照、以及人的決定。"""
    entry = models.ForeignKey(WordlistEntry, on_delete=models.CASCADE, related_name='forms')
    split_index = models.PositiveSmallIntegerField()        # 在原文中以 / 分隔後的位置，從 0 起算
    form = models.CharField(max_length=200)                 # NFC 後的詞形，不去 ^ : 、不改撇號
    match_class = models.CharField(max_length=24)
    # 候選既有詞條快照：[{"word_id", "dialect", "has_explanation"}]，依 word_id 排序、最多 20 筆；
    # candidate_count 是完整候選數，candidates_truncated 為真時 candidates 不是全集（人工決定前必須另查完整候選）。
    # has_explanation 指有 strip 後非空的中文釋義。near_form 的候選沒有 word_id，不可直接當作接受對象。
    candidates = models.JSONField(default=list, blank=True)
    candidate_count = models.PositiveIntegerField(default=0)
    sense_check = models.CharField(max_length=16, blank=True)             # 詞表中文與唯一候選釋義的比對（見 wordlist_mapping.sense_agreement）
    candidate_fingerprint = models.CharField(max_length=64, blank=True)   # 【完整】候選集合的雜湊（見 wordlist_mapping.classify）
    candidates_truncated = models.BooleanField(default=False)
    snapshot_at = models.DateTimeField()
    decision = models.CharField(max_length=10, blank=True, default=DECISION_NONE)
    decided_word_id = models.CharField(max_length=64, blank=True)   # decision=accept 時指定的辭典詞條 id
    decided_by_uid = models.CharField(max_length=128, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    # 決定當時的依據雜湊（見 adminapi/wordlist_mapping.decision_basis）。重跑時依據變了（候選、比對分類、詞表中文／備註、
    # 詞形任一改變）就把 decision_stale 設為真；過期的決定保留供人檢視，但套用流程必須拒絕 decision_stale 的列。
    decision_basis = models.CharField(max_length=64, blank=True)
    decision_stale = models.BooleanField(default=False)

    class Meta:
        ordering = ['entry_id', 'split_index']
        constraints = [
            models.UniqueConstraint(fields=['entry', 'split_index'], name='wordlistform_position_unique'),
            models.CheckConstraint(condition=Q(match_class__in=MATCH_CLASSES), name='wordlistform_match_class_valid'),
            models.CheckConstraint(condition=Q(decision__in=DECISIONS), name='wordlistform_decision_valid'),
            # accept／create 必須指定詞條 id；其他決定不得帶詞條；有決定必須有決定者、時間與依據；沒決定時這些都必須是空的
            models.CheckConstraint(
                condition=(Q(decision__in=['accept', 'create']) & ~Q(decided_word_id=''))
                | (~Q(decision__in=['accept', 'create']) & Q(decided_word_id='')),
                name='wordlistform_accept_needs_word'),
            models.CheckConstraint(
                condition=(Q(decision='') & Q(decided_by_uid='') & Q(decided_at__isnull=True) & Q(decision_basis='') & Q(decision_stale=False))
                | (~Q(decision='') & ~Q(decided_by_uid='') & Q(decided_at__isnull=False) & ~Q(decision_basis='')),
                name='wordlistform_decision_metadata'),
        ]
        indexes = [models.Index(fields=['match_class', 'decision'])]

    def __str__(self):
        return f"{self.entry} #{self.split_index} {self.form}"


JOURNAL_APPEND_SOURCE = "append_source"
JOURNAL_APPEND_EXPLANATION = "append_explanation"
JOURNAL_CREATE_WORD = "create_word"   # before_hash 固定為 "none"；details 記 created（是否真的由這一筆建立）
JOURNAL_ACTIONS = (JOURNAL_APPEND_SOURCE, JOURNAL_APPEND_EXPLANATION, JOURNAL_CREATE_WORD)
JOURNAL_PENDING = "pending"        # 已記錄意圖、辭典可能已寫也可能還沒——任何 pending 都要人先查，指令會拒絕繼續
JOURNAL_APPLIED = "applied"
JOURNAL_REVERTED = "reverted"
JOURNAL_STATUSES = (JOURNAL_PENDING, JOURNAL_APPLIED, JOURNAL_REVERTED)


class WordlistApplyJournal(models.Model):
    """只增不減更新的逐筆操作紀錄（可還原）：每個辭典寫入前先寫一筆 pending，寫入成功後補上寫入後雜湊並改 applied。
    還原只會移除【這一筆】新增的來源連結／釋義，而且只在辭典詞條內容雜湊仍等於 after_hash 時才做（否則視為之後被改過，不動）。"""
    batch_id = models.CharField(max_length=36, db_index=True)
    form = models.ForeignKey(WordlistForm, on_delete=models.PROTECT, related_name='journal')
    action = models.CharField(max_length=20)
    tribe = models.CharField(max_length=20)
    word_id = models.CharField(max_length=64)
    before_hash = models.CharField(max_length=80)
    after_hash = models.CharField(max_length=80, blank=True)
    details = models.JSONField(default=dict, blank=True)    # append_source：{"source_id"}；append_explanation：{"explanation_id","text"}
    status = models.CharField(max_length=10, default=JOURNAL_PENDING)
    actor = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.CheckConstraint(condition=Q(action__in=JOURNAL_ACTIONS), name='wordlistjournal_action_valid'),
            models.CheckConstraint(condition=Q(status__in=JOURNAL_STATUSES), name='wordlistjournal_status_valid'),
            # 狀態與欄位一致：pending 沒有寫入後雜湊與時間；applied 必須有；reverted 必須有還原時間
            models.CheckConstraint(
                condition=(Q(status='pending') & Q(after_hash='') & Q(applied_at__isnull=True) & Q(reverted_at__isnull=True))
                | (Q(status='applied') & ~Q(after_hash='') & Q(applied_at__isnull=False) & Q(reverted_at__isnull=True))
                | (Q(status='reverted') & ~Q(after_hash='') & Q(applied_at__isnull=False) & Q(reverted_at__isnull=False)),
                name='wordlistjournal_status_fields'),
            # 同一個詞形的同一種動作，未還原的紀錄只能有一筆（還原後才能重做）
            models.UniqueConstraint(fields=['form', 'action'], condition=~Q(status='reverted'), name='wordlistjournal_one_live_per_action'),
        ]
        indexes = [models.Index(fields=['status', 'batch_id'])]
