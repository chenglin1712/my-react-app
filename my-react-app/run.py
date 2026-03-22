import os
import sys
import uvicorn

# Windows 上強制使用 UTF-8 避免中文編碼錯誤
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(BASE_DIR, "backend"))

if __name__ == "__main__":
    uvicorn.run(
        "core.asgi:application",
        host="127.0.0.1",
        port=8000,
        reload=False
    )
