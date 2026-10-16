"""本期專題「轉為已發布」的唯一程式路徑（HOMEPAGE_CONTRACT.md 3.3）。

核准與重新發布都經過 publish_topic()；沒有第二條路徑可以直接把 status 改成 published，
Django admin 也不註冊 FeaturedTopic。編輯已發布的專題走 PendingRevision，狀態本來就是已發布，
不改變已發布筆數，所以不經過這裡（核准時由 revisions.py 對模型做 full_clean() 重新驗證）。

鎖順序固定：先鎖 HomepageConfig 單例列，再鎖該筆專題。「最多 3 筆已發布」是跨列的規則，
單鎖專題那一列擋不住兩個不同專題同時被核准；鎖同一把單例列才能讓所有發布動作排隊。
刪除、下架、撤回只鎖專題那一列，不需要拿單例列的鎖，所以不會形成相反順序的死結。
"""
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .models import FeaturedTopic, HomepageConfig
from .serializers import FeaturedTopicSerializer

# 核准與重新發布時，不屬於「內容」的欄位不參與重新驗證
_NON_CONTENT_FIELDS = [
    "status", "created_by", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at",
    "review_comment", "deleted_at", "deleted_by",
]


class InvalidState(Exception):
    def __init__(self, current_status):
        self.current_status = current_status


class PublishLimitReached(Exception):
    def __init__(self, titles):
        self.titles = titles


class ContentInvalid(Exception):
    def __init__(self, errors):
        self.errors = errors


def lock_topic(pk):
    """在交易內取得列鎖後、未被軟刪除的專題。呼叫端必須已在 transaction.atomic() 裡。"""
    return get_object_or_404(FeaturedTopic.live.select_for_update(), pk=pk)


def publish_topic(pk, *, expected_status, actor_uid, record_review=False, review_comment=""):
    """把專題轉為已發布，回傳 (專題, 轉換前快照)。必須在 transaction.atomic() 裡呼叫。

    轉換前快照在取得鎖之後才擷取，稽核紀錄的 before 才會是真正被改掉的那個版本。

    expected_status：核准傳 STATUS_PENDING_REVIEW，重新發布傳 STATUS_UNPUBLISHED。
    actor_uid：發布是治理行為，一定要有操作者（呼叫端傳入已通過角色檢查的使用者 id）。
    record_review：核准時為 True，會寫 reviewed_by、reviewed_at、review_comment；
    重新發布不更動審核紀錄，與公告一致。
    """
    HomepageConfig.load()  # 確保單例列存在，才有列可鎖
    HomepageConfig.objects.select_for_update().get(pk=1)
    topic = lock_topic(pk)
    if topic.status != expected_status:
        raise InvalidState(topic.status)

    # 重新計算已發布筆數並排除目前這一筆
    others = list(
        FeaturedTopic.live.filter(status=FeaturedTopic.STATUS_PUBLISHED)
        .exclude(pk=topic.pk).order_by("sort_order", "pk").values_list("title", flat=True)
    )
    if len(others) >= FeaturedTopic.MAX_PUBLISHED:
        raise PublishLimitReached(others)

    # 重新驗證內容：驗證規則可能在送審之後變嚴（例如設定了 Cloudinary 帳號名稱），
    # 不能讓過期的資料直接上線。
    try:
        topic.full_clean(exclude=_NON_CONTENT_FIELDS)
    except ValidationError as exc:
        raise ContentInvalid(exc.message_dict)

    before = FeaturedTopicSerializer(topic).data
    topic.status = FeaturedTopic.STATUS_PUBLISHED
    fields = ["status", "updated_at"]
    if not actor_uid:
        raise ValueError("publish_topic 需要操作者 id")
    if record_review:
        topic.reviewed_by = actor_uid
        topic.reviewed_at = timezone.now()
        topic.review_comment = review_comment
        fields += ["reviewed_by", "reviewed_at", "review_comment"]
    topic.save(update_fields=fields)
    return topic, before
