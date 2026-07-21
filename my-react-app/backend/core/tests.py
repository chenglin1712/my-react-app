from django.test import TestCase, Client


class HealthCheckTest(TestCase):
    """對應 FastAPI 側的 /health（backend/fastAPI/main.py），Django 原本沒有
    對應端點，也不需要登入。"""

    def test_health_check_returns_ok(self):
        response = Client().get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
