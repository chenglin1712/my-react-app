"""adminapi 的請求驗證與序列化。

Announcement 用 ModelSerializer（不像 CrosswordPuzzle/serializers.py 那樣手寫
serializers.Serializer）：這個資源欄位數量多、CRUD 語意單純，手動維護一份
跟 model 定義幾乎一模一樣的欄位清單只會增加兩邊漂移的風險，ModelSerializer
直接從 model 反推欄位定義，這裡只需要額外收斂寫入時的驗證規則。
"""
from rest_framework import serializers

from config.tribes import TRIBE_IDS

from .models import Announcement, AuditLog


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = [
            'id', 'title', 'body', 'category', 'tribes', 'cover_image_url',
            'link_url', 'is_pinned', 'pin_until', 'publish_at', 'unpublish_at',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment',
            'created_at', 'updated_at',
        ]
        # 狀態機欄位（status 以下）一律由 views.py 的動作端點（submit/approve/
        # reject/...）改，不開放透過一般的 create/update 直接寫入——不然
        # editor 可以自己把 status 設成 published，繞過核准流程。
        read_only_fields = [
            'id', 'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment',
            'created_at', 'updated_at',
        ]

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError('標題不能空白')
        return value

    def validate_tribes(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('tribes 必須是陣列')
        invalid = [t for t in value if t not in TRIBE_IDS]
        if invalid:
            raise serializers.ValidationError(f'不支援的族語：{", ".join(invalid)}')
        return value

    def validate(self, data):
        # is_pinned/pin_until、publish_at/unpublish_at 這兩組跨欄位規則
        # model.clean() 也有一份一樣的檢查（見 models.py 的說明：確保未來
        # 就算繞過 serializer 直接用 ORM 操作也擋得住）；這裡在 API 層先擋一次，
        # 讓錯誤能回傳成一般的 400 + 欄位訊息，而不是 model.clean() 丟出的
        # ValidationError 一路往外拋變成 500。
        is_pinned = data.get('is_pinned', getattr(self.instance, 'is_pinned', False))
        pin_until = data.get('pin_until', getattr(self.instance, 'pin_until', None))
        if is_pinned and not pin_until:
            raise serializers.ValidationError({'pin_until': '置頂必須設定到期日'})

        publish_at = data.get('publish_at', getattr(self.instance, 'publish_at', None))
        unpublish_at = data.get('unpublish_at', getattr(self.instance, 'unpublish_at', None))
        if unpublish_at and publish_at and unpublish_at <= publish_at:
            raise serializers.ValidationError({'unpublish_at': '下架時間必須晚於發布時間'})
        return data


class RejectSerializer(serializers.Serializer):
    # 退件一定要附理由，不然送審者不知道要改哪裡——跟前端原型「審查意見：
    # 退件時必填」的規格一致。
    review_comment = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_review_comment(self, value):
        if not value.strip():
            raise serializers.ValidationError('退件必須填寫審查意見')
        return value


class ApproveSerializer(serializers.Serializer):
    # 核准時的意見是選填備註，不像退件那樣強制。
    review_comment = serializers.CharField(max_length=1000, allow_blank=True, required=False, default='')


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        # 純讀取用途（見 views.py 的 audit_log_list，僅 ACCOUNT_MANAGERS 可讀），
        # 不需要 read_only_fields——這個 serializer 不會被用來接收寫入。
        fields = [
            'id', 'actor_uid', 'actor_role', 'action', 'target_type', 'target_id',
            'before', 'after', 'ip_address', 'user_agent', 'created_at',
        ]
