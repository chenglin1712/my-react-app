# 部署、回滾與備份

這個目錄放正式環境部署用的輔助檔案。部署入口是專案根目錄的 `deploy.sh`。

| 檔案 | 用途 |
|---|---|
| `../deploy.sh` | 一鍵部署：檢查 `.env` → 備份 → 建置 → 等健康檢查 → 檢查反向代理；失敗自動回滾 |
| `backup.sh` | 備份 PostgreSQL（可選：Firestore、Storage） |
| `nginx.conf` | 反向代理參考設定（範本，需改成你的網域與路徑）；含速率限制與覆寫 `X-Forwarded-For` |
| `nginx-security-headers.conf` | 瀏覽器安全標頭（HSTS、nosniff、frame、Referrer、Permissions、CSP）；`nginx.conf` 會 include 它 |
| `../storage.rules` | Storage 規則草案（**尚未部署**，見下方〈Firebase 規則〉） |

## 部署流程做了什麼

1. **`.env` 防呆**：`DJANGO_DEBUG` 或 `AUTH_DEV_BYPASS` 為 True、缺少 `DATABASE_URL` 或 `DJANGO_SECRET_KEY`
   時直接中止。這兩個旗標同時為 True 會略過登入驗證（見 `backend/config/auth_flags.py`）。
2. `git pull --ff-only`。
3. **部署前備份**（`SKIP_BACKUP=1` 可略過，不建議）。備份失敗就中止，不會繼續 migrate。
4. 留下回滾點：前端 `dist` 複製為 `dist.prev`，兩個後端 image 標成 `:prev`。
5. 重建前端與後端，`docker compose up -d --wait` 等到兩個服務都通過健康檢查：
   - Django：`/health/`（會實際探測資料庫與快取）
   - FastAPI：`/ready`（快取與發音模型預熱完成前回 503）
6. **任何一步失敗就自動回滾**：還原 `dist.prev`，把 `:prev` 標回 `:latest`，重新啟動上一版容器。
7. 檢查反向代理：首頁、`/health/`，以及 `POST /AIModel/tayal_chat/`、`POST /api/v1/translation/translate`
   （不帶 token，預期被後端以 401 擋下；回 404 代表代理沒有轉發）。這一步失敗只報錯、不回滾，
   因為容器本身是健康的，要修的是代理設定。

### 回滾的限制

- **資料庫不會回滾。** 後端容器啟動時會自動 `migrate`；如果新版的 migration 與舊版程式不相容，切回舊
  image 也救不了，要用部署前的備份還原。需要不相容的 schema 變更時，請拆成兩次部署（先加欄位、再移除舊欄位）。
- **git 不會自動回退。** 回滾後腳本會印出上一版的 commit，要讓工作目錄一起回去請手動 `git reset --hard <commit>`，
  否則下次 `git pull` 與 `deploy.sh` 會判斷成「已是最新」。
- 第一次部署沒有 `:prev`，無法自動回滾。

## 備份與還原

```bash
bash deploy/backup.sh                       # 備份到 ./backups（保留 14 天）
BACKUP_DIR=/mnt/backup RETENTION_DAYS=30 bash deploy/backup.sh
```

備份會檢查檔案不是空的，且能被 `pg_restore --list` 讀出目錄；損毀的檔案會被刪除並讓腳本失敗。

備份需要 `python3`（拆解資料庫連線字串）。資料庫密碼只經由環境變數傳給 `pg_dump`，不會出現在命令列參數（同一台機器上看得到 process 清單的人也看不到）。連線字串裡的使用者名稱與密碼若含特殊字元，需用百分比編碼（例如 `@` 寫成 `%40`）。

Firestore 與 Firebase Auth 預設**沒有**被備份。要備份 Firestore，設定
`FIRESTORE_BACKUP_BUCKET=gs://你的備份bucket`（需要 `gcloud` 並授權）；要備份 Storage，設定
`STORAGE_SOURCE_BUCKET` 與 `STORAGE_BACKUP_BUCKET`（需要 `gsutil`）。Firebase Auth 的使用者帳號請另外用
`firebase auth:export` 匯出。

建議用 cron 每天跑一次，例如：`0 3 * * * cd /srv/yuanyu && bash deploy/backup.sh >> logs/backup.log 2>&1`。

### 首頁宣傳影片媒體

後台上傳的影片、封面、字幕存在 `<repo>/media/homepage/`（容器內 `/app/media`，由 `docker-compose.prod.yml` 掛載），
nginx 直接送檔，Django 寫入同一個目錄。**第一次部署前請先做完下面幾件事：**

1. **磁碟快照：** 在 Google Cloud 為開機磁碟設定每日快照，保留 7 天。**這一項是前置條件，沒做完不要上傳正式影片。**
2. **建立目錄並限制權限：** `mkdir -p media/homepage/{video,cover,caption}`，目錄只讓部署帳號與容器寫入；
   一般帳號不可修改。**不可以是符號連結**（`python manage.py check_promo_media` 會檢查）。
