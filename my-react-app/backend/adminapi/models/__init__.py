"""adminapi 的 Model 定義依領域拆成子模組（見各檔案），這個套件本身仍是
單一個 Django app（app_label 不變，仍是 'adminapi'——Django 是用
INSTALLED_APPS 對應到的 app 套件路徑決定 app_label，不是看 models.py
是不是單一檔案），既有 migration 與 db_table 名稱因此完全不受影響。

這裡把每個子模組的 public model 全部重新匯出，讓專案裡既有的
`from adminapi.models import X`／`from .models import X` 全部維持原樣、
不必逐一改寫呼叫點。
"""

from .analytics import UsageEvent
from .audit import AuditLog
from .content import (
    Announcement,
    AnnouncementSyncStatus,
    ExamScheduleCrawlStatus,
    ExamScheduleOverride,
    HomepageConfig,
    PendingRevision,
)
from .dictionary_review import DictionaryImportJob, DictionaryRevision
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

__all__ = [
    'Announcement',
    'AnnouncementSyncStatus',
    'AuditLog',
    'DictionaryImportJob',
    'DictionaryRevision',
    'ExamScheduleCrawlStatus',
    'ExamScheduleOverride',
    'FeatureFlag',
    'GameConfig',
    'HomepageConfig',
    'IrtConfig',
    'PendingRevision',
    'QuizChoiceItem',
    'QuizClozePassage',
    'QuizSituationItem',
    'QuizSourceConfig',
    'QuizTrueFalseItem',
    'QuizVocabItem',
    'RateLimitRule',
    'ReviewableContent',
    'UsageEvent',
]
