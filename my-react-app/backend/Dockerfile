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

# 基底映像固定「版本＋摘要」：同一份 Dockerfile 在不同時間建出來的是同一個系統，不會因為上游
# 悄悄換了 Debian 版本或 Python 小版本而壞掉，也不會被上游被入侵的新映像取代。
# 3.12.13-slim-trixie 對應本機開發的 Python 3.12.13。要升級時：到 Docker Hub 查新標籤的摘要，
# 在預備環境 docker build 通過後，標籤與摘要一起改。
FROM python:3.12.13-slim-trixie@sha256:229a2c5bfa27522db7815ea81f9bed70af17ccb9de9fc7ad142b1877b5830d36

# 對應 requirements.txt 內套件的系統依賴：
# - ffmpeg：pydub／fastAPI/routes/quiz.py 的語音比對功能需要 ffmpeg／ffprobe
#   執行檔在 PATH 上（quiz.py 會自動偵測，找不到只在啟動時警告，呼叫
#   /compare_audio 才會真的報錯）。
# - libsndfile1：soundfile 需要的系統函式庫。
# （原本還裝 libgl1、libglib2.0-0 給 opencv-python 用；程式碼沒用到 opencv，套件與這兩個函式庫都已移除）
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 先只複製鎖定檔再裝依賴（善用 Docker layer cache：原始碼變動不會讓這一層重跑）。
# 三份鎖定檔都用 --require-hashes：每個檔案的 SHA-256 都要對得上，套件庫上被偷換的檔案裝不進來
# （鎖定檔由 scripts/compile_requirements.sh 產生）。
# - requirements-pip.lock：pip 自己，釘版本加雜湊（稽核 SUP-8）。
# - requirements-torch.lock：只有 torch／torchaudio 兩個檔案，只從 PyTorch 的 CPU index 安裝，不加 PyPI 當第二個索引
#   （稽核 SUP-1：兩個索引並存時，同名套件可能被另一邊的版本取代，即相依混淆）。--no-deps 因為它們的相依
#   （sympy、networkx、jinja2 等）在 requirements.lock，同樣帶雜湊、從 PyPI 安裝（PyTorch 的 index 只有很舊的鏡像）。
# - requirements.lock：其餘所有套件，從預設 PyPI 安裝。
# 最後的 pip check 確保三次安裝之間沒有版本衝突。
COPY requirements-pip.lock requirements-torch.lock requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements-pip.lock \
    && pip install --no-cache-dir --require-hashes --no-deps \
        --index-url https://download.pytorch.org/whl/cpu -r requirements-torch.lock \
    && pip install --no-cache-dir --require-hashes -r requirements.lock \
    && pip check

# 發音比對的 wav2vec2 權重在 build 階段就下載進 image（TORCH_HOME 固定路徑，
# 不隨執行身分改變）。原本是第一次請求才下載：第一位使用者要等很久，容器無外網或
# 下載來源故障時，部署看起來成功、發音功能卻實際不可用。build 當下下載失敗會直接
# 讓建置失敗，問題在部署前就曝光。
ENV TORCH_HOME=/opt/torch
# 權重檔先自己下載並核對 SHA-256（稽核 SUP-8），放進 torch hub 的快取位置（檔名與網址最後一段相同），
# 之後 torchaudio 發現檔案已在就不會再下載。這個檔案是 torch.load 要讀的 pickle，被偷換就等於在 build 階段
# 執行任意程式碼，所以不能只信任下載來源。下載、核對與失敗處理見 scripts/fetch_verified.py（有測試）。
# 要升級 torchaudio 且權重檔變了時：下載新檔、算 SHA-256，兩處（網址與雜湊）一起改。
# 映像是不可變的；執行期不要把可寫的 volume 掛到 $TORCH_HOME，否則這個檔案又變成未驗證的輸入。
COPY scripts/fetch_verified.py /tmp/fetch_verified.py
RUN python /tmp/fetch_verified.py \
        https://download.pytorch.org/torchaudio/models/wav2vec2_fairseq_base_ls960.pth \
        /opt/torch/hub/checkpoints/wav2vec2_fairseq_base_ls960.pth \
        1275f890a623b31b9915295dc01d5049c93dc6de8813406c16dfab9b6bd36056 \
        600000000 \
    && rm /tmp/fetch_verified.py
# 不只載入模型，還實際跑一次推論：torch 與 torchaudio 的版號不同（見 requirements.txt），
# 原生介面對不上時，import 會成功、真正執行才會出錯，這一行讓它在 build 階段就失敗。
RUN python -c "import torch, torchaudio; m = torchaudio.pipelines.WAV2VEC2_BASE.get_model().eval(); f, _ = m.extract_features(torch.zeros(1, 16000)); assert len(f) == 12 and f[-1].shape[-1] == 768 and torch.isfinite(f[-1]).all()"

# 複製 backend/ 原始碼。Django 與 FastAPI 都是以 backend/ 當 Python root
# （FastAPI 用 `from fastAPI.routes...`、`from config...` 這種絕對 import），
# 所以 WORKDIR 要停在 backend/，跟 CI（`working-directory: backend`）、
# README「正式部署」文件的 `cd backend && gunicorn ...` / `cd backend &&
# uvicorn ...` 一致。
COPY backend/ /app/backend/

WORKDIR /app/backend

# 不用 root 執行：應用程式被攻破時，攻擊者不會直接拿到容器內的最高權限。
# docker-compose.prod.yml 會用 user: 覆寫成部署使用者的 uid（deploy.sh 設定 APP_UID），
# 這樣掛進來的 ./logs、./media 才寫得進去，所以這裡的 10001 只是「直接 docker run」時的預設。
# 任意 uid 都要能寫：collectstatic 的輸出目錄與預設 log 目錄先建好並開放（1777，同 /tmp）。
ENV HOME=/tmp
RUN mkdir -p /app/backend/staticfiles /app/backend/logs /app/logs \
    && chmod 1777 /app/backend/staticfiles /app/backend/logs /app/logs
USER 10001:10001

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