3. **nginx：** 套用 `deploy/nginx.conf` 新增的 `/media/homepage/` 與 `/adminapi/promo-videos/` 兩段，`nginx -t` 後重新載入。
4. **備份：** `backup.sh` 會把 `media/homepage` 鏡像到 `$BACKUP_DIR/media/`（檔名是 uuid 且不修改，鏡像不必每天打包）。
   資料庫與媒體分開備份，**可能還原出「引用不存在檔案」的資料**，所以：
   - 還原順序：先還原資料庫，再把鏡像複製回 `media/homepage`，最後執行 `python manage.py check_promo_media` 確認。
   - 被取代或刪除的舊檔保留 14 天（大於快照保留期 7 天）才清除，還原後引用的檔案仍在。
5. **排程（cron）：**
   - 每天一次：`python manage.py cleanup_promo_media --apply`（先不加 `--apply` 預覽）。
   - 每 15 分鐘一次：`python manage.py check_promo_media`，結束碼非 0 或日誌出現 `PROMO_MEDIA_MISSING` 時要通知你。
     公開首頁在檔案遺失時只會安靜降級成「影片無法播放」，沒有這個檢查就只能靠訪客回報。
6. **磁碟空間：** 上傳 150MB 的影片時，nginx 會先暫存整個請求，Django 再寫入暫存目錄，最多同時占用約 3 倍。
   請確認 nginx 暫存路徑所在磁碟與 `media/` 所在磁碟都有足夠空間，並定期查看 `df -h`。
7. **資源配額：** 後端上傳端點每位使用者 10 分鐘最多 6 次，只有 owner、admin 能上傳；磁碟剩餘空間低於「2 倍檔案上限加 1GB」時
   上傳會被拒絕（回 507，日誌 `PROMO_MEDIA_DISK_LOW`）。
8. **ffprobe 的風險：** 後端用 ffprobe 檢查上傳的影片，這是處理不可信檔案的地方。已加協定白名單與 CPU、記憶體上限，
   但仍在 Django 容器內執行。請保持 FFmpeg 更新（重建 image 時會裝到當時的 Debian 版本），並考慮替容器設定記憶體上限。
   更穩的做法是獨立的媒體處理容器，目前沒有做。
9. **第一次部署後的 smoke test（照順序做，缺一不可）：**
   - `nginx -t` 通過後重新載入。
   - 用後台上傳一支正常的小影片（faststart 的 MP4）：預期成功。**若所有影片都回「無法讀取這個影片檔」，可能是 ffprobe 的資源上限
     （`FFPROBE_MAX_ADDRESS_SPACE`）對這個環境太緊，先看伺服器日誌的 `ffprobe failed` 再調整。**
   - `curl -I https://網域/media/homepage/video/<檔名>.mp4`：預期 `200`、`Content-Type: video/mp4`、`X-Content-Type-Options: nosniff`、
     `Cache-Control: public, max-age=31536000, immutable`。
   - `curl -I -H "Range: bytes=0-99" ...` 同一個網址：預期 `206` 與 `Content-Range`。
   - `curl -I https://網域/media/homepage/video/不存在.mp4`：預期 `404`，而且**沒有** `immutable`。
   - `curl -I https://網域/media/_staging/` 與 `https://網域/media/`：預期 `404`。
   - 在 `media/homepage/video/` 放一個指向其他目錄的符號連結再請求：預期 `404`（`disable_symlinks on`），測完刪除。
   - 執行 `python manage.py check_promo_media`：預期 `OK`。

### 還原演練（每季至少做一次，沒有還原成功過就不算有備份）

在**另一個空的資料庫**（不是正式資料庫）上演練：

```bash
createdb yuanyu_restore_test
pg_restore --no-owner --dbname=yuanyu_restore_test backups/django-<時間>.dump
psql yuanyu_restore_test -c "SELECT count(*) FROM django_migrations;"
psql yuanyu_restore_test -c "SELECT count(*) FROM auth_user;"      # 依實際資料表調整
dropdb yuanyu_restore_test
```

演練紀錄至少包含：日期、使用的備份檔、還原耗時、抽查的資料表與筆數。

## 反向代理

`nginx.conf` 是範本。路徑對照來源：

- Django（127.0.0.1:8000）：`/health/`、`/crawler/`、`/AIModel/`、`/CrosswordPuzzle/`、`/adminapi/`、`/static/`
- FastAPI（127.0.0.1:8001）：`/api/v1/`
- 其餘路徑回前端 `dist/index.html`（SPA）
- `/internal/` 一律拒絕：它是 Django 呼叫 FastAPI 的服務對服務端點，不該對外

改完後先 `nginx -t` 檢查語法，再執行 `deploy.sh`，結尾的路由檢查會確認轉發正確。

### 安全標頭與速率限制（S-08、S-09）

1. 先安裝標頭片段，`nginx.conf` 才 include 得到（少了這步 `nginx -t` 會失敗）：
   `sudo mkdir -p /etc/nginx/snippets && sudo cp deploy/nginx-security-headers.conf /etc/nginx/snippets/yuanyu-security-headers.conf`
