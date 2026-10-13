---
name: 原・語 YUAN・YU
description: 以部落布告欄為比喻的族語學習平台設計系統，現行為 Y2K 硬陰影與五色配色，文化風格待部落與族語老師確認後演進。
colors:
  tayal-red: "#9E1B24"
  tayal-red-dark: "#8A171F"
  amis-blue: "#1F3A5C"
  kavalan-teal: "#2C6E7F"
  paiwan-gold: "#D9A227"
  gold-light: "#F6D77B"
  bunun-green: "#4B6B3A"
  paper-cream: "#F3E7CF"
  paper-cream-dim: "#EFE1C4"
  ink: "#221812"
  text-secondary: "#3E3226"
  text-tertiary: "#5A4B3B"
  text-muted: "#6B5A47"
  surface-white: "#FFFFFF"
  success-bg: "#E4E9E1"
  danger-bg: "#F0DDDE"
  warning-bg: "#F9F1DF"
  warning-text: "#8A6816"
  info-bg: "#DFE9EC"
  disabled-red: "#B79A8A"
typography:
  body:
    fontFamily: "'Noto Sans TC', sans-serif"
  button-label:
    fontFamily: "'Noto Sans TC', sans-serif"
    fontSize: "15px"
    fontWeight: 700
  label-pixel:
    fontFamily: "'Silkscreen', monospace"
    fontSize: "12px"
    letterSpacing: "0.12em"
rounded:
  btn: "6px"
  card: "10px"
  tab: "8px"
spacing:
  hero-top: "64px"
  hero-x: "56px"
  hero-bottom: "50px"
components:
  button-primary:
    backgroundColor: "{colors.tayal-red}"
    textColor: "{colors.paper-cream}"
    rounded: "{rounded.btn}"
    padding: "14px"
  button-primary-hover:
    backgroundColor: "{colors.tayal-red-dark}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-red}"
  button-outline:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.btn}"
    padding: "11px 18px"
  card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  tribe-pill:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.btn}"
    padding: "9px 18px"
  tabswitch-tab-active:
    backgroundColor: "{colors.tayal-red}"
    textColor: "{colors.paper-cream}"
    padding: "11px 28px"
  eyebrow:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paiwan-gold}"
    typography: "{typography.label-pixel}"
    padding: "6px 18px"
---

# Design System: 原・語 YUAN・YU

> 本文件記錄**現況**（來源：`frontend/static/css/default/theme-v2.css`、`frontend/src/constants/tribes.js`、`frontend/components/ui/TribePill.jsx`），並標明哪些是使用者在對話中已決定要改變的方向（決定出自對話，無法由程式碼證實）。尚未在瀏覽器渲染各頁面。
> frontmatter 的 token 有兩種來源：`:root` 內的 `--yy-*` 變數（顏色、圓角 6px／10px、硬陰影），以及直接寫在元件規則裡的數值（白色 `#fff`、`#B79A8A`、頁籤圓角 8px、按鈕字級 15px／粗體、Hero 留白）；後者尚未升為 CSS 變數，列入 B-4。
> 品牌名稱的正式寫法為「原・語」（全形中點）；現有程式與 index.html 多數寫「源·語」（半形中點），僅後台登入頁有一處「源・語」，見 PRODUCT.md「Brand Commitments」。

## Overview

**Creative North Star: "部落布告欄"**

像部落裡公共布告欄上層層貼上的告示：每張紙有明確的邊、有立體的壓痕，各自帶著所屬族群的顏色，但彼此貼在同一面牆上，大家都看得懂。目前以 Y2K 的粗黑框與偏移硬陰影來表現「貼在板子上」的立體感；這是使用者確認要保留的識別。

整體密度偏高、對比強、邊界清楚；立體感靠硬陰影而不是模糊陰影或玻璃質感（現有漸層只用在跑馬燈、鋸齒分隔、Hero 底紋、流光文字、終端機輸入列，且有一個模糊光斑）。五個族語各有識別色，其他顏色的角色固定（紅是主要動作，金是強調與警示，藍與青是資訊）。

