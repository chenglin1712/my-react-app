"""交給 SQLAlchemy 的資料庫連線字串正規化。

專案連 PostgreSQL 用的是 psycopg2（requirements.txt 的 psycopg2-binary）。SQLAlchemy 2.1 起，
沒有指定驅動的 postgresql:// 預設會找 psycopg（第 3 版），沒裝就在 import 時丟 ModuleNotFoundError。
所以這裡一律明確寫成 postgresql+psycopg2://，不依賴 SQLAlchemy 的預設驅動。

Render／Heroku 這類平台慣例給 postgres://，SQLAlchemy 只認 postgresql，也在這裡一併轉換。
Django 那邊用 dj_database_url.parse() 讀 DATABASE_URL，不經過這個函式。
"""
from __future__ import annotations

_PSYCOPG2 = "postgresql+psycopg2://"


def sqlalchemy_url(url: str | None) -> str | None:
    """None 與空字串原樣回傳；已經指定驅動（postgresql+xxx://）或不是 PostgreSQL 的網址不動。"""
    if not url:
        return url
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return _PSYCOPG2 + url[len(prefix):]
    return url
