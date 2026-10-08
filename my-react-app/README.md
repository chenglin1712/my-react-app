# 原住民族語 AI 教學平台

React（Vite）前端 + Django + FastAPI 雙後端的族語學習平台：單詞查詢、影像辨識查詞、填字／聽力／發音等遊戲、IRT 薦讀測驗、AI 學習助手、筆記與收藏。

> 本資料夾（`my-react-app/`）就是專案根目錄。若你是從外層同名的 `my-react-app/` git 目錄 clone 下來的，程式碼都在這一層巢狀資料夾裡。

## 目錄結構

```
my-react-app/
├── frontend/           # React + Vite 原始碼
├── backend/
│   ├── core/            # Django 專案設定（settings.py、urls.py）
│   ├── adminapi/        # Django app：後台管理系統——使用者／辭典／題庫／公告／功能旗標／
│   │                       待專家驗證佇列／千詞表對照等，見下方「後台管理系統」一節
│   ├── AIModel/          # Django app：AI 學習助手（tayal_chat / review_tayal_chat）
│   ├── CrosswordPuzzle/   # Django app：填字遊戲
│   ├── crawler/          # Django app：測驗題目與首頁新聞（爬第三方 API）
│   ├── dictionary_db/    # 辭典資料庫 engine/ORM（Django、FastAPI 共用，見下方「辭典資料庫」一節）
│   └── fastAPI/          # FastAPI 服務：辭典查詢、測驗生成、語音比對、影像辨識、族語翻譯
│       └── alembic/        # 辭典資料庫（dictionary.db／PostgreSQL 皆通用）的 schema migration
├── deploy/              # 正式環境部署輔助檔（備份腳本、nginx 範本），說明見 deploy/README.md
├── docker-compose.yml       # 本機用容器重現環境（SQLite bind mount）
├── docker-compose.prod.yml  # 正式環境用（PostgreSQL、健康檢查、回滾標籤），見「正式部署」一節
├── deploy.sh                 # 一鍵部署／回滾（正式環境專用）
├── public/              # 原樣複製到 dist/ 根目錄的靜態檔（favicon、robots.txt），網址就是 /檔名
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

**資料庫 migration（Django）**：第一次啟動，或 `git pull` 之後更新裡有 `backend/adminapi/migrations/` 的新檔案，要先在 `backend/` 執行一次 `python manage.py migrate`（`manage.py` 在 `backend/`，不在專案根目錄）。**不是每次啟動都要跑**，沒有新 migration 時跑了也只會顯示沒有要套用的。沒套用就啟動的話，用到新欄位的頁面會直接出錯（例如公告軟刪除新增了 `deleted_at`，沒 migrate 時公告管理列表會壞掉）。可以用 `python manage.py showmigrations adminapi` 檢查，有 `[ ]` 就是還沒套用。正式環境不用手動跑：後端容器每次啟動都會自動 `migrate`（見 `docker-compose.prod.yml`，部署前會先備份）。

根目錄的 `run.py`／`run_fastapi.py` 是另一組開發用啟動腳本（啟動前會檢查必填環境變數是否已設定），一樣只綁定 `127.0.0.1`，僅供本機開發使用，**不是**正式環境的啟動方式（見下方「正式部署」）。

## 辭典資料庫（dictionary.db）

`backend/dictionary_db/dictionary.db` 是 Django、FastAPI 兩服務共用的辭典／文法資料 SQLite 檔案（獨立成 `dictionary_db` package，避免 Django 得反過來 import `fastAPI.routes.*` 內部模組），**不進版控**（見 `.gitignore`），schema 由 Alembic migration 管理：

```sh
cd backend/fastAPI
alembic upgrade head
```

對一個全新、空的 SQLite 檔案執行以上指令即可建出完整 schema（`ad283d8500e4` 這支起始 migration 會建出所有資料表）。實際辭典資料需另外匯入，不含在 migration 裡。

**正式環境實際用的是 PostgreSQL，不是這份 SQLite 檔**：設定 `DICTIONARY_DATABASE_URL`（沒設定時才退回沿用 `DATABASE_URL`，兩者都沒設定才是這份本機 SQLite 檔案，判斷邏輯見 `backend/dictionary_db/connect.py`）。Alembic migration 對兩種資料庫通用，一樣是 `alembic upgrade head`；想在本機用 PostgreSQL 開發，直接把 `DICTIONARY_DATABASE_URL` 指到本機的 PostgreSQL 即可，不用額外改程式。

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

## 前端的全站行為

這些行為是全站共用的，改頁面時不用（也不該）各自再做一份：

- **開頁載入殼**：`index.html` 內嵌一個不依賴任何外部檔案的載入畫面，JS 下載完、React 掛載後會自動被取代。字型 CSS 用 `media="print"` 加 `onload` 改成不阻擋首次繪製，慢速網路下才不會整頁白屏。
- **啟動失敗畫面**：Firebase 設定缺漏時 `getAuth` 會在 React 掛載前丟錯。`firebase.js` 接住並匯出 `firebaseInitError`，`main.jsx` 看到就改顯示靜態的 `StartupError`（不依賴樣式與路由，也不顯示設定內容）。
- **換頁**（`src/RouteEffects.jsx`、`src/routeMeta.js`）：每個路由有自己的分頁標題（新增路由時到 `routeMeta.js` 加一條，沒對應的網址就是 404）；一般換頁會捲回頂端並把焦點移到新頁的 `h1`，按上一頁／下一頁則交給瀏覽器還原位置，使用者正在輸入時不搶焦點。後台（`/admin`）的標題由 `AdminLayout` 依麵包屑設定。每個頁面都應該有一個 `h1`。
- **404**：前台與後台各有一個 404 頁；未登入進入需要登入的功能頁，會看到說明是哪個功能的「請先登入」畫面（`userServives/permissionProtect.jsx`）。
- **API 逾時與重試**（`utils/apiClient.js`）：預設 60 秒逾時（要比 nginx 的 `proxy_read_timeout` 90 秒短），個別呼叫可用 `options.timeout` 覆寫。**只有 GET** 遇到連不到伺服器或 502／503／504 會自動重試一次；寫入類請求（POST／PUT／PATCH／DELETE）一律不重試，避免重複寫入。
- **鍵盤焦點與觸控**：`theme-v2.css` 有全站 `:focus-visible` 基線；自製彈窗用 `hooks/useFocusTrap`（Tab 只在彈窗內循環、關閉後還原焦點）。觸控裝置上的可點擊區至少 44×44px。
- **離線提示**：瀏覽器斷線時畫面底部會顯示提示（`components/ui/OfflineBanner.jsx`）。

## 後台管理系統

### 登入與重新驗證

後台有自己的登入頁（`/admin-login`），跟前台學習者登入分開；每個分頁第一次進後台會播一次入場動畫，之後在後台內換頁、重新整理都不會再播（記在 `sessionStorage`）。

角色透過 Firebase custom claims 寫在 ID token 裡（`backend/config/roles.py`：`owner`／`admin`／`editor`／`reviewer`／`analyst`），每個後台 API 都會檢查角色，角色不符一律回 403，不會因此洩漏「這個後台功能存在」的訊息。

角色檢查通過後還有一層「新鮮度」檢查：ID token 的 `auth_time`（使用者最後一次**用密碼**驗證身分的時間，一般的 token 自動更新不會改它）如果超過 `ADMIN_REAUTH_MAX_AGE_SECONDS`（預設 1800 秒＝30 分鐘，見 `.env.example`；設成 0、負數或亂碼一律退回預設值，沒有「關閉」的選項），後台 API 一律回 401 加 `reauth_required`，前端彈出重新驗證視窗——用彈窗而不是導去登入頁，是因為管理員常常表單填到一半才過期，導頁會讓內容全部消失；彈窗驗證成功後原本頁面狀態不變，也不會自動重送剛才失敗的請求（避免寫入類請求被重送造成重複操作）。本機 `AUTH_DEV_BYPASS=True` 時整段略過，因為 dev bypass 沒有真正的 token，也就沒有 `auth_time`。

### 公告管理：刪除與列操作

公告狀態：草稿 → 待審核 → 已發布 → 已下架（待審核可被退件成「已退件」，已退件可再送審）。**可以刪除的狀態只有草稿、已退件、已下架**，而且限 `owner`／`admin`；待審核要先撤回、已發布要先下架，這樣刪除前一定留下撤回／下架的稽核軌跡，公開首頁也會先停止曝光。公告還有待審的修改時不能刪。

- 後台自己建立、從沒送審過的草稿是**硬刪除**（稽核紀錄保留完整的刪除前快照）。
- 其餘一律是**軟刪除**：資料列保留，標記 `deleted_at`／`deleted_by`，稽核紀錄的動作是 `soft_delete`。已刪除的公告對後台是 404（用 `Announcement.live` 查詢），不會出現在列表與公開首頁；`Announcement.objects` 仍包含已刪除的列。
- **爬蟲匯入的公告一律軟刪除**（包括「下架後被編輯退回草稿」的）。爬蟲同步以 `external_id` 做 `get_or_create` 去重，列還在就不會被重新匯入成「已發布」；硬刪的話 `external_id` 一起消失，下次同步會把它建回來。
- 前端刪除前會跳站內確認視窗（`confirmAction`），說明狀態與後果；非草稿與爬蟲來源的公告要輸入「刪除」才能確認。

題庫（詞彙、克漏字、是非題、選擇題、情境題）的刪除規則沒有改，仍然只有草稿能刪。

列表每一列只外露一顆最常用的主要動作（草稿／已退件→編輯、待審核→核准、已發布→下架、已下架→重新發布；沒有該權限的角色會退而求其次），其餘收進「⋯ 更多操作」選單，刪除固定在選單最底部。規則在 `src/_admin/reviewWorkflow/reviewActionPolicy.js`（`getReviewActionLayout`），選單元件是 `src/_admin/components/AdminRowMenu.jsx`，用法見 `frontend/static/css/_admin/README.md`。

### 待專家驗證佇列（M5）

讓有資格的工作人員對「量測／基準報表挑出來的候選」留意見（同意／不同意／不確定），例如高頻但辭典沒對到的詞形、形態分析器判斷錯詞根的案例。**這個佇列的意見永遠不會寫回辭典或測驗干擾項**——這條邊界有機械式測試鎖住（掃描 import、patch 辭典連線讓它一碰就失敗，見 `backend/adminapi/test_verification.py`），佇列只佔用 `VerificationItem`／`VerificationObservation`／`VerificationReview` 三張表外加稽核日誌。狀態只描述資料狀況（待專家意見／已有意見／意見分歧），沒有「已驗證」這種狀態，項目一律只稱「待專家驗證的候選」。

```sh
cd backend
python manage.py enqueue_verification_items --from-coverage coverage.json --apply
python manage.py enqueue_verification_items --from-benchmark bench.json --tribe amis --max 100 --apply
```

兩種來源各自驗證報告版本與結構，不接受看起來相似的任意 JSON；寫入前會先驗證全部候選，任何一筆不合法整批都不寫。後台頁面可以匯出待填 CSV、匯入他人填好的 CSV、逐筆留意見；讀取／留意見／匯入／匯出各自是獨立的角色群組，見 `backend/config/roles.py` 的 `VERIFICATION_*` 常數。

### 千詞表對照（2026 千詞表）

把官方 2026 學習詞表的每個詞形，對辭典做**唯讀**比對（同語別唯一同名、未標語別、跨語別、近似形、辭典沒有……這幾類互斥，只依字串規則判斷，不下語言學結論），存進 Django 端的對照表；人工（或滿足嚴格條件時自動）決定要不要接受，接受且未過期的決定才會「只增不減」地套用成辭典裡的來源連結。

```sh
cd backend
python manage.py build_wordlist_mapping --csv-dir "<CSV 所在資料夾>"              # 預覽，不寫任何東西
python manage.py build_wordlist_mapping --csv-dir "<CSV 所在資料夾>" --apply       # 寫入對照表（仍完全不碰辭典）
python manage.py decide_wordlist_mapping --auto-same-dialect --apply             # 自動接受「語別明確相同且唯一同名」的詞形
python manage.py apply_wordlist_mapping --tribe amis --limit 50 --apply          # 套用到辭典（只增不減）
python manage.py revert_wordlist_mapping --batch-id <批次編號> --apply            # 還原某一批套用
python manage.py reconcile_wordlist_journal                                      # 列出套用中斷後留下的待處理紀錄
```

每個指令預設都只預覽（dry-run），要加 `--apply` 才真的寫入。`apply_wordlist_mapping` 每次套用辭典前都先寫一筆操作紀錄（journal），辭典交易成功後才補上寫入後雜湊；寫到一半失敗會留下 pending 紀錄，用 `reconcile_wordlist_journal` 人工對帳，不會自己猜測有沒有寫成功。寫入採 PostgreSQL advisory lock，避免兩個 `--apply` 同時互蓋。

### 形態分析報表與基準（唯讀）

```sh
cd backend
python manage.py report_morphology_capabilities    # 各族放行率／精確率／錯放行率（Wilson 95% 區間）
python manage.py report_morphology_inputs           # 目前校準輸入筆數是否跟放行檔記錄的一致
python manage.py benchmark_morphology                # 在凍結的最終測試切分上重新評估（回歸檢查，不是新測試）
python manage.py measure_sentence_coverage           # 例句對辭典詞形的覆蓋率量測
```

全部只查辭典、讀放行檔，不改任何資料庫或設定；`--format json`／`--output` 的輸出固定順序、同樣資料逐位元組相同，方便存檔比對。後台「系統」底下的「形態分析能力報表」頁面顯示的是 `report_morphology_capabilities` 的結果。

### 把 PostgreSQL 辭典重新匯出成 SQLite 備份

```sh
cd backend
python manage.py export_dictionary_sqlite            # 建立新檔並驗證，不動現有備份
python manage.py export_dictionary_sqlite --install   # 驗證通過後才替換，舊檔另存
```

正式環境辭典是 PostgreSQL（見上方「辭典資料庫」一節）；這個指令只在本機執行，用來產生、更新本機開發用的 SQLite 複本，不影響任何正式環境資料，來源若本身就是 SQLite 會直接拒絕執行。

## 正式部署

目前正式環境是一台 Google Compute Engine VM（Ubuntu 22.04，單機部署）：PostgreSQL 18、Redis、nginx 直接裝在主機上；Django 與 FastAPI 兩個服務跑在 Docker 容器裡，用 `network_mode: host` 直接共用主機網路（容器內的 `localhost` 就是主機的 Postgres/Redis，不用處理跨網路連線的 SSL 問題）。nginx 負責 HTTPS 終止與反向代理：`/api/v1/`（FastAPI），`/crawler/`、`/AIModel/`、`/CrosswordPuzzle/`、`/adminapi/`、`/static/`、`/health/`（Django），其餘路徑回前端 `dist/index.html`（SPA）。

### 一鍵部署

```sh
bash deploy.sh           # 沒有新 commit 就跳過，不會做任何事
bash deploy.sh --force   # 強制重建（例如只改了 .env、沒有新 commit）
```

依序：檢查 `.env`（`DJANGO_DEBUG`／`AUTH_DEV_BYPASS`／`DATABASE_URL`／`DJANGO_SECRET_KEY` 任一項不合格直接中止，避免把開發機的 `.env` 誤部署成正式環境）→ `git pull --ff-only` → 部署前備份 PostgreSQL（Django／辭典兩個資料庫）→ 重建前端與後端 → `docker compose up -d --wait`，等到 Django（`/health/`，會實際探測資料庫與快取）與 FastAPI（`/ready`，快取與發音模型預熱完成才算）都通過健康檢查 → 冒煙測試 nginx 有沒有把 `/AIModel/`、`/api/v1/` 等路徑正確轉發到後端。**任何一步在切到新版之後失敗都會自動回滾**（前端 `dist` 與兩個後端 image 都有 `:prev` 備份點）；資料庫不在回滾範圍內——新版 migration 一旦套用，回滾容器救不了，要靠部署前的備份還原。

完整的部署、回滾、備份／還原演練說明在 **[`deploy/README.md`](deploy/README.md)**，包含環境變數總表、nginx 參考設定、備份保留與還原演練方式、Firebase 規則的部署注意事項——那份文件才是正式環境的權威說明。這裡只整理跟本機開發者切身相關、容易搞混的幾點：

- **兩份 compose 檔不是同一份**：`docker-compose.yml` 是本機用容器重現環境用的（SQLite bind mount，見下方「用容器重現部署環境」）；`docker-compose.prod.yml` 是正式環境專用（PostgreSQL、健康檢查、`:prev` 回滾標籤），只透過 `deploy.sh` 使用。
- `ALLOWED_HOSTS` 用 `DJANGO_ALLOWED_HOSTS`（逗號分隔）設定；程式也相容 Render 會自動注入的 `RENDER_EXTERNAL_HOSTNAME`，但目前部署在 GCE，用不到這個。
- `CSRF_TRUSTED_ORIGINS`、`ALLOWED_ORIGINS`（Django + FastAPI 共用的 CORS 允許來源）都是逗號分隔，要含協定（例如 `https://your-domain`）。
- `DJANGO_DEBUG=False` 時：Swagger UI（`/docs/`）不會掛載（404，只在開發環境可用）；`SECURE_SSL_REDIRECT`／`SESSION_COOKIE_SECURE`／`CSRF_COOKIE_SECURE`／HSTS 會自動開啟，反向代理需要正確設定 `X-Forwarded-Proto`（Django 透過 `SECURE_PROXY_SSL_HEADER` 讀這個標頭判斷連線是否為 HTTPS；nginx 參考設定見 `deploy/nginx.conf`）。
- `collectstatic` 已經包在 `docker-compose.prod.yml` 的啟動指令裡，透過 `deploy.sh` 部署不用手動處理；只有不透過 Docker、直接跑 gunicorn 的情境才需要自己先跑一次（admin／DRF 頁面的 CSS/JS 由 WhiteNoise 從 `STATIC_ROOT` 提供，沒跑過這個指令樣式會跑掉）。
- **FastAPI 辭典快取僅支援單一 process**：Django 寫入辭典／文法資料後，只會發一次 HTTP request 通知 FastAPI 清快取，只會命中其中一個 process。所以 `uvicorn` 不可加 `--workers`，也不可開多個水平 replica，否則部分 instance 會無聲地持續回傳舊辭典資料。水平擴展前要先把快取改成 Redis 等共享機制。
- `REDIS_URL` 沒設定時限流計數會退回單一 process 的記憶體，gunicorn 多 worker 下門檻會被 worker 數量乘倍放大；正式環境的 `.env` 要記得設定。
- `SENTRY_DSN` 建議設定：Django／FastAPI 都已接上 Sentry，沒設定不影響運作，但容器重啟後查不到過去的錯誤記錄，也收不到告警。
- 健康檢查端點：Django `/health/`、FastAPI `/health`（存活探測）與 `/ready`（就緒探測），皆不需要登入。

