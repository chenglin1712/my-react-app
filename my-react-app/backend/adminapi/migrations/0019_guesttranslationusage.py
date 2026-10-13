from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('adminapi', '0018_announcement_soft_delete'),
    ]

    operations = [
        migrations.CreateModel(
            name='GuestTranslationUsage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('day', models.DateField()),
                ('scope', models.CharField(max_length=8)),
                ('key_hash', models.CharField(max_length=64)),
                ('count', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'indexes': [models.Index(fields=['day'], name='adminapi_gu_day_a87526_idx')],
            },
        ),
        migrations.AddConstraint(
            model_name='guesttranslationusage',
            constraint=models.UniqueConstraint(fields=('day', 'scope', 'key_hash'), name='uniq_guest_trial_day_scope_key'),
        ),
    ]
