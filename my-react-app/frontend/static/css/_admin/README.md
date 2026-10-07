# 後台樣式（`static/css/_admin`）

後台是一個獨立的視覺系統：外殼與共用元件在 `layout.css`、`admin-base.css`，其他檔案只放各功能群**獨有**的版面。

## 檔案分工

| 檔案 | 放什麼 |
|---|---|
| `layout.css` | 外殼（側欄、頂欄、內容區）與設計變數（`--admin-*`）。**設計變數一律定義在這裡**：同名頂層類別只能出現在一個 CSS 檔（`cssNamespace.test.js`）。 |
| `admin-base.css` | 通用元件（`admin-*`）、各頁共用的外觀規則、Bootstrap 控制項的後台版本。 |
| 其他 `*.css` | 該功能群獨有的版面：欄寬、特殊格線、獨有元件。不要再寫頁面容器、頁首 h1、卡片外觀、表格基礎。 |

## 新增頁面怎麼寫

用 `admin-*` 通用元件，不要借用別的功能群的 class（例如 `quiz-bank-*`、`dictionary-*`）：

```jsx
<main className="admin-page">
  <div className="admin-page-heading">
    <div><h1>標題</h1><p>說明</p></div>
    {/* 右側操作按鈕 */}
  </div>

  <div className="admin-table-card">
    <Table responsive hover className="admin-table">…</Table>
  </div>
</main>
```

| class | 用途 |
|---|---|
| `admin-page` | 頁面容器（背景、內距、字型） |
| `admin-page-heading` | 頁首（h1 24px、說明 14px），右側可放按鈕 |
| `admin-filter-panel` | 篩選列（自動排欄） |
| `admin-table-card` + `admin-table` | 表格卡片與表格；表格請包在 react-bootstrap 的 `<Table responsive>` |
| `admin-loading` / `admin-empty` / `admin-pagination` | 載入中、空狀態、分頁列 |
| `admin-row-actions` | 列內操作按鈕群（自動換行、有間距） |
| `admin-config-card` / `-section` / `-section-heading` / `-grid` / `-footer` | 單一設定表單（遊戲參數、IRT 參數） |

頁面需要自己的樣式時，在 class 後面**追加**語意 class（如 `admin-page system-page`），再寫 `.admin-shell .system-page …`。

## 規則

- 顏色、圓角、陰影、間距用 `--admin-*` 設計變數，不要寫死色碼。語意色用 `--admin-success*`、`--admin-danger*`、`--admin-warning*`。
  資料編碼用的色階（留存熱圖、題目品質四象限）是例外，檔案開頭有註解說明。
- 標題層級：頁面標題 24px、區塊標題 18px、卡片標題 16px，依語意區塊決定，不看 `h2`／`h3` 標籤。
- 表格卡片用 `overflow: clip`：會裁掉超出卡片的下拉選單與焦點框。列內要放下拉選單時，放進表格自己的捲動容器內。
- 不要用 `backdrop-filter`（在開發用的瀏覽器上會讓畫面卡住），頂欄用純色。
- 彈窗（Bootstrap Modal）掛在 `body` 下，不在 `.admin-shell` 內；要調整彈窗樣式請給 `dialogClassName`。
- 版面寬度以**內容區**為準（1280 視窗扣掉側欄只剩約 972px），不要只看視窗寬度做斷點。

## 守門測試

- `cssNamespace.test.js`：禁止跨檔案同名的頂層類別。
- `adminClasses.test.js`：JSX 用到的每個 `admin-*` class 都必須有 CSS 規則；系統、遊戲、待驗證佇列不得借用 `quiz-bank-*`。

## 動畫與進入後台

動畫是這個後台「第一印象」的一部分，也最容易做成「有做跟沒做看起來差不多」。規則：

- **每個畫面一個主角。** 登入頁是持續動態的織紋；入口載入是被描出來的訊號環；進後台是光圈收合。不要讓所有區塊各自位移幾 px。
- **進入的儀式只在這個分頁第一次進後台時播**（`entry/AdminEntryGate.jsx`，最短可見約 800ms，之後重新整理、換頁都不再播）。日常換頁只做 150ms 淡入，管理員一天換頁上百次。
- 像素元素（織紋格、打字機、進度條）用 `steps()`；大面積位移用平滑曲線。
- 只動 `transform`、`opacity`、`clip-path`；不要用 `backdrop-filter`、`blur()` 的環境動畫。
- 降低動態偏好由 `theme-v2.css` 的全域規則處理；JS 驅動的動態用 `hooks/useReducedMotion`。
- **驗證一定要看到動畫真的在播。** 瀏覽器工具的分頁常是 hidden，動畫時鐘會停住，截圖只會看到起點或終點。用 Edge headless
  （頁面可見）搭配 CDP `Page.captureScreenshot` 在指定時間點擷取，才是真的畫面。

## 進後台要重新輸入密碼

- 前台已登入的人點進 `/admin`，`AdminRoute` 會導去 `/admin-login`，要在那裡再輸入一次密碼
  （旗標在 `session/adminSession.js`，存 sessionStorage：同分頁重新整理保留，新分頁或重開瀏覽器要重登）。
- **旗標只是體驗層，不是安全邊界。** 真正的把關是後端 `core/firebase_auth.py` 的 `require_role`：ID token 的 `auth_time`
  超過 `ADMIN_REAUTH_MAX_AGE_SECONDS`（預設 30 分鐘）就回 401 `reauth_required`，`utils/apiClient.js` 會發出事件，
  `session/AdminReauthModal.jsx` 跳出重新驗證視窗（不導頁，填到一半的表單不會消失）。
- 前台與後台共用同一個 Firebase 登入：在 `/admin-login` 輸入另一個帳號，前台也會切換成該帳號（登入頁有說明）。