### 用容器重現部署環境（本機）

```sh
# 需先準備好根目錄 .env（見上方「安裝與設定」）
docker compose up --build
```

這份（`docker-compose.yml`，不是上面正式環境用的 `.prod.yml`）讓你在本機重現跟正式環境一致的容器環境：Django 在 `http://localhost:8000`、FastAPI 在 `http://localhost:8001`，兩者健康檢查已接上 `healthcheck:`。`backend/dictionary_db/dictionary.db` 與 Django 的 `backend/db.sqlite3`（皆為 gitignored 的 SQLite 檔案）透過 bind mount 從本機掛進容器，不會被打進 image；本機沒有這兩個檔案時容器仍能啟動，但對應的資料查詢不會有內容。

沒有本機 Docker 環境、也不透過 `deploy.sh` 時，仍可依上方「啟動專案（開發環境）」或手動指令直接跑：

```sh
# Django（WSGI）
cd backend && gunicorn core.wsgi:application --bind 0.0.0.0:$PORT

# FastAPI（ASGI）
cd backend && uvicorn fastAPI.main:app --host 0.0.0.0 --port $PORT
```

`run.py`／`run_fastapi.py` 僅供本機開發（綁定 `127.0.0.1`，啟動前會檢查必填環境變數），不是正式環境的啟動方式。

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
