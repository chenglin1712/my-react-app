# 原住民族語 AI 教學平台

React（Vite）前端 + Django + FastAPI 雙後端的族語學習平台：單詞查詢、影像辨識查詞、填字／聽力／發音等遊戲、IRT 薦讀測驗、AI 學習助手、筆記與收藏。

> 本資料夾（`my-react-app/`）就是專案根目錄。若你是從外層同名的 `my-react-app/` git 目錄 clone 下來的，程式碼都在這一層巢狀資料夾裡。

## 目錄結構

```
my-react-app/
├── frontend/           # React + Vite 原始碼
├── backend/
│   ├── core/            # Django 專案設定（settings.py、urls.py）
│   ├── AIModel/          # Django app：AI 學習助手（tayal_chat / review_tayal_chat）
│   ├── CrosswordPuzzle/   # Django app：填字遊戲
│   ├── crawler/          # Django app：測驗題目與首頁新聞（爬第三方 API）
│   ├── dictionary_db/    # 辭典資料庫 engine/ORM（Django、FastAPI 共用，見下方「辭典資料庫」一節）
│   └── fastAPI/          # FastAPI 服務：辭典查詢、測驗生成、語音比對、影像辨識
│       └── alembic/        # 辭典資料庫（dictionary.db）的 schema migration
├── dist/                # `npm run build` 產物（不進版控）
└── .env.example         # 環境變數範本
```

三個服務各自監聽不同 port，開發時同時啟動：Vite dev server（5173）、Django（8000）、FastAPI（8001），前端請求會依 `.env` 內對應變數打到後兩者。

## 環境需求

- Node.js（含 npm）
- Python 3.10+
- ffmpeg（語音比對功能 `/quiz/compare_audio/` 需要；沒有時該功能會回錯誤訊息，其餘功能不受影響）
- Firebase 專案（前端登入／使用者資料／收藏都存在 Firestore；後端驗證使用者身份需要 Firebase Admin SDK 服務帳戶金鑰）

## 安裝與設定

```sh
# 前端
npm install

# 後端（Django + FastAPI 共用同一份 requirements.txt）
pip install -r requirements.txt
```

複製 `.env.example` 為 `.env`，依註解填入：Firebase 專案設定、Anthropic Claude API Key（AI 對話／翻譯）、Google Cloud Vision API 金鑰（影像辨識）、Cloudinary（圖片上傳）等。`.env` 已加進 `.gitignore`，不會被提交。

### 本機開發的兩個旗標

- `DJANGO_DEBUG`：只控制錯誤訊息詳細度、SQL echo 這類除錯資訊，**不影響是否驗證身份**。
- `AUTH_DEV_BYPASS`：是否略過 Firebase token 驗證，僅在 `DJANGO_DEBUG=True` 時才會生效（雙重確認）。本機沒有 Firebase 服務帳戶金鑰時，設 `DJANGO_DEBUG=True` + `AUTH_DEV_BYPASS=True` 即可略過驗證開發；正式環境兩者都必須是 `False`（或留空），並填妥 `FIREBASE_SERVICE_ACCOUNT_PATH`。

這兩個旗標故意分開，是因為早期只用一個 `DJANGO_DEBUG` 同時控制兩件事：正式環境若誤把它設成 `True`，會在完全沒人注意到的情況下讓全站認證形同虛設。

## 啟動專案（開發環境）

```sh
# 前端（Vite dev server，預設 http://localhost:5173）
npm run dev

# Django（預設 http://127.0.0.1:8000）
cd backend
python manage.py runserver

# FastAPI（預設 http://127.0.0.1:8001；務必在 backend/ 目錄下執行，
# 專案內部用 `fastAPI.routes.xxx`、`dictionary_db.xxx` 這種絕對 import，模組搜尋路徑要從 backend/ 開始）
cd backend
uvicorn fastAPI.main:app --reload --port 8001
```

根目錄的 `run.py`／`run_fastapi.py` 是另一組開發用啟動腳本（啟動前會檢查必填環境變數是否已設定），一樣只綁定 `127.0.0.1`，僅供本機開發使用，**不是**正式環境的啟動方式（見下方「正式部署」）。

## 辭典資料庫（dictionary.db）

`backend/dictionary_db/dictionary.db` 是 Django、FastAPI 兩服務共用的辭典／文法資料 SQLite 檔案（獨立成 `dictionary_db` package，避免 Django 得反過來 import `fastAPI.routes.*` 內部模組），**不進版控**（見 `.gitignore`），schema 由 Alembic migration 管理：

```sh
cd backend/fastAPI
alembic upgrade head
```

對一個全新、空的 SQLite 檔案執行以上指令即可建出完整 schema（`ad283d8500e4` 這支起始 migration 會建出所有資料表）。實際辭典資料需另外匯入，不含在 migration 裡。

## 正式部署

