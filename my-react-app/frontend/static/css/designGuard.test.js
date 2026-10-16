// @vitest-environment node
//
// S1-4 沉穩文藝風格守門：把 DESIGN.md 的規則寫成靜態檢查，之後改版或新增樣式不會被改回舊風格。
//   1. 禁止硬偏移陰影（box-shadow、text-shadow、drop-shadow，逐層檢查）與舊陰影 token
//   2. 邊框一律用 --yy-border-width（1.5px），不再寫 2 到 4px 的 border／border-width
//   3. 寫死的色碼只減不增（基線 designGuard.baseline.json）
//   4. 五族色只能當小標記：使用族色的檔案要在白名單，CSS 只能用在細框
//   5. 動態：不用 ease-in、不從 scale(0) 進場
// 後台（_admin、admin 開頭）留到階段 G，不在檢查範圍。
//
// 清掉寫死色碼後會讓「少於基線」的測試失敗，請執行：
//   UPDATE_DESIGN_BASELINE=1 npx vitest run frontend/static/css/designGuard.test.js
// 更新基線檔並一起提交。基線只能變小：既有檔案的色碼變多時更新會被拒絕，應改用 token。
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");
const BASELINE_PATH = join(ROOT, "designGuard.baseline.json");

const walk = (dir, exts) =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });
const rel = (file) => relative(FRONTEND, file).split(/[\\/]/).join("/");
const isAdmin = (r) => /(^|\/)_admin\//i.test(r) || /(^|\/)admin[^/]*$/i.test(r) || /adminLogin/i.test(r) || /\/[Aa]dmin[^/]*\//.test(r);
const isTest = (r) => /\.(test|spec)\.[jt]sx?$/.test(r);
// 移除註解但保留換行，回報的行號才會和原始檔一致；統一換行字元（Windows CRLF）
const blank = (m) => m.replace(/[^\n]/g, " ");
const unify = (text) => text.replace(/\r\n/g, "\n");
const stripCss = (css) => unify(css).replace(/\/\*[\s\S]*?\*\//g, blank);
const stripJs = (js) => unify(js).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:\\])\/\/.*$/gm, (m, p) => p + blank(m.slice(p.length)));

const cssFiles = walk(join(FRONTEND, "static", "css"), [".css"])
  .map((f) => ({ file: rel(f), css: stripCss(readFileSync(f, "utf8")) }))
  .filter(({ file }) => !isAdmin(file));
const jsFiles = [...walk(join(FRONTEND, "src"), [".js", ".jsx"]), ...walk(join(FRONTEND, "components"), [".js", ".jsx"])]
  .map((f) => ({ file: rel(f), js: stripJs(readFileSync(f, "utf8")) }))
  .filter(({ file }) => !isAdmin(file) && !isTest(file));

