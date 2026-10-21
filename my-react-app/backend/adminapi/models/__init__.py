"""adminapi 的 Model 定義依領域拆成子模組（見各檔案），這個套件本身仍是
單一個 Django app（app_label 不變，仍是 'adminapi'——Django 是用
INSTALLED_APPS 對應到的 app 套件路徑決定 app_label，不是看 models.py
是不是單一檔案），既有 migration 與 db_table 名稱因此完全不受影響。

這裡把每個子模組的 public model 全部重新匯出，讓專案裡既有的
`from adminapi.models import X`／`from .models import X` 全部維持原樣、
不必逐一改寫呼叫點。
"""

from .ai_usage import AiUsageLog
from .ai_quota import AiDailyUsage
from .analytics import UsageEvent
from .audit import AuditLog
from .content import (
    Announcement,
    AnnouncementSyncStatus,
    ExamScheduleCrawlStatus,
    ExamScheduleOverride,
    FeaturedTopic,
    HomepageConfig,
    PendingRevision,
    PromoMediaOrphan,
    PromoVideo,
)
from .dictionary_review import DictionaryImportJob, DictionaryRevision
from .guest_trial import GuestTranslationUsage
from .quiz_research import QuizResearchConsent, QuizSkillEvent
from .site_pages import ContactPage, PrivacyPolicy
from .quizbank import (
    QuizChoiceItem,
    QuizClozePassage,
    QuizSituationItem,
    QuizSourceConfig,
    QuizTrueFalseItem,
    QuizVocabItem,
    ReviewableContent,
)
from .system_config import FeatureFlag, GameConfig, IrtConfig, RateLimitRule
from .verification import VerificationItem, VerificationObservation, VerificationReview
from .wordlist import WordlistApplyJournal, WordlistEntry, WordlistForm

__all__ = [
    'AiUsageLog',
    'AiDailyUsage',
    'Announcement',
    'AnnouncementSyncStatus',
    'AuditLog',
    'ContactPage',
    'DictionaryImportJob',
    'DictionaryRevision',
    'ExamScheduleCrawlStatus',
    'ExamScheduleOverride',
    'FeatureFlag',
    'GuestTranslationUsage',
    'GameConfig',
    'HomepageConfig',
    'IrtConfig',
    'PendingRevision',
    'PrivacyPolicy',
    'PromoVideo',
    'QuizChoiceItem',
    'QuizClozePassage',
    'QuizSituationItem',
    'QuizSourceConfig',
    'QuizTrueFalseItem',
    'QuizResearchConsent',
    'QuizSkillEvent',
    'QuizVocabItem',
    'RateLimitRule',
    'ReviewableContent',
    'UsageEvent',
    'VerificationItem',
    'VerificationObservation',
    'VerificationReview',
    'WordlistApplyJournal',
    'WordlistEntry',
    'WordlistForm',
]
