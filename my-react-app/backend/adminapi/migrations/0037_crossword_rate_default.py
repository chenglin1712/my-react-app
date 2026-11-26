"""稽核 BE5-03：填字產生的預設限流從 30/m 降到 6/m。

seed_rate_limit_rules 是 get_or_create，已存在的資料列不會被更新，所以既有環境要靠這個資料遷移。
只改「目前值與預設值都還是舊的 30/m」的那一列，後台手動調過的值不會被覆蓋。
"""
from django.db import migrations


def lower_crossword_rate(apps, schema_editor):
    RateLimitRule = apps.get_model("adminapi", "RateLimitRule")
    RateLimitRule.objects.filter(key="generate_crossword", rate="30/m", default_rate="30/m").update(
        rate="6/m", default_rate="6/m",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("adminapi", "0036_homepage_story"),
    ]

    operations = [
        migrations.RunPython(lower_crossword_rate, migrations.RunPython.noop),
    ]