const lines = (text) => text.split("\n");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// 一個陰影值可能有很多層（逗號分隔，可跨行）。逐層檢查：偏移不是 0 0、模糊為 0、不是 inset = 硬偏移陰影。
// 0 0 0 Npx 的擴散光圈與焦點環不算；var()、calc() 這類函式整段略過（變數本身由 token 定義的檢查負責）。
const splitLayers = (value) => {
  const layers = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      layers.push(cur);
      cur = "";
    } else cur += ch;
  }
  layers.push(cur);
  return layers;
};
const isHardLayer = (layer) => {
  let t = layer.replace(/!important/g, " ");
  for (let i = 0; i < 3; i++) t = t.replace(/[\w-]+\([^()]*\)/g, "F"); // 函式（顏色、var、calc）換成佔位字
  const tokens = t.trim().split(/\s+/);
  if (tokens.includes("inset")) return false;
  const len = tokens.filter((x) => /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)?$/.test(x)).map(parseFloat);
  return len.length >= 3 && (len[0] !== 0 || len[1] !== 0) && len[2] === 0;
};
const hardShadows = (text, isJs) => {
  const out = [];
  const decl = isJs ? /(?:boxShadow|textShadow)\s*:\s*(['"`])([\s\S]*?)\1/g : /(?:^|[;{\s])(?:box-shadow|text-shadow)\s*:\s*([^;{}]+)/g;
  for (const m of text.matchAll(decl)) {
    const value = isJs ? m[2] : m[1];
    if (splitLayers(value).some(isHardLayer)) out.push({ line: lineOf(text, m.index + (m[0].length - value.length)), text: value.trim().replace(/\s+/g, " ").slice(0, 100) });
  }
  for (const m of text.matchAll(/drop-shadow\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    if (isHardLayer(m[1])) out.push({ line: lineOf(text, m.index), text: `drop-shadow(${m[1].trim().slice(0, 80)})` });
  }
  return out;
};
const LEGACY_SHADOW_TOKEN_DEF = /^\s*--yy-shadow-(?:sm|md|lg)\s*:/;

describe("硬偏移陰影", () => {
  it("前台 CSS 沒有硬偏移陰影（舊 token 的定義行除外，階段 G 隨後台一併刪除）", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) => {
      // 舊 token 的定義行本身是硬陰影，先換成空白再掃
      const text = lines(css).map((l) => (LEGACY_SHADOW_TOKEN_DEF.test(l) ? "" : l)).join("\n");
      hardShadows(text, false).forEach((h) => hits.push(`${file}:${h.line}: ${h.text}`));
    });
    expect(hits).toEqual([]);
  });

  it("前台 CSS 不再引用 --yy-shadow-sm／md／lg，浮層用 --yy-shadow-overlay", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (LEGACY_SHADOW_TOKEN_DEF.test(line)) return;
        if (/var\(--yy-shadow-(?:sm|md|lg)\b/.test(line)) hits.push(`${file}:${i + 1}`);
      }),
    );
    expect(hits).toEqual([]);
  });

  it("前台 JS／JSX 的內聯樣式沒有硬偏移陰影", () => {
    const hits = [];
    jsFiles.forEach(({ file, js }) => hardShadows(js, true).forEach((h) => hits.push(`${file}:${h.line}: ${h.text}`)));
    expect(hits).toEqual([]);
  });

  it("陰影判斷本身正確（逐層、單位、!important、擴散光圈與焦點環不誤判）", () => {
    const hard = (v) => hardShadows(`.a{box-shadow:${v};}`, false).length;
    expect(hard("4px 4px 0 #000")).toBe(1);
    expect(hard("0 0 0 3px red, 4px 4px 0 #000")).toBe(1); // 第二層才是硬陰影
    expect(hard("0 4px 0!important")).toBe(1);
    expect(hard("-.25rem .25rem 0 black")).toBe(1);
    expect(hard("0 0 0 12px rgba(1,2,3,.4)")).toBe(0); // 擴散光圈
    expect(hard("inset 0 0 0 1px red")).toBe(0);
    expect(hard("0 10px 30px rgba(41,45,49,.18)")).toBe(0); // 柔和陰影
    expect(hard("var(--x)")).toBe(0);
    expect(hardShadows(".a{filter:drop-shadow(4px 4px 0 rgb(0 0 0))}", false)).toHaveLength(1);
    expect(hardShadows(".a{box-shadow:\n 0 0 0 3px red,\n 4px 4px 0 #000;}", false)[0].line).toBe(2);
    expect(hardShadows('const s = { boxShadow: "3px 3px 0 #221812" }', true)).toHaveLength(1);
  });

  it("全站只有一種柔和陰影 --yy-shadow-overlay，色相取自深石板、不是純黑", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    const m = theme.match(/--yy-shadow-overlay:\s*([^;]+);/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/rgba\(41,\s*45,\s*49,/);
    expect(m[1]).not.toMatch(/rgba?\(0,\s*0,\s*0/);
  });
});

