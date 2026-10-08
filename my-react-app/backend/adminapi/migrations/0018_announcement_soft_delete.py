from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('adminapi', '0017_wordlist_create'),
    ]

    operations = [
        migrations.AddField(
            model_name='announcement',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='announcement',
            name='deleted_by',
            field=models.CharField(blank=True, max_length=128),
        ),
    ]
