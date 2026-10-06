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

## 族語詞形分析器（選用功能，預設關閉）

從辭典的「衍生詞→詞根」對照自動歸納詞綴規則，讓翻譯的佐證檢核能認得更多合法的詞綴變化形（目前只涵蓋葛瑪蘭語與阿美語；泰雅語、布農語、排灣語因資料或把關標準不足而停用）。實作在 `backend/config/morphology.py`、`morphology_calibration.py` 與 `backend/fastAPI/routes/translation/morph.py`。

**安全設計**：只用直接命中（不用模糊比對，實測模糊比對會讓六到九成亂造的詞被放行）；只放行經過校準的少數規則；所有「是否夠安全」的判斷都比 95% 信賴上界；載入失敗一律停用、不影響翻譯；旗標預設關閉。

**維運流程**（辭典詞條或詞綴有異動後都要做）：

```sh
cd backend
python manage.py build_morphology_rules           # 只印報告，檢查各族結果與閘門
python manage.py build_morphology_rules --write   # 寫入 config/morphology_rules.json，連同報告一起提交
python manage.py seed_feature_flags               # 第一次：建立兩個旗標（預設關閉）
```

- 放行檔綁定產生時的辭典內容（檔內有詞庫內容雜湊）。執行期載入時雜湊對不上，該族會整族停用——辭典改了就必須重跑指令，不要沿用舊檔。
- 請用跟正式環境一致的資料庫產生；只拿本機 SQLite 副本的結果不能決定正式放行。
- 上線建議流程：先在後台打開 `translation_morphology_shadow`（只在 log 記錄 `[morph-shadow]`「本來會把哪些詞升級成有佐證」，完全不改變輸出），用真實流量檢查後，再打開 `translation_morphology_analyzer`。出問題時關閉旗標即可恢復原本行為（最慢約 30 秒生效）。
- 評估指令 `python manage.py evaluate_morphology_analyzer` 可重現各種做法的準確率與「亂造詞被錯放行」的比例。
- 安全上限是政策選擇：預設各負例族群錯放行 ≤ 1%、被接受真詞的錯詞根比例 ≤ 10%（都是 95% 信賴上界）。可用 `--max-fa-upper`、`--max-wrong-root-upper` 調整；收緊到錯詞根 ≤ 5% 時，目前的資料量不足以證明安全，所有族語都會停用。

## 詞素級學習者模型（選用功能，預設全部關閉）

句子填空題的錯誤選項若是形態引擎造的（`quiz_morphology_distractors`），學習者答錯時就能判斷錯在哪裡：詞綴選錯（`wrong_affix`）、中綴位置錯（`wrong_position`），還是選到不同詞根的詞（`wrong_root`）；並依答題結果估計每位學習者在每條詞綴規則上的熟練度，回頭影響出題。實作在 `backend/config/rule_skill_model.py`（模型）與 `backend/fastAPI/routes/quiz/` 的 `diagnosis.py`、`answer_flow.py`、`rule_state_store.py`、`rule_selection.py`、`research_events.py`。

**它是「熟練度估計」，不是已驗證的認知診斷**：模型是 BKT 與「整體答對率」的加權混合，參數是先驗、沒有用真人資料校準；規則歸屬有歧義的詞不更新、重疊（R）不支援。結果頁會明講這是估計。

**四個旗標由上往下一層一層打開**（後台「功能開關」，程式端有相依檢查，查詢失敗視為關閉）：

| 旗標 | 作用 |
|---|---|
| `quiz_morphology_diagnosis` | 出題附診斷 token，作答時診斷錯誤類型（只回傳診斷，不改任何資料）。需要先開 `quiz_morphology_distractors` 才有意義 |
| `quiz_rule_skill_update` | 更新熟練度、混淆次數與整體表現（存在伺服器端） |
| `quiz_rule_adaptive_selection` | 句子填空多挑熟練度低的規則出題（有 25% 探索比例、同規則每份測驗最多 2 題） |
| `quiz_rule_event_logging` | 經使用者同意才記錄假名化研究事件 |

**設計重點**

