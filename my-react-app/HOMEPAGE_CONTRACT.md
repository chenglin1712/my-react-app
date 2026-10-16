# 首頁資料契約與相容部署順序（S3-0）

這份文件是 S3-1 到 S3-4（後端）、S4（後台）、S6 與 S7（前台）共同遵守的契約。**不改任何程式**。決定寫在這裡，後面的步驟照做；要變動先改這份文件。

狀態標記：**[已查證]** 是我讀過 repo 程式碼確認的事實；**[決定]** 是這份契約定下的規則；**[待確認]** 需要使用者或現場驗證。

## 1. 現況（已查證）

| 項目 | 事實 | 來源 |
| --- | --- | --- |
| 公開設定端點 | `GET /adminapi/public/homepage-config/`，免登入，依 IP 限流 120/m，每次直接讀資料庫，沒有任何快取標頭 | `backend/adminapi/homepage_config_views.py` |
| 後台設定端點 | `GET`（STAFF_ROLES）、`PATCH`（PUBLISHERS = owner、admin，限流 30/m），在 transaction 內鎖住單例列，寫稽核紀錄 | 同上 |
| 設定模型 | `HomepageConfig`（單例，pk 固定 1）：`hero_image_url`、`hero_link_url`、`hero_title_override`、`show_news_section`、`show_calendar_section`（控制族語認證區塊）、`news_display_count`（1 到 20）、`button1~3_enabled` | `models/content.py` |
| 前台合併方式 | `{ ...DEFAULT_HOMEPAGE_CONFIG, ...data }`，所以多出來的未知欄位會被忽略、缺少的欄位退回預設值；載入失敗時整包用預設 | `frontend/src/_home/index.jsx` |
| 伺服器快取 | nginx 只對 `/assets/` 與 `/` 設標頭，`/adminapi/` 純轉發不快取；Django 的 Redis cache 沒有用在這個端點 | `deploy/nginx.conf` |
| 公告審核流程 | 狀態：草稿、待審核、已退件、已發布、已下架。新增與送審：owner、admin、editor；核准、退件、下架、重新發布：owner、admin | `views.py`、`config/roles.py` |
| 編輯已發布內容 | `PendingRevision` 是通用機制（`target_type` 是字串），新模型可直接沿用，不必另建表 | `adminapi/revisions.py` |
| 上傳上限 | nginx `client_max_body_size 12m`；現有圖片走 Cloudinary 前端直傳，後端只存網址 | `deploy/nginx.conf` |
| 備份 | `backup.sh` 只備份 PostgreSQL（選擇性 Firestore、Storage），**不含任何本機檔案目錄**；`deploy.sh` 部署前會先呼叫它 | `deploy/backup.sh`、`deploy.sh` |
| 容器儲存 | `docker-compose.prod.yml` 只掛 `serviceAccountKey.json` 與 `logs`，沒有媒體目錄；容器內檔案重建即消失 | `docker-compose.prod.yml` |
| 舊程式與新 `target_type` | 審核佇列遇到不認得的 `PendingRevision.target_type` 會直接略過（`continue`），不會報錯；所以舊 image 讀到 `featured_topic` 的待審修改是安全的 | `review_queue_views.py` |
| 影片工具 | 後端 image 已安裝 `ffmpeg` 與 `ffprobe`，不必新增系統套件就能做實際檢查 | `backend/Dockerfile` |
| Django admin | 只註冊了 `AuditLog`，其他模型沒有可繞過鎖的後門 | `admin.py` |
| 公告刪除規則 | 只有草稿、已退件、已下架可刪；有待審修改時拒絕；從沒送審的草稿硬刪，其餘軟刪除並留稽核 | `views.py` |
| 圖片上傳通道 | 前端用 `VITE_CLOUDINARY_CLOUD_NAME` 直傳 Cloudinary，後端不知道 cloud name，目前對網址只驗 https | 前端 `useMediaUpload.js` |
| 內容安全政策 | repo 內**沒有任何** CSP：Django 沒有 CSP middleware、`deploy/nginx.conf` 與 `index.html` 都沒設 | 全 repo 搜尋 |
| 回滾範圍 | 回滾只還原前端 dist 與兩個 image，**不含資料庫 schema**；新 migration 與舊程式不相容時，切回舊 image 救不了 | `deploy.sh` 開頭註解 |