describe("邊框粗細", () => {
  // border 與 border-width 的簡寫（含 solid 3px red 這種順序），值裡有 2 到 4px 的字面長度
  // border-width 只檢查單一值（border-width: 0 3px 3px 0 是用邊框畫的箭頭，不是粗框）
  const THICK_BORDER = /(?<![-\w])border\s*:[^;{}]*(?<![\w.-])(?:2|2\.5|3|4)px\b|(?<![-\w])border-width\s*:\s*(?:2|2\.5|3|4)px\s*(?:;|}|$)/;

  it("前台 CSS 的 border 簡寫不寫 2 到 4px，一律 var(--yy-border-width)（左側強調條等單邊不在此限）", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (THICK_BORDER.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }),
    );
    expect(hits).toEqual([]);
  });

  it("粗框判斷本身正確", () => {
    expect(THICK_BORDER.test("border: 3px solid red;")).toBe(true);
    expect(THICK_BORDER.test("border: solid 3px red;")).toBe(true);
    expect(THICK_BORDER.test("border-width: 2px;")).toBe(true);
    expect(THICK_BORDER.test("border-width: 0 3px 3px 0;")).toBe(false);
    expect(THICK_BORDER.test("border: var(--yy-border-width) solid red;")).toBe(false);
    expect(THICK_BORDER.test("border-left: 6px solid red;")).toBe(false);
    expect(THICK_BORDER.test("border: 1px solid red;")).toBe(false);
  });

  it("--yy-border-width 是 1.5px", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    expect(theme).toMatch(/--yy-border-width:\s*1\.5px;/);
  });
});

describe("動態規則不退回舊寫法", () => {
  // 全站只有三種動態（見 theme-v2.css「動態語法」）。下面這些是已刪除的舊裝飾動畫，不得再出現。
  const REMOVED_MOTION = ["yy-holo", "yy-floaty", "yy-pulse-ring", "yy-marquee", "yy-logo-ring", "yy-char", "yy-pulse-glow"];

  it("已刪除的裝飾動畫（流光、漂浮、脈動光圈、跑馬燈、逐字進場）不再出現在前台 CSS 與 JSX", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) => REMOVED_MOTION.forEach((n) => css.includes(n) && hits.push(`${file}: ${n}`)));
    jsFiles.forEach(({ file, js }) => REMOVED_MOTION.forEach((n) => js.includes(n) && hits.push(`${file}: ${n}`)));
    expect(hits).toEqual([]);
  });

  // 持續循環的動畫只允許「正在進行」的狀態指示：載入佔位、錄音中、等待回覆的跳動點、轉圈、游標閃爍。
  const INFINITE_ALLOWED = ["yy-skeleton-pulse", "yy-blink", "pron-pulse", "sentPulse", "listening-pulse", "pron-community-spin", "bot-bounce", "review-ai-bounce"];

  it("前台 CSS 的無限循環動畫只限狀態指示（白名單）", () => {
    const found = new Set();
    cssFiles.forEach(({ css }) => {
      for (const m of css.matchAll(/animation\s*:([^;]*infinite[^;]*);/g)) found.add(m[1].trim().split(/\s+/)[0]);
    });
    expect([...found].sort()).toEqual([...INFINITE_ALLOWED].sort());
  });

  it("進場動畫只有一組：.yy-fade-up 與 .yy-reveal 都是淡入加上移 8px（yy-enter）", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    expect(theme).toMatch(/@keyframes yy-enter\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(8px\);\s*\}/);
    expect(theme).toMatch(/\.yy-fade-up\s*\{\s*animation:\s*yy-enter var\(--dur-base\) var\(--ease-out\) backwards;/);
    expect(theme).toMatch(/\.yy-reveal:not\(\.is-visible\)\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(8px\);/);
  });

  it("前台 CSS 沒有 ease-in（UI 動畫用 ease-out 系列，ease-in-out 與 ease-out 不受影響）", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (/(?<![\w-])ease-in(?![\w-])/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }),
    );
    expect(hits).toEqual([]);
  });

  // scale(0)、scale(0, 0)、獨立的 scale: 0；進度條之類合理的 scaleX(0) 不在此限
  const SCALE_ZERO = /(?<![\w-])scale\(\s*0(?:\.0+)?\s*(?:,\s*0(?:\.0+)?\s*)?\)|(?<![-\w])scale\s*:\s*0(?:\.0+)?\s*(?:;|}|$)/;

  it("前台 CSS 沒有從 scale(0) 起跳的進場", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (SCALE_ZERO.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }),
    );
    expect(hits).toEqual([]);
  });

  it("scale(0) 判斷本身正確", () => {
    ["transform: scale(0);", "transform: scale( 0 );", "transform: scale(0.0);", "transform: scale(0, 0);", "scale: 0;"].forEach((v) => expect(SCALE_ZERO.test(v), v).toBe(true));
    ["transform: scale(0.95);", "transform: scaleX(0);", "transform: scale(0, 1);", "scale: 0.97;"].forEach((v) => expect(SCALE_ZERO.test(v), v).toBe(false));
  });
});

