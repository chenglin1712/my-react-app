"""單例 model（IrtConfig／GameConfig／HomepageConfig／
ExamScheduleCrawlStatus／AnnouncementSyncStatus）共用的基底（P4 review
BE-23）：原本每個 model 各自重複「load() → get_or_create(pk=1)」，
singleton 語意完全只靠「大家都乖乖走 load()」這個慣例維持，資料庫本身
仍然允許 pk != 1 的第二筆存在（例如未來某處程式碼不小心呼叫
`Model.objects.create()` 而非 `Model.load()`）。

save() 覆寫成一律把 pk 強制設成 1——不管呼叫端傳了什麼 pk 進來，任何一次
.save()／.objects.create() 最終都只會落在同一列，singleton 因此變成
ORM 這一層結構上就不可能違反的保證，不再只是「大家都用 load()」的約定。

首次併發建立的競態（兩個 request 同時發現不存在、都嘗試 create）不需要
額外處理：Django 的 QuerySet.get_or_create() 本身已經會在 create 撞到
IntegrityError 時自動改成重新 get() 一次（見 django/db/models/query.py），
輸家不會真的收到未捕捉的例外，這裡沿用 get_or_create() 就已經是安全的。
"""
from django.db import models


class SingletonModel(models.Model):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
