/**
 * 族語中文名稱對照表單一資料來源。
 *
 * 原本 bot.jsx、_camera/index.jsx、_favorite/index.jsx、_search/index.jsx、
 * quiz.jsx、quiz_recommon.jsx、quiz_panel_submit.jsx、review_AI.jsx、
 * uploadDb.jsx、_game/{vocabulary,sentence,pronunciation,listening}.jsx、
 * _quiz/tribeSelect.jsx 都各自重複寫了一份幾乎相同的族語名稱對照表，新增族語
 * 要改十幾個地方。這裡集中成唯一資料來源，其餘檔案改成從這裡 import。
 *
 * 對應後端 backend/config/tribes.py 的 TRIBES（同樣的 slug／中文簡稱／中文全名），
 * 兩邊資料要新增或修改族語時得同步改，但至少各自只有一處。
 */

export const TRIBES = [
  { slug: "tayal", name: "泰雅", fullName: "泰雅語", roman: "Tayal", color: "#9E1B24" },
  { slug: "amis", name: "阿美", fullName: "阿美語", roman: "Pangcah", color: "#1F3A5C" },
  { slug: "bunun", name: "布農", fullName: "布農語", roman: "Bunun", color: "#4B6B3A" },
  { slug: "kavalan", name: "噶瑪蘭", fullName: "噶瑪蘭語", roman: "Kebalan", color: "#2C6E7F" },
  { slug: "paiwan", name: "排灣", fullName: "排灣語", roman: "Payuan", color: "#D9A227" },
];

// slug -> 族語識別色（YUAN・YU v2 設計系統，design_handoff_v2/README.md）
export const TRIBE_COLOR_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.color]));

// 中文簡稱清單，例如下拉選單、族語切換按鈕列表
export const TRIBE_NAMES = TRIBES.map((t) => t.name);

// 英文代稱 -> 中文簡稱／全名，例如 { tayal: "泰雅", ... } / { tayal: "泰雅語", ... }
export const TRIBE_NAME_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.name]));
export const TRIBE_FULL_NAME_BY_SLUG = Object.fromEntries(TRIBES.map((t) => [t.slug, t.fullName]));

// 中文簡稱 -> 英文代稱，例如頁面上選的是「泰雅」但 API 要送 "tayal"
export const TRIBE_SLUG_BY_NAME = Object.fromEntries(TRIBES.map((t) => [t.name, t.slug]));
