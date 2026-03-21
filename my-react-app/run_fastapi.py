import os
import sys
import uvicorn

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(BASE_DIR, "backend"))

if __name__ == "__main__":
    uvicorn.run(
        "fastAPI.main:app",
        host="127.0.0.1",
        port=8001,
        reload=True
    )
