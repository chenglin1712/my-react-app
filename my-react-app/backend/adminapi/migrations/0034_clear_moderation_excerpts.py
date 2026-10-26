"""審核事件的隱私收緊（S-17）：既有的摘錄是舊規則存的（80 字、遮罩較少，安全類還存了原文）。

新規則只對新事件生效，所以這裡把既有事件的摘錄一次清空。事件本身（時間、類型、處理、使用者雜湊）保留，
後台仍看得到統計；原文則不留，不等 30 天自然到期。這個動作不可還原（反向遷移什麼都不做）。
"""
from django.db import migrations


def clear_excerpts(apps, schema_editor):
    apps.get_model("adminapi", "AiModerationEvent").objects.exclude(excerpt="").update(excerpt="")


class Migration(migrations.Migration):

    dependencies = [
        ("adminapi", "0033_ai_assistant_settings"),
    ]

    operations = [
        migrations.RunPython(clear_excerpts, migrations.RunPython.noop),
    ]
