from django.apps import AppConfig


class AdminapiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'adminapi'

    def ready(self):
        from . import checks  # noqa: F401  註冊部署檢查

        # AI 用量紀錄：config/llm.py 同時被 Django 與 FastAPI 使用，寫入方式由各 process
        # 自己註冊（FastAPI 端見 fastAPI/ai_usage_events.py）。
        from config.llm import set_usage_recorder
        from .ai_usage import record_ai_usage
        set_usage_recorder(record_ai_usage)
