"""匯入／匯出 bundle 共用的分類主檔對照——resolver（名稱→id）跟
exporter（id→名稱）都需要同一份「四種分類主檔 kind 對應哪個 SQLAlchemy
model」的表，集中在這裡避免兩邊各自維護一份容易漂移。"""
from dictionary_db import model as m

_TAXONOMY_MODEL_BY_KIND = {
    "source": m.Source, "category": m.Category, "part_of_speech": m.PartOfSpeech, "focus": m.Focus,
}
