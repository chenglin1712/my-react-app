"""0034：既有審核事件的摘錄一次清空，事件本身保留（S-17）。"""
import importlib

from django.apps import apps
from django.test import TestCase

from adminapi.models import AiModerationEvent


class ClearModerationExcerptsMigrationTest(TestCase):
    def test_excerpts_are_blanked_but_events_remain(self):
        AiModerationEvent.objects.create(uid_hash="a" * 32, intent="unsafe", action="fixed", excerpt="舊的安全類原文")
        AiModerationEvent.objects.create(uid_hash="b" * 32, intent="off_topic", action="gentle", excerpt="舊的 80 字摘錄")
        migration = importlib.import_module("adminapi.migrations.0034_clear_moderation_excerpts")
        migration.clear_excerpts(apps, None)
        self.assertEqual(AiModerationEvent.objects.count(), 2)
        self.assertEqual(set(AiModerationEvent.objects.values_list("excerpt", flat=True)), {""})
        self.assertEqual(set(AiModerationEvent.objects.values_list("intent", flat=True)), {"unsafe", "off_topic"})