// ---------- 寫死色碼：只減不增 ----------

const HEX = /#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
const countHex = (text, skipTokenLines) =>
  lines(text).reduce((n, line) => {
    if (skipTokenLines && /^\s*--[\w-]+\s*:/.test(line)) return n; // token 定義本來就是寫色碼的地方
    return n + (line.match(HEX) || []).length;
  }, 0);

const currentHex = () => {
  const out = { css: {}, js: {} };
  cssFiles.forEach(({ file, css }) => {
    const n = countHex(css, true);
    if (n) out.css[file] = n;
  });
  jsFiles.forEach(({ file, js }) => {
    const n = countHex(js, false);
    if (n) out.js[file] = n;
  });
  return out;
};

if (process.env.UPDATE_DESIGN_BASELINE) {
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const cur = currentHex();
  const old = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
  // 基線只能變小。既有檔案變多代表有人新增寫死色碼，拒絕更新（第一次建立基線時沒有舊檔可比）
  const grew = old
    ? ["css", "js"].flatMap((k) => Object.entries(cur[k]).filter(([f, n]) => n > (old[k][f] ?? 0)).map(([f, n]) => `${f}: ${old[k][f] ?? 0} -> ${n}`))
    : [];
  if (grew.length) throw new Error(`拒絕更新基線，下列檔案的寫死色碼變多了，請改用 token：\n${grew.join("\n")}`);
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ note: "寫死色碼基線：只能變小。由 designGuard.test.js 的 UPDATE_DESIGN_BASELINE=1 產生，不要手動加大。", css: sortObj(cur.css), js: sortObj(cur.js) }, null, 2) + "\n",
  );
}

describe("寫死色碼只減不增（顏色一律走 token）", () => {
  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : { css: {}, js: {} };
  const cur = currentHex();

  ["css", "js"].forEach((kind) => {
    it(`${kind === "css" ? "CSS" : "JS／JSX"}：沒有檔案的色碼數量超過基線（新檔案基線為 0）`, () => {
      const over = Object.entries(cur[kind])
        .filter(([file, n]) => n > (baseline[kind][file] ?? 0))
        .map(([file, n]) => `${file}: ${n} > 基線 ${baseline[kind][file] ?? 0}`);
      expect(over, "新增樣式請用 var(--yy-calm-*) 等 token，不要寫死色碼").toEqual([]);
    });

    it(`${kind === "css" ? "CSS" : "JS／JSX"}：改用 token 後要把基線一起調低（避免之後又被悄悄加回來）`, () => {
      const stale = Object.entries(baseline[kind])
        .filter(([file, n]) => (cur[kind][file] ?? 0) < n)
        .map(([file, n]) => `${file}: 基線 ${n}，現在 ${cur[kind][file] ?? 0}`);
      expect(stale, "請執行 UPDATE_DESIGN_BASELINE=1 npx vitest run frontend/static/css/designGuard.test.js").toEqual([]);
    });
  });
});

// ---------- 五族色只能當小標記 ----------

