"""內容審核事件的記錄（路線圖 #28）：被攔下或被引導的訊息，供後台檢視誤攔與漏攔。

隱私：不存 uid（單向雜湊）、只存訊息開頭 80 字的摘錄（先遮掉長數字與電子郵件）、保存 30 天（見 adminapi/models/ai_assistant.py）。
記錄失敗只寫 log，絕不影響回覆。正常通過的訊息不記。
"""
import datetime
import logging
import re

from django.utils import timezone

logger = logging.getLogger(__name__)

EXCERPT_LEN = 80
# 對象可能是未成年人：摘錄先遮掉長數字（電話、證號）與電子郵件再存
_DIGITS = re.compile(r"\d[\d\s\-]{4,}\d")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")


def _excerpt(text) -> str:
    clean = " ".join(str(text or "").split())
    clean = _EMAIL.sub("＊", _DIGITS.sub("＊", clean))
    return clean[:EXCERPT_LEN]


def record(uid: str, intent: str, action: str, text: str, tribe: str = "") -> None:
    """記一筆審核事件。任何失敗都吞掉。"""
    try:
        from adminapi.models import AiModerationEvent

        from .feedback import hash_uid

        AiModerationEvent.objects.create(
            uid_hash=hash_uid(uid or ""), intent=intent, action=action, excerpt=_excerpt(text), tribe=(tribe or "")[:20],
        )
    except Exception:
        logger.warning("[AIModel] 記錄內容審核事件失敗（不影響回覆）", exc_info=True)


def purge_old(days: int | None = None) -> int:
    """刪除超過保存期限的事件，回傳刪除筆數。"""
    from adminapi.models import AiModerationEvent
    from adminapi.models.ai_assistant import MODERATION_RETENTION_DAYS

    cutoff = timezone.now() - datetime.timedelta(days=MODERATION_RETENTION_DAYS if days is None else days)
    deleted, _ = AiModerationEvent.objects.filter(created_at__lt=cutoff).delete()
    return deleted
