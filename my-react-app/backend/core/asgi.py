"""
ASGI config for core project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os
from django.core.asgi import get_asgi_application

# Django 與 FastAPI 是兩個獨立行程（見 run.py／run_fastapi.py，分別跑在不同 port），
# 這裡只需要匯出 Django 自己的 ASGI callable。之前這裡試過用 Starlette 把兩個
# app 掛在同一個 ASGI application 下（FastAPI 掛 /api、Django 掛 /），但那個
# application 馬上又被下面這行覆蓋掉，等於從沒真正生效過，只是白白在這裡
# import 一次 fastAPI.main（連帶觸發它的 CORS／rate limiter／router 設定），
# 徒增 Django 啟動的匯入成本，因此移除。

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

application = get_asgi_application()

