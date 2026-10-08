"""FastAPI 呼叫同機 Django（http://127.0.0.1:8000）時帶的標頭。

Django 在正式環境開了 SECURE_SSL_REDIRECT，只認 X-Forwarded-Proto 判斷請求是不是 HTTPS（nginx 會帶）。
容器內直接打 127.0.0.1:8000 沒有這個標頭，會被 301 導去 https://127.0.0.1:8000，而 gunicorn 並沒有
TLS，於是整個請求以 SSL 錯誤失敗——後台設定的限流、遊戲參數、IRT 設定就永遠讀不到，只能沿用預設值。
這個呼叫完全在本機內部，沒有走公網，宣告 https 不會降低任何安全性（docker-compose.prod.yml 的
healthcheck 也是同樣做法）。
"""

DJANGO_INTERNAL_HEADERS = {"X-Forwarded-Proto": "https"}
