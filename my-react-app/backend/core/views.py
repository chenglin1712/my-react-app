from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse


def health_check(request):
    """給 load balancer / 容器平台用的健康檢查端點，不需要登入。
    對應 FastAPI 側的 /health（backend/fastAPI/main.py）。

    原本只做 liveness（process 有沒有活著，固定回 200），沒探測 DB／cache
    依賴是否正常——process 活著但資料庫連不上時一樣回 200，平台會繼續把流量
    導過來，而站上大多數端點其實都會噴錯。額外檢查 DB 連線與 cache 讀寫，
    任一個失敗就回 503，讓平台知道這個實例還沒準備好接流量。"""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return JsonResponse({"status": "error", "detail": "database unavailable"}, status=503)

    try:
        cache.set("_health_check", "1", timeout=5)
    except Exception:
        return JsonResponse({"status": "error", "detail": "cache unavailable"}, status=503)

    return JsonResponse({"status": "ok"})