- 診斷依據是出題當下的情況：題目附一個 Fernet 加密 token（綁定使用者、題目、族語、目標詞、2 小時有效），前端看不到內容也無法竄改；沒有 token 時只做高信心的重算，而且不更新任何東西。token 驗證通過時，答對與否以伺服器判斷的為準，覆蓋前端自報的值。
- 規則熟練度由伺服器持有：Firestore `users/{uid}/quizRuleState/{族語}`，前端只能讀、不能寫（見 `firestore.rules`）；更新在 Firestore 交易裡進行，同一題的 token 重送只會更新一次（nonce 去重），兩個分頁同時作答不會互相覆蓋。刪除帳號時會一併清除這個子集合。
- 研究事件預設不記錄，必須同時滿足：旗標開、設定 `QUIZ_RESEARCH_SALT`、使用者在結果頁按了「我同意」。事件只存假名（不是匿名：系統持有鹽，才能在撤回或刪帳時找到並刪除該使用者的事件）、規則 ID、診斷類別與模型預測值，不存 uid、詞形、句子，時間只到整點；撤回同意或刪除帳號會刪除該使用者的全部事件。同意文字的版本（`CONSENT_VERSION` 與前端 `CONSENT_TEXT_VERSION`）改動時要一起升版，舊版同意會失效。
- 密鑰 `QUIZ_TOKEN_SECRET`（token）與 `QUIZ_RESEARCH_SALT`（假名）見 `.env.example`；沒設定或太弱時相關功能自動降級，不影響測驗本身。
- **`QUIZ_RESEARCH_SALT` 是資料治理密鑰**：遺失或更換後，舊事件無法再逐人刪除（撤回、刪帳都找不到）。請納入密鑰備份；真的要輪替時，先用 `purge_quiz_research_data --older-than-days 1 --yes` 清掉全部舊事件，或保留舊鹽直到舊事件超過保存期限。
- 一次性消費：同一題的 token 在到期前只會更新一次（nonce 連同 token 到期時間一起存，到期才清除；不是固定保留最近 N 筆）。
- 作答回應不會被外部服務拖慢：Firestore 更新最多等 3 秒、研究事件寫入最多等 2 秒，超過就放棄等待（工作可能仍在背景完成），回應的 `rule_update` 會是 `{"unavailable": "timeout" | "busy" | "error"}`；背景同時執行的工作數有上限，滿了直接略過。
- 撤回與事件寫入用資料庫列鎖序列化（同意檢查與寫入在同一個交易、`SELECT … FOR UPDATE`）；**這個鎖行為只在程式裡有測試語句，尚未在真正的 PostgreSQL 驗證**，打開研究事件旗標前必須先在測試用的 PostgreSQL 驗證撤回與寫入同時發生的情況。

**評估與維運**

```sh
cd backend
python manage.py seed_feature_flags                  # 建立旗標（預設關閉）
python manage.py simulate_rule_skill_learners        # 模擬學習者：檢驗評估流程與模型敏感度（含負對照）
python manage.py evaluate_rule_skill_events          # 用真實事件比較「規則熟練度」與「單一能力值」的預測（含信賴區間）
python manage.py purge_quiz_research_data --uid <uid> --yes          # 依使用者清除事件（不加 --yes 只預覽）
python manage.py purge_quiz_research_data --older-than-days 180 --yes # 依保存期限清除
```

- 模擬只能說明模型在「真實機制跟它不一樣」的世界裡的表現，以及評估流程沒有洩漏答案（負對照：只有一種整體能力時，規則熟練度模型不該贏）；**不是對真人有效的證據**。
- `evaluate_rule_skill_events` 比較的是預測準確度，預測得準不代表適性出題讓人學得更好——那需要隨機對照或前後測。事件或使用者太少時只列描述性數字、不下結論。
- 適性選題會把挑中的字從四種題型共用的候選池取走，所以後面題型（例如句子排序）拿到的字會跟關閉旗標時不同；一份測驗裡仍不會有兩題考同一個字。
- Firestore 規則的行為測試：`firebase emulators:exec --only firestore "npx vitest run --config vitest.rules.config.js firestore.rules.test.js"`；伺服器端狀態的交易行為測試需要 emulator：`firebase emulators:exec --only firestore "python -m pytest backend/fastAPI/tests/test_rule_state_store_firestore.py"`（沒有 emulator 時該檔自動略過）。

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
