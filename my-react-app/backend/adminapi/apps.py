from django.apps import AppConfig


class AdminapiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'adminapi'

    def ready(self):
        from . import checks  # noqa: F401  註冊部署檢查
