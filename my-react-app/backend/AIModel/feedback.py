"""AI 助手回覆的使用者回饋（路線圖 #30）：驗證、去識別化、儲存。

學生對某一則回覆按讚或倒讚（倒讚可選原因與一句說明）。為了讓管理者之後看得到「是哪一則回覆、當時用哪個模型與
提示詞版本」，請求要帶回覆文字與它的簽章（services.sign_reply）：簽章對得上才收，所以回饋一定是針對
助手真的說過的話，不能拿別人的話或捏造的內容灌進後台。其餘欄位（問題文字、模型、版本、request id）是前端帶回來的
標註，只用於這位學生自己的那一筆回饋，內容不被信任也不影響任何其他人，只做格式與長度限制。
"""
import datetime
import hashlib
import hmac

from django.conf import settings
from rest_framework import serializers

from adminapi.models.ai_feedback import REASONS, RATING_DOWN, RATING_UP
from config.tribes import TRIBE_IDS

from .services import sign_reply

FLAG_KEY = "ai_feedback_enabled"


def feedback_enabled() -> bool:
    """功能旗標（預設關閉、查不到也視為關閉）。"""
    from adminapi.models import FeatureFlag

    flag = FeatureFlag.objects.filter(key=FLAG_KEY).first()
    return bool(flag is not None and flag.enabled)


def hash_uid(uid: str) -> str:
    """單向雜湊（綁定這個站台的金鑰）：同一個人永遠得到同一個值，但無法從值反推出 uid。"""
    key = hashlib.sha256(settings.SECRET_KEY.encode("utf-8") + b"|ai-feedback-uid-v1").digest()
    return hmac.new(key, uid.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


class FeedbackSerializer(serializers.Serializer):
    rating = serializers.ChoiceField(choices=[RATING_UP, RATING_DOWN])
    reason = serializers.ChoiceField(choices=list(REASONS), required=False, allow_blank=True, default="")
    comment = serializers.CharField(max_length=300, required=False, allow_blank=True, default="", trim_whitespace=True)
    question_text = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)
    reply_text = serializers.CharField(max_length=2000, allow_blank=False, trim_whitespace=False)
    sig = serializers.RegexField(r"^[0-9a-f]{64}$")
    tribe = serializers.ChoiceField(choices=list(TRIBE_IDS), required=False, default="tayal")
    request_id = serializers.RegexField(r"^[A-Za-z0-9_\-]{0,80}$", required=False, allow_blank=True, default="")
    model = serializers.RegexField(r"^[A-Za-z0-9._\-]{0,80}$", required=False, allow_blank=True, default="")
    prompt_version = serializers.RegexField(r"^[0-9a-f]{0,16}$", required=False, allow_blank=True, default="")

    def validate(self, attrs):
        # 原因與說明只有倒讚才有意義；讚不存原因，避免前端狀態殘留造成誤導
        if attrs["rating"] == RATING_UP:
            attrs["reason"], attrs["comment"] = "", ""
        # reply_text 用的是回覆原文（簽章簽的是 strip 後的內容，見 services.sign_reply）
        uid = self.context["uid"]
        expected = sign_reply(uid, attrs["reply_text"])
        if not hmac.compare_digest(attrs["sig"].encode("ascii"), expected.encode("ascii")):
            raise serializers.ValidationError("回覆內容與簽章不符")
        return attrs


def verified_call(uid: str, request_id: str) -> tuple[str, str]:
    """用量紀錄查得到「這位使用者的這個 request id」才採信，並以紀錄裡的模型為準；查不到就當作沒有。
    request id 和模型是前端帶回來的，不查證的話，學生可以讓後台看到與實際請求無關的追溯資訊。
    （用量紀錄是盡力寫入的：偶爾寫入失敗的回覆會顯示「未記錄」，寧缺勿錯。）"""
    from adminapi.models import AiUsageLog

    log = AiUsageLog.objects.filter(uid=uid, request_id=request_id).order_by("-id").first()
    return (log.model, request_id) if log else ("", "")


def purge_expired_daily() -> None:
    """保存期限不能只靠有人記得排程：有人送回饋時，每天順手清一次過期的（cache.add 保證一天只做一次）。
    排程跑 purge_ai_feedback 仍然建議，這裡是不依賴它的底線。"""
    from django.core.cache import cache
    from django.utils import timezone

    from adminapi.models import AiFeedback
    from adminapi.models.ai_feedback import RETENTION_DAYS

    if cache.add("ai_feedback_purge_done", 1, 24 * 3600):
        AiFeedback.objects.filter(created_at__lt=timezone.now() - datetime.timedelta(days=RETENTION_DAYS)).delete()