**[待確認]** `deploy/nginx.conf` 是範本，伺服器上實際的設定我看不到。請在能連線的電腦執行 `curl -sI https://你的網域/ | grep -i content-security`，沒有輸出就代表現場也沒有 CSP。

## 2. 設計原則

1. **全部加法。** S3 的 migration 只新增資料表、可為空或有預設值的欄位。不改名、不刪欄位、不改型別。理由：回滾救不了 schema，舊程式必須能在新 schema 上正常運作。
2. **新欄位全部可為空，舊前端忽略未知欄位。** 公開端點現有的鍵（名稱、型別）一個都不動。
3. **空值就不顯示。** 前台沒有任何編造的預設文字，也不寫死任何族語詞。後台輸入框的提示範例同樣不放族語詞。
4. **公開端點出錯不拖垮首頁。** 每個區段各自讀取、各自失敗，失敗時該區段退回自己的空狀態，其餘照常顯示。
5. **影片、封面、字幕只能是自己網域的檔案。** 資料庫只存相對路徑，由後端組成公開網址，不接受任何外部網址。

## 3. 欄位與限制

所有文字欄位先去除前後空白；單行欄位不接受換行與控制字元；長度以字元數計。前台一律以純文字渲染（React 預設跳脫），不渲染 HTML。

### 3.1 `HomepageConfig` 新增欄位（S3-1、S3-2，全部加法）

| 欄位 | 型別 | 限制 | 預設 | 缺值時前台行為 |
| --- | --- | --- | --- | --- |
| `active_promo_video` | 外鍵指向宣傳影片，可為空，刪除影片時設為空 | 必須存在，且該影片已有影片檔 | 空 | 宣傳區改顯示備援（見 4.3），不顯示壞掉的播放器 |
| `marquee_items` | 字串清單 | 最多 10 項，每項 1 到 40 字，單行 | 空清單 | 不輸出跑馬燈元素 |
| `show_marquee` | 布林 | | 是 | 同上；關閉時即使有內容也不顯示 |
| `tagline` | 單行字串 | 最多 60 字 | 空 | 報頭不輸出標語，不留空位 |
| `show_tagline` | 布林 | | 是 | 同上 |
| `quote_text` | 單行字串 | 最多 120 字 | 空 | 報頭中欄不輸出引言（正式文案是決定 D2，待使用者提供） |
| `show_quote` | 布林 | | 是 | 同上 |

既有欄位（`hero_*`、`show_*`、`news_display_count`、`button*_enabled`）規則與驗證完全不變，繼續當備援。

**S3-2 補充規則（已實作，Codex 審查後）：**
- **長度以 Unicode 碼位計算，不做 NFC 正規化。** 族語的組合符號寫法由使用者決定，專案對族語字型涵蓋有嚴格管控，儲存時不悄悄改寫字形；代價是分解形式（基底字加組合符號）比預組形式多占碼位。版面仍需 CSS 換行或截斷，40 碼位不等於固定顯示寬度。
- **單行欄位（標語、引言、跑馬燈項目、影片標題）拒絕：** 控制字元與 C1 控制字元、`U+2028`、`U+2029`（Unicode 換行）、零寬字元 `U+200B`、`U+2060`、`U+FEFF`（整串只有它們時看起來是空白卻能通過非空檢查）、雙向控制字元（視覺欺騙）。一般組合符號保留。`U+200C`、`U+200D` 刻意放行，因為沒有查證過所有族語書寫系統是否用到。
- **驗證只保證經過 serializer 的寫入。** 模型欄位的 validators 不會在一般 `save()` 或 `QuerySet.update()` 自動執行；管理命令或後台動作若要直接寫這些欄位，必須自己呼叫 `full_clean()`。Django admin 不註冊 `HomepageConfig`。不加資料庫 CheckConstraint（開發用 SQLite 與正式 PostgreSQL 的 JSON 約束語法不同）。
- **跑馬燈的前台義務（S6）：** 自動捲動超過 5 秒必須有可見的暫停控制（WCAG 2.2.2），使用者設定減少動態時改為靜態呈現（全部項目可讀），文字一律以純文字節點渲染。

