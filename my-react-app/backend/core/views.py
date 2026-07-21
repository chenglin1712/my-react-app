from django.http import JsonResponse


def health_check(request):
    """給 load balancer / 容器平台用的健康檢查端點，不需要登入。
    對應 FastAPI 側的 /health（backend/fastAPI/main.py），Django 原本沒有
    對應端點。"""
    return JsonResponse({"status": "ok"})
