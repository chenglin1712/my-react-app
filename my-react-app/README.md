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

複製 `.env.example` 為 `.env`，依註解填入：Firebase 專案設定、GitHub Models API Token（AI 對話）、Google Cloud Vision API 金鑰（影像辨識）、Cloudinary（圖片上傳）等。`.env` 已加進 `.gitignore`，不會被提交。

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
# 專案內部用 `fastAPI.routes.xxx` 這種絕對 import，模組搜尋路徑要從 backend/ 開始）
cd backend
uvicorn fastAPI.main:app --reload --port 8001
```

## 辭典資料庫（dictionary.db）

`backend/fastAPI/routes/dictionary.db` 是 FastAPI 端辭典／文法資料的 SQLite 檔案，**不進版控**（見 `.gitignore`），schema 由 Alembic migration 管理：

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
