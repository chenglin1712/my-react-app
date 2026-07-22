# backend/Dockerfile
#
# 單一 image，Django（WSGI）與 FastAPI（ASGI）共用——兩者都是同一份
# backend/ 原始碼、讀同一份根目錄 .env、import 同一個 backend/config/ package
# （例如 FastAPI 端 `from config.tribes import TRIBE_MAP`），差別只在啟動時
# 跑哪個 command，所以不在這裡固定寫死其中一個服務的 CMD——由
# docker-compose.yml 的 `command:` 依服務個別覆蓋（見該檔案），避免兩個
# service 各自重複一份 apt/pip 安裝層。
#
# 必須用「repo 根目錄」當 build context 建置（因為要讀根目錄的
# requirements.txt），例如：
#   docker build -f backend/Dockerfile -t my-react-app-backend .
# docker-compose.yml 已經設定好對應的 context/dockerfile，一般不需要手動下
# 這行指令。

FROM python:3.10-slim

# 對應 requirements.txt 內套件的系統依賴：
# - ffmpeg：pydub／fastAPI/routes/quiz.py 的語音比對功能需要 ffmpeg／ffprobe
#   執行檔在 PATH 上（quiz.py 會自動偵測，找不到只在啟動時警告，呼叫
#   /compare_audio 才會真的報錯）。
# - libsndfile1：soundfile 需要的系統函式庫。
# - libgl1、libglib2.0-0：opencv-python（非 headless 版）在 Debian slim 這類
#   最小化 image 上 import 時若缺這兩個會丟出經典的 libGL.so.1 錯誤。
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 先只複製 requirements.txt 再裝依賴（善用 Docker layer cache：原始碼變動不會
# 讓這一層重跑）。安裝順序完全比照 .github/workflows/ci.yml 已驗證可行的做法：
# torch/torchaudio/torchvision 必須「先」從 PyTorch 的 CPU wheel index 裝，
# 直接 `pip install -r requirements.txt` 會嘗試從預設 PyPI index 抓，可能抓到
# 不對的 build 或抓不到（requirements.txt 開頭也有同樣的註解）。
COPY requirements.txt .
RUN pip install --no-cache-dir \
        torch==2.10.0 torchaudio==2.10.0 torchvision==0.25.0 \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# 複製 backend/ 原始碼。Django 與 FastAPI 都是以 backend/ 當 Python root
# （FastAPI 用 `from fastAPI.routes...`、`from config...` 這種絕對 import），
# 所以 WORKDIR 要停在 backend/，跟 CI（`working-directory: backend`）、
# README「正式部署」文件的 `cd backend && gunicorn ...` / `cd backend &&
# uvicorn ...` 一致。
COPY backend/ /app/backend/

WORKDIR /app/backend

# Django 預設 8000、FastAPI 預設 8001（見 README），僅供文件用途，
# 實際監聽 port 由啟動指令的 $PORT 決定（docker-compose.yml 逐服務設定）。
EXPOSE 8000 8001

# 沒有內建 HEALTHCHECK：Django 是 /health/（注意結尾斜線，settings.py 設定
# APPEND_SLASH=False，不會自動補）、FastAPI 是 /health（不帶斜線），這個
# image 又是兩服務共用，這裡沒辦法只寫一個通用的健康檢查網址/port。改在
# docker-compose.yml 用逐服務的 healthcheck: 分開設定。

# 不寫死 CMD 給特定服務——docker-compose.yml 的 command: 會覆蓋這裡。
# 萬一有人忘了透過 docker-compose、直接 `docker run` 這個 image 不帶指令，
# 印出清楚的提示而不是讓它安靜地啟動失敗。
CMD ["sh", "-c", "echo 'This image needs an explicit command (see docker-compose.yml: django/fastapi services). Examples:'; echo '  gunicorn core.wsgi:application --bind 0.0.0.0:$PORT'; echo '  uvicorn fastAPI.main:app --host 0.0.0.0 --port $PORT'; exit 1"]
