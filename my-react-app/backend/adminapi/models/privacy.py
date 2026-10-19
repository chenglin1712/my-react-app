from django.db import models

from ..article_doc import validate_article_doc
from ._singleton import SingletonModel


class PrivacyPolicy(SingletonModel):
    """「隱私與資料」頁的內文，單例（永遠只有一筆，pk 固定用 1，見 SingletonModel.load()）。

    內文是與本期專題文章同一套編輯器產生的文件（TipTap JSON），驗證與前台渲染也共用：
    只收白名單內的節點，前台逐節點渲染，沒有任何 HTML 字串。標題、導言與頁面骨架留在前端，
    後台只管正文，避免改壞版面。首次部署時由 migration 填入目前實際運作的說明文字。
    """
    content = models.JSONField(default=dict, blank=True, validators=[validate_article_doc])
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return "隱私與資料頁內文"
