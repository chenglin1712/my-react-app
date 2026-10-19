import adminapi.article_doc
from django.db import migrations, models


def _text(value):
    return {"type": "text", "text": value}


def _link(value, href):
    return {"type": "text", "text": value, "marks": [{"type": "link", "attrs": {"href": href}}]}


def _p(*parts):
    return {"type": "paragraph", "content": [_text(p) if isinstance(p, str) else p for p in parts]}


def _h(value):
    return {"type": "heading", "attrs": {"level": 2}, "content": [_text(value)]}


def default_doc():
    """與改版前的「聯絡我們」頁相同：尚未設定公開信箱時只說明籌備中，並指向使用說明與隱私頁。
    之後由後台維護，要放信箱就在「聯絡方式」下面寫上並加上 mailto 連結。"""
    return {"type": "doc", "content": [
        _h("聯絡方式"),
        _p("聯絡方式籌備中。"),
        _h("先看看這些"),
        _p(_link("使用說明", "/help"), "與", _link("隱私與資料", "/privacy"), "可能已經回答你的問題。"),
    ]}


def seed_default(apps, schema_editor):
    ContactPage = apps.get_model("adminapi", "ContactPage")
    ContactPage.objects.get_or_create(pk=1, defaults={"content": default_doc()})


class Migration(migrations.Migration):

    dependencies = [
        ("adminapi", "0026_privacy_policy"),
    ]

    operations = [
        migrations.CreateModel(
            name="ContactPage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("content", models.JSONField(blank=True, default=dict, validators=[adminapi.article_doc.validate_article_doc])),
                ("updated_by", models.CharField(blank=True, max_length=128)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"abstract": False},
        ),
        migrations.RunPython(seed_default, migrations.RunPython.noop),
    ]