**驗證寫在模型欄位的 `validators`**（集中在一個共用模組），不是只寫在 serializer：DRF 的 ModelSerializer 會自動套用，管理命令與測試也走同一份，不會因為換寫入路徑就繞過。`marquee_items` 的型別（必須是字串清單）、項數、每項長度與「去空白後不得為空」都在這裡檢查。所有文字一律拒絕 NUL 與控制字元（單行欄位另外拒絕換行）。

### 3.2 `PromoVideo`（新資料表，S3-1）

| 欄位 | 型別 | 限制 | 備註 |
| --- | --- | --- | --- |
| `title` | 字串 | 1 到 60 字 | 必填 |
| `description` | 字串 | 最多 300 字，可空 | |
| `video_path` | 相對路徑字串 | 可空（先建紀錄、再上傳）；格式 `homepage/video/<32 位十六進位>.mp4` | 由 S3-4 的上傳端點寫入，**不接受使用者在一般 PATCH 直接指定** |
| `cover_path` | 相對路徑字串 | 可空；`.jpg` 或 `.webp` | 同上 |
| `caption_path` | 相對路徑字串 | 可空（選填，使用者決定不提供字幕）；`.vtt` | 同上 |
| `transcript` | 文字 | 最多 6000 字，可空 | 無字幕時的文字逐字稿，影片失敗時也顯示 |
| `duration_seconds` | 整數 | 唯讀，可空 | 由 S3-4 上傳驗證寫入；空代表未知 |
| `size_bytes` | 整數 | 唯讀，可空 | 同上 |
| `created_by`、`created_at`、`updated_at` | | 唯讀 | |

**沒有 `is_active` 欄位。** 「目前啟用哪一支」只由 `HomepageConfig.active_promo_video` 決定，避免兩個地方不一致。一次只啟用一支。

大小與長度上限（使用者影片約 5 到 7 分鐘）：影片 150MB 內、8 分鐘內、MP4（H.264 加 AAC）；封面 2MB 內；字幕 200KB 內。上限由 S3-4 的上傳端點強制，這裡先定數字。

**檔案生命週期（S3-4 必須遵守，來自 Codex 審查）：**
- **不原地替換檔案。** 要換影片就上傳新檔，得到新的 uuid 路徑，成功後才更新紀錄；舊路徑寫進「待清理」清單，**不在請求內直接刪檔**。
- **延遲清理 14 天。** 清理指令只刪「已超過 14 天且沒有任何紀錄引用」的檔案。14 天大於快照保留期 7 天，萬一從備份還原資料庫，還原後引用的檔案仍在。
- **刪除正在啟用的影片一律拒絕**（要先把 `active_promo_video` 設為空，兩個動作各有稽核）。
- **鎖順序固定（S3-1 已實作於啟用端，S3-4 的替換、刪除端點必須遵守）：** 先鎖 `HomepageConfig` 單例列，再鎖該筆 `PromoVideo` 列。啟用時在同一個 transaction 內鎖住要啟用的影片再驗證，避免「驗證時有影片檔、提交前被清掉」，也避免兩邊順序相反造成死結。
- **數值上限寫在欄位 validators**（`duration_seconds` 1 到 480、`size_bytes` 1 到 150MB），不用資料庫 CheckConstraint，日後調整上限不需要 migration。兩個欄位在任何 serializer 都必須唯讀，只能由 S3-4 以實際檔案檢測結果寫入。
- 上傳流程：先寫入**不對外公開的暫存目錄** -> 驗證 -> 原子重新命名到公開目錄 -> 才寫進資料庫。任何一步失敗，資料庫不變、暫存檔清掉。

**驗證不只看副檔名與 MIME（S3-4）：**
- 影片：用 `ffprobe` 實際檢查容器是 MP4、恰好一條 H.264 視訊與至多一條 AAC 音訊、長度 8 分鐘內、寬度不超過 1920。另外解析 MP4 的 box 順序，**`moov` 必須在 `mdat` 之前**（快速開始播放）；不是的話拒絕並回覆要用 `ffmpeg -i 原檔 -c copy -movflags +faststart 新檔.mp4` 處理。
- 封面：實際解碼，限制像素尺寸（寬高各不超過 4000），只收 JPEG、WebP，**不收 SVG**。
- 字幕：UTF-8、以 `WEBVTT` 開頭、能解析出 cue；內容不當 HTML 渲染。
- 路徑：寫入前 `realpath` 必須落在媒體根目錄內，不跟隨符號連結。

