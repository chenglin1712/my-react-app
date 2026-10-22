/**
 * 族群資料的前台入口（N-6）。
 *
 * 資料本身的唯一來源是 backend/config/tribes.json：識別碼、名稱、羅馬字、色彩、語言代碼、
 * 審閱狀態、各功能是否有內容、預留的 16 族與方言別。後端 backend/config/tribes.py 讀同一個檔案，
 * 所以新增或修改族群只改那一處，前後端都會出現。JSON 放在 backend/ 底下是因為 Docker image
 * 只複製 backend/；這裡用相對路徑引入，Vite 建置時會一起打包。
 *
 * 這個檔案只負責把 JSON 轉成原本各處已經在用的介面（TRIBES、TRIBE_NAMES、
 * TRIBE_NAME_BY_SLUG…），其餘檔案的 import 不需要改。
 *
 * 只有 enabled 為 true 的族群會出現在 TRIBES（選單與路由）；其餘是預留位置，見 ALL_TRIBES。
 *
 * 建置契約：前台建置需要完整的 repo（CI 的 actions/checkout 預設就是），不能只複製 frontend/。
 */

import { tribes as tribeEntries } from "../../../backend/config/tribes.json";

/** 把 tribes.json 的內容轉成前台使用的資料。拆成函式是為了讓測試能塞入假資料驗證。 */
export function buildTribeTables(rawTribes) {
  const all = rawTribes.map((t) => ({
    slug: t.slug,
    id: t.id ?? null,
    name: t.name,
    fullName: t.fullName ?? null,
    roman: t.roman ?? null,
    color: t.color ?? null,
    textColor: t.textColor ?? null,
    langCode: t.langCode ?? null,
    enabled: Boolean(t.enabled),
    reviewStatus: t.reviewStatus ?? "unconfirmed",
    features: t.features ?? {},
    dialects: t.dialects ?? [],
  }));

  const enabled = all.filter((t) => t.enabled);
  for (const t of enabled) {
    for (const field of ["fullName", "roman", "color", "textColor"]) {
      if (!t[field]) throw new Error(`tribes.json：啟用的族群 ${t.slug} 缺少 ${field}`);
    }
  }
  return { all, enabled };
}

const { all, enabled } = buildTribeTables(tribeEntries);

/** 官方承認的 16 族（含尚未啟用的預留項目）。選單與路由請用 TRIBES。 */
export const ALL_TRIBES = all;

/** 已啟用的族群：{ slug, name, fullName, roman, color, langCode, features, ... } */
export const TRIBES = enabled;

// slug -> 族語識別色（YUAN・YU v2 設計系統，design_handoff_v2/README.md）
export const TRIBE_COLOR_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.color]));

// slug -> 放在族色上的文字色（淺色族色如排灣金用墨字，其餘用白字；對比至少 4.5:1）
export const TRIBE_TEXT_COLOR_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.textColor]));

// 中文簡稱清單，例如下拉選單、族語切換按鈕列表
export const TRIBE_NAMES = TRIBES.map((t) => t.name);

// 英文代稱 -> 中文簡稱／全名，例如 { tayal: "泰雅", ... } / { tayal: "泰雅語", ... }
export const TRIBE_NAME_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.name]));
export const TRIBE_FULL_NAME_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.fullName]));

// 英文代稱 -> 辭典資料庫的族語 id（後台搜尋詞條的 tribe_id 參數用）
export const TRIBE_ID_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.id]));

// 中文簡稱 -> 英文代稱，例如頁面上選的是「泰雅」但 API 要送 "tayal"
export const TRIBE_SLUG_BY_NAME = Object.fromEntries(TRIBES.map((t) => [t.name, t.slug]));

/**
 * 族語文字的 HTML lang 屬性值（ISO 639-3，例如泰雅 "tay"）。
 * 查不到或尚未核對代碼時回傳 "und"（undetermined），不要亂猜。
 */
export function tribeLangCode(slug) {
  return TRIBES.find((t) => t.slug === slug)?.langCode ?? "und";
}

/**
 * 這個族群的這項功能是否已有內容（feature：dictionary、quiz、vocabulary、listening、
 * pronunciation、sentence）。沒有內容的功能，畫面顯示「即將推出」而不是讓使用者進去看到空白。
 */
export function tribeHasFeature(slug, feature) {
  return TRIBES.find((t) => t.slug === slug)?.features?.[feature] === true;
}

/** 「即將推出」的標籤文字，各畫面共用同一個說法。 */
export const COMING_SOON_LABEL = "即將推出";