// 使用族群色（TRIBES 的 color／textColor）的前台檔案白名單。每個都已確認是小標記：
// 色票、徽章、膠囊、細框。新增檔案要使用族色，先確認不是大面積背景，再加進來。
// 各頁改版（階段 S8）時，建議把這些出口收斂成單一元件（例如 TribeMark），這份白名單就會縮成一個檔案。
const TRIBE_COLOR_CONSUMERS = [
  "components/ui/TribePill.jsx", // 選取中的小膠囊
  "src/_home/index.jsx", // 22px 色票
  "src/_game/GameTribeSelectPage.jsx", // 小徽章與細框
  "src/_game/index.jsx", // 菱形徽章
];
const TRIBE_COLOR_USE = /\b(?:tribe|t|activeTribeData|tribeData)\??\.(?:color|textColor)\b|--tribe-color/;
// 補抓別名與解構：檔案有引入族群資料，又讀了 color／textColor（const { color } = tribe 之類）
// 兩種明確形態：解構自族群物件（const { color } = tribe），或從 TRIBES 系列資料取值後讀 color
// （TRIBES.find(...)?.color、ALL_TRIBES[0].textColor）。單純 import 了族群名稱表不算，免得把別的 .color 誤判進來。
const DESTRUCTURES_TRIBE = /\{[^{}]*\b(?:color|textColor)\b[^{}]*\}\s*=\s*(?:\w*[Tt]ribe\w*|(?:ALL_)?TRIBES\b)/;
const READS_FROM_TRIBES = /\b(?:ALL_)?TRIBES\b[^;\n]*\.(?:color|textColor)\b/;
const usesTribeColor = (js) => TRIBE_COLOR_USE.test(js) || DESTRUCTURES_TRIBE.test(js) || READS_FROM_TRIBES.test(js);

describe("五族色只能當小標記", () => {
  it("使用族群色的前台檔案都在白名單裡", () => {
    const users = jsFiles.filter(({ js }) => usesTribeColor(js)).map(({ file }) => file).filter((f) => f !== "src/constants/tribes.js");
    const unknown = users.filter((f) => !TRIBE_COLOR_CONSUMERS.includes(f));
    expect(unknown, "新增族色用途請先確認是小標記，再加入 TRIBE_COLOR_CONSUMERS").toEqual([]);
  });

  it("白名單沒有已經不再使用族色的檔案", () => {
    const users = new Set(jsFiles.filter(({ js }) => usesTribeColor(js)).map(({ file }) => file));
    expect(TRIBE_COLOR_CONSUMERS.filter((f) => !users.has(f))).toEqual([]);
  });

  it("族色用途判斷本身正確（別名與解構也抓得到）", () => {
    expect(usesTribeColor("const c = tribe.color;")).toBe(true);
    expect(usesTribeColor("style={{ '--tribe-color': c }}")).toBe(true);
    expect(usesTribeColor("const { color } = tribe;")).toBe(true);
    expect(usesTribeColor("const { color, textColor } = activeTribeData;")).toBe(true);
    expect(usesTribeColor("const m = TRIBES.find((x) => x.slug === s)?.color;")).toBe(true);
    expect(usesTribeColor("const m = ALL_TRIBES[0].textColor;")).toBe(true);
    expect(usesTribeColor("import { TRIBE_NAME_BY_SLUG } from '../constants/tribes';\nconst c = w.color;")).toBe(false);
    expect(usesTribeColor("const a = other.size;")).toBe(false);
  });

  it("CSS 的 --tribe-color 只用在細框，不當背景或文字色", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (!/var\(--tribe-color/.test(line)) return;
        if (!/^\s*border(?:-(?:top|right|bottom|left))?(?:-color)?\s*:/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }),
    );
    expect(hits).toEqual([]);
  });

  it("族色色票的尺寸是小標記（不超過 64px）", () => {
    const sw = cssFiles.map(({ css }) => css.match(/\.home-tribe-swatch\s*\{([^}]*)\}/)).find(Boolean);
    expect(sw).toBeTruthy();
    const w = Number(sw[1].match(/width:\s*(\d+)px/)[1]);
    expect(w).toBeLessThanOrEqual(64);
  });
});
