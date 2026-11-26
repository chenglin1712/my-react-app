from rest_framework import serializers

from ..models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    # WP-8 追加：儀表板「最近操作」原本只顯示 actor_uid，看不出是誰。姓名由呼叫端先用
    # user_names.lookup_user_names() 批次查好放進 context["actor_names"]（避免逐筆查 Firebase），
    # 沒有或查不到時回空字串，前端退回顯示縮短的 uid。
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        # 純讀取用途（見 views.py 的 audit_log_list，僅 ACCOUNT_MANAGERS 可讀），
        # 不需要 read_only_fields——這個 serializer 不會被用來接收寫入。
        fields = [
            'id', 'actor_uid', 'actor_name', 'actor_role', 'action', 'target_type', 'target_id',
            'before', 'after', 'ip_address', 'user_agent', 'created_at',
        ]

    def get_actor_name(self, obj):
        return (self.context.get('actor_names') or {}).get(obj.actor_uid, '')