- `ALLOWED_HOSTS`：Render 會自動注入 `RENDER_EXTERNAL_HOSTNAME`；部署到其他平台時用 `DJANGO_ALLOWED_HOSTS`（逗號分隔）手動指定。
- `CSRF_TRUSTED_ORIGINS`：逗號分隔，填正式網域（需含協定，例如 `https://your-app.example.com`）。
- `ALLOWED_ORIGINS`：Django + FastAPI 共用的 CORS 允許來源，逗號分隔。
- `DJANGO_DEBUG=False`、`AUTH_DEV_BYPASS=False`（或留空）、`FIREBASE_SERVICE_ACCOUNT_PATH` 指到服務帳戶金鑰 JSON。
- 啟動 Django（gunicorn）前需先執行一次 `python manage.py collectstatic --noinput`：admin／DRF 頁面的 CSS/JS 由 WhiteNoise 直接從 `STATIC_ROOT`（`backend/staticfiles/`）提供，沒跑過這個指令樣式會跑掉。
- `DJANGO_DEBUG=False` 時 Swagger UI（`/docs/`）不會掛載（404），只在開發環境可用。
- `DJANGO_DEBUG=False` 會自動啟用 `SECURE_SSL_REDIRECT`／`SESSION_COOKIE_SECURE`／`CSRF_COOKIE_SECURE`／HSTS；部署平台（Render、Cloud Run）需在反向代理層正確設定 `X-Forwarded-Proto`（兩者預設都會），Django 已透過 `SECURE_PROXY_SSL_HEADER` 讀取這個標頭判斷連線是否為 HTTPS。
- `REDIS_URL`：gunicorn 若開多個 worker，務必設定，否則 AIModel/CrosswordPuzzle/crawler 的限流計數會退回單一 process 的 LocMemCache，門檻被 worker 數量乘倍放大。
- **FastAPI 辭典快取目前僅支援單一 process**：Django 在辭典／文法資料寫入後，會透過一次 HTTP request 通知 FastAPI 清除 process-local 記憶體快取。這個通知只會命中其中一個 process；因此目前不可對 FastAPI 使用 `uvicorn --workers` 開多 worker，也不可在 Render、Cloud Run 或其他平台啟用多個水平 replica。水平擴展前，必須先把辭典快取改為 Redis 等共享快取，或導入可廣播到所有 FastAPI process 的失效機制，否則部分 instance 會無聲地持續回傳舊辭典／文法資料。
- `SENTRY_DSN`：設定後 Django／FastAPI 的 ERROR 等級例外會送到 Sentry，容器重啟後仍查得到記錄，也能收到告警通知；不設定不影響現有行為。
- 健康檢查端點：Django 為 `/health/`，FastAPI 為 `/health`，皆不需要登入，回傳 `{"status": "ok"}`。
- `run.py`／`run_fastapi.py` 僅供本機開發（綁定 `127.0.0.1`），正式環境須直接用 gunicorn／uvicorn 啟動，例如：
  ```sh
  # Django（WSGI）
  cd backend && gunicorn core.wsgi:application --bind 0.0.0.0:$PORT

  # FastAPI（ASGI）
  cd backend && uvicorn fastAPI.main:app --host 0.0.0.0 --port $PORT
  ```

### 用容器重現部署環境

repo 根目錄現在有 `backend/Dockerfile`（Django／FastAPI 共用同一個 image，python:3.10-slim + 上面同一套 pip 安裝順序 + ffmpeg／libsndfile1／libgl1／libglib2.0-0 等系統套件）與 `docker-compose.yml`（`django`／`fastapi` 兩個 service，各自從這個 image 用不同 `command:` 啟動），可以在本機重現跟正式部署一致的容器環境：

```sh
# 需先準備好根目錄 .env（見上方「安裝與設定」）
docker compose up --build
```

- Django 在 `http://localhost:8000`、FastAPI 在 `http://localhost:8001`，兩者的健康檢查端點（`/health/`、`/health`）都已接上 `docker-compose.yml` 的 `healthcheck:`。
- `backend/dictionary_db/dictionary.db` 與 Django 的 `backend/db.sqlite3`（皆為 gitignored 的 SQLite 檔案）透過 bind mount 從本機掛進容器，不會被打進 image；本機沒有這兩個檔案時容器仍能啟動，但對應的資料查詢不會有內容，細節見 `docker-compose.yml` 內的註解。
- **這只解決「容器裡能不能重現環境」的問題，實際部署平台（Render／Cloud Run／其他）仍未定案**——`Dockerfile`／`docker-compose.yml` 兩個平台都相容（都只是跑一個監聽 `$PORT` 的標準容器），不代表已經選定平台；`dist/` 要如何接給 Django 服務（SPA 路由、靜態檔案）目前也還沒決定（`core/urls.py` 內對應程式碼仍註解掉），視前端是否要跟後端服務分開部署而定。
- 沒有本機 Docker 環境時，仍可依上方「啟動專案（開發環境）」或本節手動 gunicorn／uvicorn 指令直接跑，不強制要求用容器。

## 測試

```sh
# 前端
npm test

# Django
cd backend
python manage.py test

# FastAPI
cd backend
pytest fastAPI/tests
```

`.github/workflows/ci.yml` 會在每次 push / PR 時自動跑上述測試與 `npm run lint` / `npm run build`。
