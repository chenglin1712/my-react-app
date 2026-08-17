"""adminapi 的請求驗證與序列化，依領域拆成子模組（P4 review BE-17，原本
574 行全部塞在單一 serializers.py）：

- audit.py：AuditLog（純讀取）
- content.py：Announcement／首頁版位／考試時程覆寫，以及送審流程共用的
  Reject/Approve serializer
- quizbank.py：5 種題庫內容型別
- system_config.py：IRT／遊戲參數／限流規則／功能開關

這個 __init__.py 把每個子模組的 public serializer 全部重新匯出，讓既有的
`from .serializers import X` 呼叫點維持原樣、不必逐一改寫。
"""
from .audit import AuditLogSerializer
from .content import (
    AnnouncementSerializer,
    ApproveSerializer,
    ExamScheduleOverrideSerializer,
    HomepageConfigSerializer,
    PublicAnnouncementSerializer,
    PublicHomepageConfigSerializer,
    RejectSerializer,
)
from .quizbank import (
    QuizChoiceItemSerializer,
    QuizClozePassageSerializer,
    QuizSituationItemSerializer,
    QuizSourceConfigSerializer,
    QuizTrueFalseItemSerializer,
    QuizVocabItemSerializer,
)
from .system_config import (
    FeatureFlagSerializer,
    GameConfigSerializer,
    IrtConfigSerializer,
    PublicGameConfigSerializer,
    PublicIrtConfigSerializer,
    RateLimitRuleSerializer,
)

__all__ = [
    'AnnouncementSerializer',
    'ApproveSerializer',
    'AuditLogSerializer',
    'ExamScheduleOverrideSerializer',
    'FeatureFlagSerializer',
    'GameConfigSerializer',
    'HomepageConfigSerializer',
    'IrtConfigSerializer',
    'PublicAnnouncementSerializer',
    'PublicGameConfigSerializer',
    'PublicHomepageConfigSerializer',
    'PublicIrtConfigSerializer',
    'QuizChoiceItemSerializer',
    'QuizClozePassageSerializer',
    'QuizSituationItemSerializer',
    'QuizSourceConfigSerializer',
    'QuizTrueFalseItemSerializer',
    'QuizVocabItemSerializer',
    'RateLimitRuleSerializer',
    'RejectSerializer',
]