### 3.3 `FeaturedTopic`（新資料表，S3-3，決定 D8：走審核）

| 欄位 | 型別 | 限制 | 備註 |
| --- | --- | --- | --- |
| `title` | 字串 | 1 到 40 字 | 必填 |
| `summary` | 字串 | 最多 120 字，可空 | |
| `image_url` | 網址 | 必須是 https，且主機必須是 `res.cloudinary.com`（若後端設了 `CLOUDINARY_CLOUD_NAME`，路徑還必須以 `/<cloud_name>/` 開頭），可空 | 沿用現有 Cloudinary 上傳通道，但後端收緊為白名單，不收任意 https 圖片（避免追蹤訪客 IP，也讓日後 CSP 的 `img-src` 能列白名單） |
| `link_url` | 字串 | 沿用 `validate_hero_link_url`：內部路徑（`/` 開頭且不是 `//`、反斜線先正規化）或 https | 可空 |
| `category_label` | 字串 | 最多 12 字，可空 | 自由文字，不做族語或分類寫死 |
| `sort_order` | 小整數 | 0 到 99 | 小的在前，同值依 id |
| `status` | 選項 | 草稿、待審核、已退件、已發布、已下架 | 與公告同一套狀態名稱 |
| `submitted_by`、`submitted_at`、`reviewed_by`、`reviewed_at`、`review_comment` | | 唯讀 | 與公告同義 |
| `created_by`、`created_at`、`updated_at` | | 唯讀 | |

規則：
- **狀態轉換與角色完全比照公告**：新增、編輯、送審、撤回：owner、admin、editor；核准、退件、下架、重新發布：owner、admin。
- **同時「已發布」最多 3 筆**：核准與重新發布時，在 transaction 內鎖住 `HomepageConfig` 單例列（序列化所有人的檢查），數到已有 3 筆就回 409 並說明要先下架哪一筆。公開端點另外硬性只回前 3 筆，作為第二道防線。
- **編輯已發布的專題**走 `PendingRevision`（`target_type = "featured_topic"`），不先下架，與公告相同。
- 所有寫入都寫稽核紀錄（`target_type = "featured_topic"`）。
- **「轉為已發布」只有一條程式路徑**：一個服務函式負責核准、重新發布與核准修改，內容依序是：鎖 `HomepageConfig` 單例列（確認列存在）-> 重新計算已發布筆數並**排除目前這一筆** -> 對核准修改的情況，用 `FeaturedTopic` 的 serializer **重新驗證 payload** -> 才寫入。不得有第二條路徑直接 `update(status=...)`；Django admin 不註冊這個模型。
- **刪除比照公告**：只有草稿、已退件、已下架可刪；有待審修改時拒絕；從沒送審的草稿硬刪，其餘軟刪除。刪除時呼叫 `cancel_stale_pending_revision`，不留孤兒待審修改。
- **要登記到審核佇列**（`review_queue_views.py` 的 `_CONTENT_TYPES`），否則待審的專題不會出現在審核者的待辦裡。PendingRevision 的 payload 白名單只含可編輯欄位，禁止帶 `status`、審核者等唯讀欄位。
- 排序固定為 `sort_order, id`，兩個公開與後台列表一致。

