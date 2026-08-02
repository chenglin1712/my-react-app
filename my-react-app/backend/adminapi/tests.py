from datetime import timedelta

from django.test import TestCase

from .models import AuditLog


class AuditLogTests(TestCase):
    def create_audit_log(self, **overrides):
        values = {
            'actor_uid': 'firebase-user-123',
            'actor_role': 'admin',
            'action': 'update',
            'target_type': 'announcement',
            'target_id': 'announcement-456',
        }
        values.update(overrides)
        return AuditLog.objects.create(**values)

    def test_create_audit_log(self):
        audit_log = self.create_audit_log()

        self.assertIsNotNone(audit_log.pk)
        self.assertIsNotNone(audit_log.created_at)

    def test_str_format(self):
        audit_log = self.create_audit_log()

        self.assertEqual(
            str(audit_log),
            f"{audit_log.created_at} firebase-user-123 update "
            "announcement:announcement-456",
        )

    def test_default_ordering_is_newest_first(self):
        older = self.create_audit_log(target_id='older')
        newer = self.create_audit_log(target_id='newer')
        AuditLog.objects.filter(pk=older.pk).update(
            created_at=newer.created_at - timedelta(seconds=1)
        )

        self.assertEqual(list(AuditLog.objects.all()), [newer, older])

    def test_ordering_falls_back_to_pk_when_created_at_ties(self):
        # 上一個測試用 1 秒時間差驗證排序，測不到 Meta.ordering 加 -pk 這件事
        # 本身有沒有生效——這裡強制兩筆的 created_at 完全相同，只靠 -pk 決定
        # 順序，才是這波修正原本要解決的情境（同一批次快速寫入時間戳記撞在一起）。
        older = self.create_audit_log(target_id='older')
        newer = self.create_audit_log(target_id='newer')
        AuditLog.objects.filter(pk=older.pk).update(created_at=newer.created_at)

        self.assertEqual(list(AuditLog.objects.all()), [newer, older])

    def test_json_snapshots_round_trip(self):
        before = {'title': '舊標題', 'published': False}
        after = {'title': '新標題', 'published': True}
        audit_log = self.create_audit_log(before=before, after=after)

        saved = AuditLog.objects.get(pk=audit_log.pk)
        self.assertEqual(saved.before, before)
        self.assertEqual(saved.after, after)
