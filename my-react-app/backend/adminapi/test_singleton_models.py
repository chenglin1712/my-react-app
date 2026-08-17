"""P4 review BE-23：IrtConfig／GameConfig／HomepageConfig／
ExamScheduleCrawlStatus／AnnouncementSyncStatus 共用的 SingletonModel 基底
（見 adminapi/models/_singleton.py）。這裡不重複測每個具體 model 的業務
欄位，只證明「不管怎麼呼叫，最終都只會有 pk=1 這一筆」這個不變量真的在
ORM 層被強制住，不是只靠大家都乖乖呼叫 load() 的約定。
"""
from django.test import TestCase

from .models import AnnouncementSyncStatus, ExamScheduleCrawlStatus, GameConfig, HomepageConfig, IrtConfig

_SINGLETON_MODELS = [IrtConfig, GameConfig, HomepageConfig, ExamScheduleCrawlStatus, AnnouncementSyncStatus]


class SingletonModelSaveForcesPkTest(TestCase):
    def test_load_creates_row_with_pk_1(self):
        for model in _SINGLETON_MODELS:
            with self.subTest(model=model.__name__):
                obj = model.load()
                self.assertEqual(obj.pk, 1)
                self.assertEqual(model.objects.count(), 1)

    def test_load_is_idempotent_and_returns_same_row(self):
        for model in _SINGLETON_MODELS:
            with self.subTest(model=model.__name__):
                first = model.load()
                second = model.load()
                self.assertEqual(first.pk, second.pk)
                self.assertEqual(model.objects.count(), 1)

    def test_explicitly_constructing_with_a_different_pk_still_lands_on_pk_1(self):
        """就算呼叫端明確傳了別的 pk（不管是不小心還是刻意），save() 仍然
        會強制落在 pk=1——資料庫因此結構上不可能出現第二筆單例列。"""
        for model in _SINGLETON_MODELS:
            with self.subTest(model=model.__name__):
                model.load()  # 先確保 pk=1 那筆已經存在
                rogue = model(pk=42)
                rogue.save()
                self.assertEqual(rogue.pk, 1)
                self.assertEqual(model.objects.count(), 1)
                self.assertEqual(list(model.objects.values_list("pk", flat=True)), [1])

    def test_create_without_explicit_pk_also_lands_on_pk_1(self):
        for model in _SINGLETON_MODELS:
            with self.subTest(model=model.__name__):
                obj = model.objects.create()
                self.assertEqual(obj.pk, 1)
                self.assertEqual(model.objects.count(), 1)