**S3-3 實作補充（已實作，Codex 審查後）：**
- **端點：** 後台 `/adminapi/featured-topics/`（列表、新增）、`<id>/`（讀取、PATCH、DELETE）、`<id>/submit|withdraw|approve|reject|unpublish|republish/`、`<id>/pending-revision/`（含 `approve/`、`reject/`）；公開 `/adminapi/public/featured-topics/`。後台列表至多 200 筆，可用 `?status=` 篩選，每筆帶 `has_pending_revision`。
- **唯一的發布路徑：** `featured_topic_service.publish_topic()`，簽章 `(pk, *, expected_status, actor_uid, record_review=False, review_comment="")`。`actor_uid` 必填（發布是治理行為，空值直接 `ValueError`）。核准傳 `record_review=True`，重新發布不更動審核紀錄。審核修改不經過這裡，因為狀態本來就是已發布、不改變筆數。
- **鎖順序：** 先鎖 `HomepageConfig` 單例列，再鎖專題列。下架、撤回、退件、刪除、PATCH 只鎖專題列，不會形成相反順序的死結。
- **發布前重新驗證：** 核准與重新發布會對整筆內容 `full_clean()`（驗證規則可能在送審後變嚴），失敗回 409 並列出欄位；核准修改套用前，`revisions.py` 對模型 `full_clean()`，因為驗證寫在模型欄位的 validators，兩條路徑檢查的是同一份規則。
- **圖片網址：** https、主機剛好是 `res.cloudinary.com`（比對 `urlsplit().hostname`，結尾點、`@` 帳密、非 443 埠號、反斜線、空白、不可見字元一律拒絕）；路徑不可有 `.` 或 `..` 段，也不可有 `%2e`、`%5c`、`%00` 到 `%1f` 等編碼寫法（`/mycloud/../othercloud/x` 能通過前綴比較，但下游正規化後是別人的帳號）；整段解析包在 `try`，不合法的 IPv6 括號等回 400 而不是 500。
- **連結：** 內部路徑或 https；拒絕帳密、控制字元、`%00` 到 `%1f` 與 `%5c` 編碼（nginx、Django、瀏覽器對這些的正規化可能不一致）。
- **Cloudinary 帳號限制是選配：** 後端環境變數 `CLOUDINARY_CLOUD_NAME` 未設定時，任何 Cloudinary 帳號的圖片都能通過。為避免讓既有部署啟動失敗，只做部署檢查警告（`python manage.py check --deploy` 會回報 `adminapi.W001`）。**部署前請在後端設定與前端 `VITE_CLOUDINARY_CLOUD_NAME` 相同的值**（同一個值，不需要新金鑰）。
- **刪除：** 從沒送審過的草稿（`submitted_at` 為空）硬刪；曾送審過的一律軟刪，即使後來撤回成草稿也一樣（保留存在過的痕跡）。軟刪的稽核紀錄保留 id、操作者與刪除前快照。審核佇列與公開端點、一般列表都只看沒被軟刪除的資料。
- **不變量的邊界：** 「最多 3 筆」由服務函式與公開端點的硬上限守住。直接用 ORM（`update(status=...)`）、資料修復腳本仍可繞過；Django admin 不註冊這個模型（有測試）。管理命令要改狀態必須呼叫 `publish_topic()`。若日後要求任何寫入來源都不能超過三筆，才需要 PostgreSQL trigger。
- **並行測試的限制（請知悉）：** 開發與 CI 用 SQLite，`select_for_update()` 在 SQLite 不提供列鎖，所以**單元測試只證明邏輯正確，不能證明兩個同時核准會被序列化**。在 PostgreSQL 下單例列鎖在 READ COMMITTED 隔離層級是成立的（第二個交易等待、取得鎖後重新計數），但這一點尚未在真實 PostgreSQL 上以雙連線實測。S3-4 動手前的部署驗證清單要加一項：在 staging 的 PostgreSQL 上，已有兩筆已發布時，同時核准兩個不同專題，最終只能一筆成功。

## 4. 公開端點格式

### 4.1 `GET /adminapi/public/homepage-config/`（既有端點，只加欄位）

```json
{
  "hero_image_url": "", "hero_link_url": "", "hero_title_override": "",
  "show_news_section": true, "show_calendar_section": true, "news_display_count": 6,
  "button1_enabled": true, "button2_enabled": true, "button3_enabled": true,

  "promo_video": null,
  "marquee_items": [], "show_marquee": true,
  "tagline": "", "show_tagline": true,
  "quote_text": "", "show_quote": true
}
```

啟用中的影片存在時，`promo_video` 是：

```json
{
  "id": 3, "title": "…", "description": "…",
  "video_url": "/media/homepage/video/<id>.mp4",
  "cover_url": "/media/homepage/cover/<id>.webp",
  "caption_url": null,
  "transcript": "",
  "duration_seconds": 412,
  "available": true
}
```