2. 速率限制：`limit_req_zone` 只能放 http 層，`nginx.conf` 放在 `conf.d/` 時最上面那幾行就在 http 層；若放在 `sites-available/` 也是被 include 進 http，同樣可用。數字刻意寬鬆（一般 30 r/s、昂貴端點 5 r/s、每 IP 100 條連線），因為學校、公司可能共用一個對外 IP。上線後看 `error.log` 裡的 `limiting requests`，再調整。
3. `X-Forwarded-For` 現在由 nginx 直接設成連線 IP，不再保留客戶端帶來的值。日後前面再加 CDN／負載平衡器時，要用 nginx 的 `real_ip` 模組只信任它們的網段，並把它們的位址加進後端的 `TRUSTED_PROXY_IPS`。
4. **CSP 目前只是 Report-Only**（不阻擋）。在瀏覽器 Console 看過常用頁面沒有 `[Report Only] Refused to ...` 之後，才改成正式執行；改之前要先把 `index.html` 的內嵌防閃白腳本和字型 `<link>` 的 `onload` 處理掉，詳見 `nginx-security-headers.conf` 的註解。
5. 我沒有在真實 nginx 上驗證過這些設定（開發機沒有 nginx）。部署前務必 `nginx -t`，並用瀏覽器與 `curl -I https://你的網域/` 確認標頭。

## Firebase 規則

目前**沒有**變更任何線上的 Firebase 規則，Firestore、Realtime Database、Storage 都沿用現有設定。

- `firestore.rules`、`database.rules.json`：與原本相同，沒有修改。
- `storage.rules`：**草案，尚未部署。** 只供審閱與測試，沒有寫進 `firebase.json`，所以 `firebase deploy`
  不會把它部署出去，Firebase Console 上現有的 Storage 規則維持不變。
- 規則測試用的設定放在 `firebase.rules-test.json`（只給模擬器用），CI 以
  `firebase emulators:exec --config firebase.rules-test.json` 執行，不影響 `firebase.json`。

### 日後若要啟用 `storage.rules`

這是有風險的操作，請先確認以下事項，再自己決定要不要做：

1. 到 Firebase Console 查看目前 Storage 的規則與 bucket 內的檔案路徑，確認除了
   `pronunciations/{族語}/{單字}/{uuid}_{uid}.webm` 之外，沒有其他功能（前端或後台）會寫入 Storage。
   這份規則對其他路徑一律拒絕。
   另外請確認專案沒有用 Admin SDK 建立「自訂 UID」帳號（規則把 UID 串進正規表示式，細節見
   `storage.rules` 開頭的〈已知限制〉）。
2. 先在測試用的 Firebase 專案部署並實際錄音上傳一次。
3. 部署時一定要指定範圍，避免連帶覆蓋其他規則：`firebase deploy --only storage`。
   同時需要先在 `firebase.json` 加上 `"storage": {"rules": "storage.rules"}`。

## 環境變數（正式環境）

| 變數 | 說明 |
|---|---|
| `DJANGO_DEBUG` | 必須是 `False` 或不設定 |
| `AUTH_DEV_BYPASS` | 必須是 `False` 或不設定 |
| `DATABASE_URL` | 必填（PostgreSQL）。`docker-compose.prod.yml` 已設 `REQUIRE_DATABASE_URL=true`，漏設會啟動失敗 |
| `LLM_TIMEOUT_SECONDS` | 單次 LLM 請求逾時，預設 25 |
| `LLM_MAX_RETRIES` | LLM 重試次數，預設 1 |
| `LLM_BREAKER_THRESHOLD` | 連續失敗幾次後暫停呼叫，預設 5 |
| `LLM_BREAKER_COOLDOWN_SECONDS` | 暫停多久後再試探，預設 30 |
| `SENTRY_DSN` | 建議設定。Django 與 FastAPI 都已接上 Sentry，沒設定就不會送出任何錯誤告警（`deploy.sh` 缺少時只印警告、不中止）。已關閉 `send_default_pii`，不會附帶使用者個資 |

調整 LLM 逾時時，逾時預算要由內而外逐層放大：LLM 最長等待 `(重試+1) × 單次逾時 + 退避`（預設約 55 秒）
< gunicorn `--timeout`（75 秒，`docker-compose.prod.yml`）< nginx `proxy_read_timeout`（90 秒，`deploy/nginx.conf`）。
`backend/config/test_llm_resilience.py` 會檢查這個關係。

## 已知的行為取捨

- **收藏與行事曆需要連線。** 這兩項改用 Firestore transaction 後，使用者離線時操作會立即失敗，
  不再像一般寫入那樣先排進離線佇列、連線後再同步（Firestore Web SDK 的 transaction 不支援離線）。
  前端會還原樂觀更新並顯示錯誤。若日後需要離線編輯，要改資料模型（每筆收藏、每個行程各一份文件）。
- **發音模型預載最多重試 3 次。** 仍失敗時 `/ready` 維持 503，部署會被判失敗並回滾，這是刻意的：
  權重檔損毀時不該把壞版本放上線。
