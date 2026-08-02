from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                (
                    'id',
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name='ID',
                    ),
                ),
                ('actor_uid', models.CharField(max_length=128)),
                (
                    'actor_role',
                    models.CharField(blank=True, max_length=32, null=True),
                ),
                ('action', models.CharField(max_length=64)),
                ('target_type', models.CharField(max_length=64)),
                ('target_id', models.CharField(max_length=128)),
                ('before', models.JSONField(blank=True, null=True)),
                ('after', models.JSONField(blank=True, null=True)),
                (
                    'ip_address',
                    models.GenericIPAddressField(blank=True, null=True),
                ),
                ('user_agent', models.TextField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['-created_at', '-pk'],
                'indexes': [
                    models.Index(
                        fields=['target_type', 'target_id'],
                        name='adminapi_au_target__144950_idx',
                    ),
                    models.Index(
                        fields=['actor_uid'],
                        name='adminapi_au_actor_u_a9402d_idx',
                    ),
                ],
            },
        ),
    ]