- `video_url`、`cover_url`、`caption_url` 都是**同網域的相對路徑**或 `null`，由後端用 `video_path` 等欄位組出，不是使用者輸入的字串。
- **只要有啟用中的影片就輸出物件**，不因為缺檔而整個變成 `null`，否則前台拿不到 `transcript` 與封面。物件多一個布林欄位 `available`：影片檔存在才是 `true`（後端在請求時對檔案做一次存在檢查）。`available` 為 `false` 時 `video_url` 是 `null`，前台直接進入「影片無法播放」狀態（顯示封面、錯誤說明與逐字稿）。
- 沒有啟用中的影片時 `promo_video` 才是 `null`。
- `available` 為 `true` 後檔案仍可能在傳送前消失（競態），所以前台的播放失敗狀態（4.3）依然必須實作。
- 不輸出 `created_by`、檔案大小等後台資訊。
- **開關關閉時，公開端點不輸出對應內容：** `show_marquee`、`show_tagline`、`show_quote` 為 `false` 時，`marquee_items` 回 `[]`、`tagline` 與 `quote_text` 回 `""`（開關本身照常輸出）。管理者可能先存了還沒要公開的文案再關掉開關，內容留在資料庫、後台仍看得到，重新開啟即發布，但不能從公開端點被讀走。

### 4.2 `GET /adminapi/public/featured-topics/`（新，S3-3）

回傳 `{ "items": [ { "id", "title", "summary", "image_url", "link_url", "category_label" } ] }`，只含已發布，依 `sort_order`、`id` 排序，最多 3 筆；免登入，依 IP 限流 120/m。**獨立端點**，與設定端點各自失敗、各自快取，專題讀取失敗不影響設定。

### 4.3 缺值與失敗時前台必須處理的狀態

| 區段 | 情況 | 前台行為 |
| --- | --- | --- |
| 設定端點 | 請求失敗或逾時 | 用預設設定（目前行為）：無影片、無跑馬燈、無標語、無引言 |
| 報頭 | 引言、標語為空或關閉 | 不輸出該元素，不留空位也不放示意文字；「原語」與「YUAN・YU」是固定品牌字，不受影響 |
| 跑馬燈 | 清單空、或關閉 | 不輸出元素 |
| 宣傳影片 | `promo_video` 為空 | 顯示備援：有 `hero_*` 設定就顯示主打圖卡，否則整區隱藏並讓最新消息與認證公告佔滿 |
| 宣傳影片 | `available` 為 `false`，或播放請求失敗 | 顯示封面、文字錯誤與重試，並顯示 `transcript`（見下一列） |
| 宣傳影片 | 載入或播放失敗 | 顯示文字錯誤與重試，並顯示 `transcript`；不退回只有封面 |
| 宣傳影片 | 使用者減少動態 | 不自動播放，顯示封面與播放鈕（決定 D3） |
| 本期專題 | 0 筆 | 整個區段隱藏 |
| 本期專題 | 1 到 2 筆 | 只畫現有張數，版面依張數調整，不放空卡 |
| 本期專題 | 無 `image_url` | 純文字卡，不放破圖 |

## 5. 權限總表

| 動作 | 角色 |
| --- | --- |
| 讀後台設定 | STAFF_ROLES（既有） |
| 改設定：跑馬燈、標語、引言、啟用哪一支影片、既有欄位 | owner、admin（既有 `PUBLISHERS`，**直接生效、不走審核**，沿用現況） |
| 建立與編輯宣傳影片紀錄、上傳影片、字幕、封面、刪除影片 | owner、admin（S3-4）；全部寫稽核；刪除啟用中的影片一律拒絕 |
| 上傳資源限制 | 限流（暫定每人每小時 6 次）、同一時間只允許一個上傳、影片紀錄總數上限 10 筆，避免被盜帳號耗盡單機磁碟 |
| 專題：新增、編輯、送審、撤回 | owner、admin、editor |
| 專題：核准、退件、下架、重新發布、核准修改 | owner、admin |
| 專題：讀取列表 | STAFF_ROLES |
| 公開讀取 | 免登入，依 IP 限流 |

## 6. 快取與失效

- **公開設定端點與專題端點：伺服器端不快取。** 現況就是每次讀資料庫，後台儲存後下一次請求就是新資料，**不需要任何失效機制**。
- **[決定]** 兩個公開端點在 S3-1、S3-3 實作時明確加上 `Cache-Control: no-cache`，避免瀏覽器或中間代理依啟發式規則自行快取。注意 `no-cache` 的意思是「使用前必須重新驗證」；因為沒有 `ETag`，實際效果就是每次都重新取得，這正是我們要的。流量大到需要快取時再另議（可加 `ETag`，失效要在後台儲存的 transaction 結束後觸發）。
- **媒體檔（影片、封面、字幕）：長期快取。** 檔名由系統產生（`uuid4().hex` 加副檔名），替換檔案就是新檔名，所以 nginx 可設 `Cache-Control: public, max-age=31536000, immutable`，不需要失效。舊檔由後端在「被取代或刪除」時清除（S3-4）。
- 影片請求要支援 Range（nginx 靜態檔預設支援）。
- **immutable 標頭只能套在成功回應。** `add_header` 不加 `always`（預設只對 2xx、3xx 生效），**404 絕不能被快取一年**，否則上傳與檔案可見之間的短暫落差會被瀏覽器長期記住。