使用者已決定：五色棋盤格（跑馬燈色條、鋸齒分隔、Hero 底紋）將由族群文化風格取代，文化風格由部落與族語老師討論確認、並與桃園市政府原住民行政局合作；在確認之前只作為現況記錄，新設計不得擴散棋盤格。

**Key Characteristics:**
- 3px 黑色粗框＋無模糊的偏移硬陰影，是卡片與按鈕的共同語言。
- 米色紙張底（#F3E7CF）、墨色文字（#221812），而不是純白底黑字。
- 五個族語各有一個識別色，用於族語切換與標示。
- 像素字只用在小標籤；內文使用 Noto Sans TC。
- 目前有多個持續循環的裝飾動畫，其去留尚未決定（見 Components 的「動態」）。

## Colors

高對比、飽和度偏高、以紅金藍為主軸的暖色紙張配色。

### Primary
- **赭紅（泰雅識別色）** (#9E1B24)：主要按鈕、啟用中的頁籤與步驟、泰雅語識別色。深色變體 (#8A171F) 用於按鈕 hover。
- **禁用赭紅** (#B79A8A)：主要按鈕被停用時的背景。

### Secondary
- **靛藍（阿美識別色）** (#1F3A5C)：阿美語識別色、藍色分隔條。
- **湖青（噶瑪蘭識別色）** (#2C6E7F)：噶瑪蘭識別色，同時作為資訊色（info）。
- **赤金（排灣識別色）** (#D9A227)：排灣識別色、強調、邊框與脈動光暈。淡金 (#F6D77B) 為輔助。
- **森綠（布農識別色）** (#4B6B3A)：布農識別色，同時作為成功色（success）。

### Neutral
- **米紙** (#F3E7CF)：頁面底色。
- **暗米紙** (#EFE1C4)：骨架載入塊與次要底色。
- **墨色** (#221812)：文字、邊框、硬陰影。
- **次要／第三層／弱化文字** (#3E3226 / #5A4B3B / #6B5A47)：依資訊層級遞減的棕色文字。
- **白** (#FFFFFF)：卡片與輸入框底色。

### 狀態底色
- 成功 (#E4E9E1)、危險 (#F0DDDE)、警告 (#F9F1DF)、資訊 (#DFE9EC)；警告文字用加深金 (#8A6816)，因為赤金本身在米色或白底上做文字時對比不足。

### Named Rules
**The 排灣赤金文字 Rule.** 赤金 (#D9A227) 在米色或白底上做文字對比不足，文字必須改用加深金 (#8A6816)；赤金只作底色與邊框。

**現況觀察（不是規則）：** 族語識別色與狀態色共用同一組色相（布農綠＝成功、噶瑪蘭青＝資訊、泰雅赭紅＝危險與主要動作），同一畫面可能把「這是哪一族」與「對／錯」混在一起；是否分開列為 B-4 的決定，這裡不先下結論。

**The 狀態不靠顏色單獨表達 Rule.** 答對、答錯、已選須同時有文字或圖示（WCAG 2.2 AA 的要求，現況是否全站達成尚未驗證，見改版計畫階段 B-5、B-6）。

## Typography

**Display／Body Font:** Noto Sans TC（fallback：sans-serif）
**Label Font:** Silkscreen（fallback：monospace），只用於小標籤

**Character:** 圓潤中性的黑體承擔所有閱讀；像素字只當章戳般的小標籤，增加 Y2K 感而不干擾閱讀。

### Hierarchy
- **Body／按鈕文字** (700, 13–15px)：全站大量使用粗體；按鈕 15px（主要）、13px（外框）、14px（族語膠囊與頁籤）。
- **Label（像素）** (Silkscreen, 12px, 字距 0.12em)：`.yy-eyebrow` 標籤，墨色底、金色字與金色邊框。
- **步驟徽章數字** (Silkscreen, 15px, 700)：步驟菱形內的數字。

### Named Rules
**The 像素字限小標籤 Rule.** 像素字（Silkscreen）只用在小標籤、徽章數字；不用於需要閱讀的內容，也不用於族語詞彙，以免特殊字母與符號顯示錯誤。（使用者已確認。）

字級的完整階層（標題、大標、內文行高）尚未從各頁面彙整，列為 B-4 的待辦，這裡不編造。

## Layout

頁面最外層為 `.yy-page`：米紙底、`min-height: 100dvh`，用 `overflow-x: clip` 擋住橫向溢出（不用 hidden，避免產生第二條捲軸）。Hero 區 padding 為上 64px、左右 56px、下 50px，文字置中；720px 以下左右縮為 24px，上下不變。主要的版面斷點只在 `theme-v2.css` 中找到一個：`max-width: 720px`；`.yy-footer` 同樣在 720px 以下縮左右留白；各頁面 CSS 另有自己的斷點，尚未彙整成統一斷點表（改版計畫階段 B）。

## Elevation & Depth

沒有模糊陰影。深度全靠**偏移硬陰影**表達（陰影顏色為墨色，無模糊半徑）：

### Shadow Vocabulary
- **小** (`box-shadow: 3px 3px 0 #221812`)：族語膠囊、步驟菱形。
- **中** (`box-shadow: 5px 5px 0 #221812`)：卡片、頁籤開關。
- **大** (`box-shadow: 7px 7px 0 #221812`)：大型卡片。
- **按鈕** (`4px 4px 0 #221812`)：主要按鈕，hover 時位移 (2px,2px) 並縮成 `2px 2px 0`，產生被按下去的感覺。
- **卡片 hover** (`8px 8px 0 #221812`)：位移 (-2px,-2px)，浮起。

### Named Rules
**The 硬陰影不模糊 Rule.** 立體陰影一律是無模糊的偏移色塊；新增模糊 `box-shadow` 或玻璃效果會破壞識別（使用者確認保留硬陰影＋粗黑框）。既有的 `.yy-pulse-glow` 光暈與 `.yy-blob` 模糊光斑屬裝飾動畫，其去留見「動態」。

## Shapes

形狀語言為「貼在板子上的紙片」：圓角偏小到中，邊框以實心粗墨色為主（例外：Eyebrow 標籤與終端機輸入列用 2px 赤金邊框）。

- 按鈕、膠囊、徽章：6px 圓角。
- 卡片：10px。頁籤開關：8px。標籤（eyebrow）：4px。
- 邊框：卡片與主要按鈕 3px，外框按鈕 2.5px，墨色。
- 菱形：步驟與徽章以旋轉 45° 的 6px 圓角方塊構成。

## Components

### Buttons
- **Shape:** 6px 圓角、3px 墨色邊框。
- **Primary:** 赭紅底、米色字、粗體 15px、padding 14px、`4px 4px 0` 硬陰影，並帶持續的金色脈動光暈動畫（2.8 秒循環）。
- **Hover:** 深赭紅，向右下位移 2px、陰影縮小。
- **Disabled:** 淡赭褐底 (#B79A8A)，停用脈動。
- **Outline:** 白底、墨字、2.5px 邊框、13px 粗體；hover 轉米色；停用時透明度 45%。
- **已知問題（尚未修）：** 另有 `_note/buttons.css` 對全站 `button, .btn` 設 `min-width: 100px`（審查項 P1-9），會污染手機版面。

### Chips／Tribe Pill
- **Style:** 白底、3px 墨色邊框、6px 圓角、`3px 3px 0` 陰影；選中時放大到 1.06、白字，背景色由 `TribePill.jsx` 以行內樣式設為該族識別色（CSS 本身沒有 active 背景）。
- 待驗證（B-4）：選中時白字壓在赤金（排灣）底上，推測對比不足，尚未量測。

### Cards／Containers
- **Corner Style:** 10px。
- **Background:** 白。
- **Border:** 3px 墨色。
- **Shadow Strategy:** 中型硬陰影；可選 `.yy-card--hover` 向左上浮起。
- 內距尚未統一，沿用各頁面既有值。

### Inputs／Fields
尚未在共用 token 檔中定義，各頁面各自樣式；焦點樣式是否一致待 B-5 無障礙基線驗證，這裡不編造。

### Navigation／Tabs
- **TabSwitch（登入／註冊、寫筆記／分享區）：** 一組並排按鈕，3px 墨色外框、8px 圓角、中型硬陰影；啟用的頁籤為赭紅底米色字；按鈕之間用 3px 墨色分隔線。
- **StepBar：** 旋轉 45° 的菱形步驟，已完成與啟用為赭紅底；啟用時陰影為赤金；步驟間用虛線連接。

### Signature Components
- **Eyebrow 標籤：** 墨色底、赤金像素字、赤金邊框，4px 圓角。
- **骨架載入塊（`.yy-skeleton`）：** 暗米紙底，透明度脈動，用實際內容尺寸，避免版面跳動。
- **逐字進場（CharReveal）、捲動進場（RevealOnView）：** 見動態。

### 動態（現況與準則）
- **Motion token（theme-v2.css，B-3 新增）：** `--ease-out` cubic-bezier(0.23, 1, 0.32, 1)、`--ease-in-out` cubic-bezier(0.77, 0, 0.175, 1)；時長 `--dur-fast` 150ms、`--dur-base` 220ms、`--dur-flip` 400ms、`--dur-reveal` 550ms；`--transition-interactive` 取代 `transition: all`（只過渡顏色、陰影、位移、透明度）。新增動畫一律引用這些 token。
- **現況：** 捲動進場與 `yy-fade-up` 用 `--dur-reveal` 與 `--ease-out`；翻牌用 `--dur-flip`；逐字進場 0.6 秒帶回彈曲線（尚未改）；主要按鈕脈動 2.8 秒（hover／按下時暫停，避免蓋掉陰影）；流光文字 4 秒；漂浮光斑 10 秒；跑馬燈 6 秒。專案內其餘內建 `ease` 與零散秒數尚未全部換成 token。共用 CSS 有全域 `prefers-reduced-motion` 規則：動畫與過渡縮到近乎 0，無限循環動畫只播一次，但游標與流光字固定可見、捲動進場與彈窗保留 150ms 淡入；JS 驅動的動態在各元件用 hook 判斷，尚未逐一驗證。
- **尚未決定：** 持續循環的裝飾動畫（流光字、脈動按鈕、漂浮光斑、跑馬燈）是否減量，要在改版計畫 B-9 評估後與使用者決定；此處不先下結論。
- **準則（依 Emil Kowalski 的設計工程原則，適用於之後新增的動態）：** 使用頻繁的動作（鍵盤、列表切換）不加動畫；一般 UI 回饋控制在 300ms 以內；進場用 ease-out；避免 `transition: all`；按壓回饋用小幅縮放（0.97）；位移型 hover 動畫放在 `@media (hover: hover) and (pointer: fine)` 內，並搭配 `:active` 按壓回饋（有 `motionTokens.test.js` 檢查）。

## Do's and Don'ts

### Do:
- **Do** 用 3px 墨色邊框加偏移硬陰影表達立體（使用者已確認保留）。
- **Do** 保持五個識別色各自代表一個族語；排灣赤金做文字時改用加深金 (#8A6816)。
- **Do** 像素字只用於小標籤與徽章數字。
- **Do** 每個動畫都尊重 `prefers-reduced-motion`；新的動態先回答「為什麼要動」。
- **Do** 所有新介面文字使用繁體中文與台灣用語，並以 WCAG 2.2 AA 為基準。

### Don't:
- **Don't** 把五色棋盤格擴散到新頁面或新元件；它將由經部落與族語老師確認的族群文化風格取代（使用者已決定）。
- **Don't** 用模糊陰影或玻璃擬態取代硬陰影。
- **Don't** 把文化符號、圖騰或族群圖案當成裝飾加入，除非已經部落、族語老師與行政局確認；草案只放私人預覽並標「未確認」。
- **Don't** 對族語詞彙使用像素字或任何可能無法正確顯示特殊字母的字型。
- **Don't** 只靠顏色表達對錯或狀態。
