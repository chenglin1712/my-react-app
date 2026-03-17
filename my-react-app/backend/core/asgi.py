"""
ASGI config for core project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os
from django.core.asgi import get_asgi_application
from fastAPI.main import app as fastapi_app  # 匯入你的 FastAPI 應用
from starlette.applications import Starlette
from starlette.routing import Mount


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

django_app = get_asgi_application()

application = Starlette(
    routes=[
        Mount("/api", app=fastapi_app),
        Mount("/", app=django_app),
    ]
)

# 建立 Django 應用
application = get_asgi_application()


# 建立主 FastAPI 應用
#app = FastAPI(title="Django + FastAPI")

# 掛載 FastAPI 子應用（例如 /api 開頭）
#app.mount("/api", fastapi_app)

# 掛載 Django 主網站
#app.mount("/", application)