## 7. 同網域與內容安全政策

- **[決定]** 影片、封面、字幕**只存相對路徑**，這是第一層防禦，不是完整保證（見下面的補強）。驗證規則：不得含 scheme、`//`、`\`、`..`、空位元組；必須符合固定的目錄與檔名格式（第 3.2 節）。公開網址由後端以 `/media/` 加路徑組出。因此即使有人繞過前端直接打 API，也寫不進外部網址。
- **[決定]** 上傳檔案的檔名一律由系統產生，不使用使用者提供的檔名。存放在專用目錄，nginx 以純靜態檔提供，不可執行，並加 `X-Content-Type-Options: nosniff`。
- **[決定]** S3 **不新增** CSP。理由：repo 與範本都沒有 CSP，整站新增 CSP 會影響 Firebase、Cloudinary、Google Fonts 與內嵌腳本，是獨立專案。
- **誠實的說法：** 相對路徑白名單能擋住外部網址注入與目錄穿越，但**不能單獨**防止符號連結、錯誤 MIME、polyglot 檔案或 nginx 設定錯誤；沒有 CSP 也少了瀏覽器端的一層防禦。補強措施全部是 S3-4 的驗收項目：`realpath` 檢查與不跟隨符號連結、系統產生檔名並原子建立、上傳完成前放在不公開的暫存目錄、不收 SVG 與 HTML 等主動內容、nginx 明確指定 `Content-Type` 並加 `X-Content-Type-Options: nosniff`、該目錄不設任何執行或轉發規則。
- **符號連結防護（Codex 審查，S3-4 驗收項目）：** 應用程式的存在檢查已逐層拒絕符號連結（S3-1 已實作），但檢查到送出之間仍有時間差，所以 nginx 的媒體 location 必須加 `disable_symlinks on;`；媒體根目錄與 `homepage/{video,cover,caption}` 子目錄由部署建立，一般帳號不可修改；啟動時確認這幾層都不是符號連結。Windows 開發機不能建符號連結，真實符號連結的測試只能在 Linux CI 或伺服器上跑，目前只用 mock 驗證邏輯。
- 文字欄位（標語、引言、跑馬燈、說明、逐字稿、字幕 cue）前台一律以純文字節點渲染，不使用 `dangerouslySetInnerHTML`。
- 這會**修正計畫 S3-4 的一個項目**：計畫寫「更新內容安全政策 media-src」，改為「現場若已有 CSP，補上 `media-src 'self'` 與 `img-src 'self'`；沒有則不新增」。
- 日後若加 CSP：`media-src 'self'`、`img-src 'self'` 加現有圖片來源，且 S5-3 的防閃白小腳本要改用 nonce 或雜湊。

## 8. 部署順序

每個含 migration 的步驟（S3-1、S3-2、S3-3）都照下列順序，S3-4 另加媒體目錄：

1. **部署前備份**：`deploy.sh` 已自動呼叫 `deploy/backup.sh`（失敗會中止部署）。第一次含 S3-1 的部署前，請確認備份真的能還原一次。
2. **先部署後端，再部署前端。** 後端新欄位全部有預設值，舊前端忽略；前端用預設值合併，所以後端沒帶欄位也不會壞。兩個順序反過來也不會壞，但先後端最保守。
3. **migration 只做加法**，因此切回舊 image 後舊程式仍能在新 schema 運作。這是第 2 節原則 1 的原因。**回滾的真正定義是「舊程式運行在擴充後的 schema」，不是反向 migration**，部署不自動反向 migrate。每個 migration 合併前要檢查：沒有改名、刪除、非空且無預設的新欄位，沒有會長時間鎖表的操作（`HomepageConfig` 只有一列，加欄位不是問題）。新增的 FK 用 `on_delete=SET_NULL`。舊程式遇到 `featured_topic` 的待審修改會略過（已查證，見第 1 節）。
4. **驗證**：部署後打 `GET /adminapi/public/homepage-config/`，確認舊鍵不變、新鍵為預設值。
5. 本機與正式環境都要執行 `cd backend; python manage.py migrate`（正式環境容器啟動時會自動 migrate，但仍請確認）。
6. **S3-4 的額外前置**（動手前先給使用者確認）：
   - Google Cloud 為開機磁碟設定每日快照，保留 7 天。
   - `docker-compose.prod.yml` 新增媒體目錄的持久化掛載。
   - `backup.sh` 或另一個備份流程要涵蓋媒體目錄（現在不含）。**資料庫與媒體分開備份，可能還原出引用不存在檔案的資料**，所以要有書面的還原順序，並實際演練一次；延遲清理 14 天（3.2）是降低這個風險的設計。
   - `nginx.conf` 的 `client_max_body_size` 只對上傳端點放寬到約 160m（150MB 加 multipart 開銷）；nginx 預設會先把整個請求暫存到磁碟再轉給後端（有利於保護 gunicorn worker，但上傳期間會暫用約一倍的磁碟空間），要確認暫存路徑所在磁碟。
   - Django 側：串流寫入暫存檔，不載入記憶體；並確認 gunicorn 的 `--timeout 75` 不會被上傳處理（ffprobe 檢查）拖過。
   - 磁碟目前剩 23GB。
   - **媒體遺失告警：** 公開端點在檔案遺失時只會安靜降級（`available: false`）。S3-4 要加一個檢查（管理命令加健康檢查或排程），確認啟用中的影片、封面、字幕都存在，缺失時記錄高優先級告警，不能只靠使用者發現。

## 8.1 審查後未採納的建議

- **「啟用前必須有字幕，或標記為無聲」：** Codex 建議把字幕變成啟用條件。這與使用者明確決定「不需要字幕」衝突；WCAG 1.2.2 為 A 級的風險已記錄並由使用者承擔，所以字幕維持選填。逐字稿欄位是補償，不是等價替代，這點文件已誠實標明。
- **公開端點改用 `select_related`：** `HomepageConfig.load()` 使用 `get_or_create`，硬加反而每次多一次查詢；現在只有在啟用影片時才多一次查詢，流量下可接受。

## 9. 需要使用者確認的事項

1. **[待確認]** 現場有沒有 CSP（第 1 節的 `curl` 指令）。
2. **[決定，請知悉]** 本期專題的圖片：沿用公告封面的 Cloudinary 通道（現有、5MB 上限、已有前端直傳流程），但後端收緊為只收 `res.cloudinary.com`。若你希望專題圖片也放自己的伺服器，S3-4 的圖片端點可以擴充，但範圍會變大。你沒意見我就照這樣做。
3. **[決定，請知悉]** 跑馬燈、標語、引言、啟用哪支影片，沿用「首頁設定」現況：owner 與 admin 直接生效，不走審核。只有本期專題走審核（D8）。治理上的補償：稽核紀錄要含修改前後值（沿用現有 `before`、`after`）與操作者；把 `active_promo_video` 設為空就是立即停用影片的開關。

## 10. 這份契約改變了計畫的哪些地方

| 計畫原文 | 契約結論 |
| --- | --- |
| S3-4「更新內容安全政策 media-src，只允許自己的網域」 | repo 沒有 CSP，不新增；以伺服器端驗證保證同網域 |
| S3-4「影片限 150MB、8 分鐘」 | 不變 |
| S3-3「公開讀取端點與限流」 | 確定是獨立端點 `/adminapi/public/featured-topics/` |
| S3-3「後台驗證最多 3 張啟用」 | 加上單一服務函式、鎖單例列、排除自己、重新驗證 payload、登記審核佇列 |
| S3-3「圖片」 | 沿用 Cloudinary 通道，後端收緊為 `res.cloudinary.com` 白名單 |
| S3-4 上傳 | 加上延遲清理 14 天、ffprobe 實際檢查、moov 前置檢查、暫存目錄與原子重新命名、資源配額、備份還原演練 |
| S3-1「HomepageConfig 只記錄目前啟用的那一支」 | 不變，且 `PromoVideo` 不設 `is_active` |
