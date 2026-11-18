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

  it("舊的 --yy-shadow-sm／md／lg／overlay 已刪除：不再定義也不再引用，一律用 --yy-elev-*（Apple 化步驟 1-3）", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (LEGACY_SHADOW_TOKEN_DEF.test(line) || /^\s*--yy-shadow-overlay\s*:/.test(line)) hits.push(`${file}:${i + 1} 仍有定義`);
        if (/var\(--yy-shadow-(?:sm|md|lg|overlay)\b/.test(line)) hits.push(`${file}:${i + 1} 仍有引用`);
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

  it("高度層級 --yy-elev-0 到 4：0、1 無陰影；2 到 4 是兩層柔影、色相取自深石板、不是純黑，且由低到高越來越深", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    const get = (n) => {
      const all = [...theme.matchAll(new RegExp(`^\\s*--yy-elev-${n}:\\s*([^;]+);`, "gm"))];
      expect(all.length, `--yy-elev-${n} 淺色定義`).toBeGreaterThanOrEqual(1);
      return all[0][1].trim();
    };
    expect(get(0)).toBe("none");
    expect(get(1)).toBe("none");
    const alphaSum = [2, 3, 4].map((n) => {
      const v = get(n);
      const layers = v.split(/,(?![^(]*\))/);
      expect(layers.length, `elev-${n} 應為兩層`).toBe(2);
      expect(v).toMatch(/rgba\(41,\s*45,\s*49,/);
      expect(v).not.toMatch(/rgba?\(0,\s*0,\s*0/);
      return [...v.matchAll(/rgba\(41,\s*45,\s*49,\s*([\d.]+)\)/g)].reduce((t, x) => t + Number(x[1]), 0);
    });
    expect(alphaSum[0]).toBeLessThan(alphaSum[1]);
    expect(alphaSum[1]).toBeLessThan(alphaSum[2]);
  });

  it("深色模式：--yy-elev-2 到 4 不畫陰影，1px 內描邊獨立成 --yy-edge-*，跟隨裝置與手動深色一致；淺色的 --yy-edge-* 是空的", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    [2, 3, 4].forEach((n) => {
      const elev = [...theme.matchAll(new RegExp(`^\\s*--yy-elev-${n}:\\s*(0 0 0 0 transparent);`, "gm"))];
      expect(elev.length, `--yy-elev-${n} 深色定義（system 與 dark 各一）`).toBe(2);
      const edge = [...theme.matchAll(new RegExp(`^\\s*--yy-edge-${n}:\\s*(inset 0 0 0 1px rgba\\(242, 238, 227, [\\d.]+\\));`, "gm"))].map((m) => m[1]);
      expect(edge.length, `--yy-edge-${n} 深色定義`).toBe(2);
      expect(edge[0]).toBe(edge[1]);
      expect(theme, `--yy-edge-${n} 淺色為空`).toMatch(new RegExp(`^  --yy-edge-${n}: 0 0 0 0 transparent;`, "m"));
    });
  });

  it("卡片上緣高光 --yy-lit 與環境光 --yy-ambient（P1-1）：淺色是 1px 白色內描邊，深色是空的（避免雙框）；環境光是極淡的銅色徑向光，深色更淡；--yy-lit 只准跟 --yy-elev-* 並列", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    const lit = [...theme.matchAll(/^\s*--yy-lit:\s*([^;]+);/gm)].map((m) => m[1].trim());
    expect(lit.length, "--yy-lit 淺色一組、深色（system 與 dark）兩組").toBe(3);
    expect(lit[0]).toMatch(/^inset 0 1px 0 rgba\(255, 255, 255, 0?\.\d+\)$/);
    expect(lit[1]).toBe("0 0 0 0 transparent");
    expect(lit[2]).toBe("0 0 0 0 transparent");
    const amb = [...theme.matchAll(/^\s*--yy-ambient:\s*radial-gradient\([^;]*?rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/gm)].map((m) => Number(m[4]));
    expect(amb.length, "--yy-ambient 三組").toBe(3);
    expect(amb[0], "淺色環境光要極淡").toBeLessThanOrEqual(0.12);
    expect(amb[1]).toBeLessThan(amb[0]);
    expect(amb[2]).toBe(amb[1]);
    expect(theme, "環境光畫在 .yy-page 背景最上層、底色仍是象牙白 --yy-calm-bg").toMatch(/\.yy-page\s*\{[^}]*background:\s*var\(--yy-ambient\)[^;]*,\s*var\(--yy-calm-bg\);/);
    expect(theme, "不再有獨立的環境光偽元素").not.toMatch(/body::after/);
    const bad = [];
    cssFiles.forEach(({ file, css }) => {
      for (const m of css.matchAll(/box-shadow\s*:\s*([^;{}]*var\(--yy-lit\)[^;{}]*)/g)) {
        if (!/var\(--yy-elev-[2-4]\)\s*,\s*var\(--yy-lit\)/.test(m[1])) bad.push(`${file}: ${m[1].trim().slice(0, 60)}`);
      }
    });
    expect(bad, "--yy-lit 必須緊接在 --yy-elev-2 到 4 後面").toEqual([]);
  });

  it("元件不手寫柔影：前台 CSS 的 box-shadow 每一層只能是 none、--yy-elev-*／--yy-edge-*，或模糊為 0 的細框、焦點圈、內描邊（含多行、inset、多層；登入頁 adminLogin 與後台除外）", () => {
    // 依最外層的逗號或空白切開（括號內不切）
    const splitTop = (v, sep) => {
      const out = [];
      let depth = 0;
      let cur = "";
      for (const ch of v) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        const isSep = depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch));
        if (isSep) {
          if (cur) out.push(cur);
          cur = "";
        } else cur += ch;
      }
      if (cur) out.push(cur);
      return out;
    };
    const LEN = /^(?:-?\d*\.?\d+(?:px|rem|em)?|calc\(.*\))$/;
    const bad = [];
    cssFiles.forEach(({ file, css }) => {
      if (file.endsWith("adminLogin.css")) return;
      for (const m of css.matchAll(/(^|[;{\s])box-shadow\s*:\s*([^;{}]+)/g)) {
        const line = css.slice(0, m.index).split("\n").length;
        splitTop(m[2].replace(/!important/, "").trim(), ",").forEach((layer) => {
          const l = layer.trim();
          if (l === "none" || /^var\(--yy-(?:elev|edge)-[0-4]\)$/.test(l) || l === "var(--yy-lit)" || l === "var(--yy-cover-edge)" || l === "var(--yy-cover-drop)") return; // --yy-lit：卡片上緣高光（P1-1），值由下面的專屬測試檢查；--yy-cover-edge／-drop：抽象封面玻璃的亮邊與投影（P1-5），只定義在 abstractCover.css
          if (/^var\(--yy-keep-shadow(?:,\s*0 0 0 0 transparent)?\)$/.test(l)) return; // 玻璃焦點光暈「疊加」用的承接變數（值本身另由 glass.test.js 檢查）
          const lens = splitTop(l, " ").filter((t) => LEN.test(t));
          if (lens.length >= 3 && /^0(?:px)?$/.test(lens[2])) return; // 模糊為 0：細框、焦點圈、內描邊
          bad.push(`${file}:${line} ${l.slice(0, 70)}`);
        });
      }
    });
    expect(bad).toEqual([]);
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

describe("hover 只給有滑鼠的裝置（階段 6-1）", () => {
  // 含後台在內的所有樣式檔：選擇器裡有 :hover 的規則，一律要在 (hover: hover) and (pointer: fine) 之內，
  // 觸控裝置點一下不會留下黏住的 hover 狀態。巢狀 @media（例如寬度斷點裡再包一層）也算。
  const everyCss = walk(join(FRONTEND, "static", "css"), [".css"]).map((f) => ({ file: rel(f), css: stripCss(readFileSync(f, "utf8")) }));
  const hoverRulesOutsideMedia = (css) => {
    const bad = [];
    const stack = [];
    let buf = "";
    let line = 1;
    for (const ch of css) {
      if (ch === "\n") line++;
      if (ch === "{") { stack.push({ prelude: buf.trim(), line }); buf = ""; }
      else if (ch === "}") {
        const top = stack.pop();
        if (top && !top.prelude.startsWith("@") && top.prelude.includes(":hover")) {
          // 要求 and 串接兩個條件：逗號是「或」、not 是反向，兩者都不算保護
          const ok = stack.some((s) => s.prelude.startsWith("@media") && !/,|\bnot\b|\bor\b/.test(s.prelude) && /\(hover:\s*hover\)/.test(s.prelude) && /\(pointer:\s*fine\)/.test(s.prelude));
          if (!ok) bad.push(`${top.line}: ${top.prelude.replace(/\s+/g, " ").slice(0, 80)}`);
        }
        buf = "";
      } else buf += ch;
    }
    return bad;
  };

  it("沒有任何 :hover 規則在 (hover: hover) and (pointer: fine) 之外", () => {
    const hits = [];
    everyCss.forEach(({ file, css }) => hoverRulesOutsideMedia(css).forEach((h) => hits.push(`${file}:${h}`)));
    expect(hits).toEqual([]);
  });

  it("檢查本身有效：沒包的 :hover 抓得到，包好的放行，巢狀 @media 也放行", () => {
    expect(hoverRulesOutsideMedia(".a:hover { color: red; }")).toHaveLength(1);
    expect(hoverRulesOutsideMedia("@media (hover: hover) and (pointer: fine) { .a:hover { color: red; } }")).toEqual([]);
    expect(hoverRulesOutsideMedia("@media (hover: hover) { .a:hover { color: red; } }")).toHaveLength(1);
    expect(hoverRulesOutsideMedia("@media (hover: hover), (pointer: fine) { .a:hover { color: red; } }")).toHaveLength(1);
    expect(hoverRulesOutsideMedia("@media not (hover: hover) and (pointer: fine) { .a:hover { color: red; } }")).toHaveLength(1);
    expect(hoverRulesOutsideMedia("@media (min-width: 600px) { .a:hover { color: red; } }")).toHaveLength(1);
    expect(hoverRulesOutsideMedia("@media (min-width: 600px) { @media (hover: hover) and (pointer: fine) { .a:hover { color: red; } } }")).toEqual([]);
  });

  it("JSX 沒有用 onMouseEnter／onMouseOver 做只在滑鼠才有意義的樣式切換以外的 hover 邏輯檢查（僅列出，供人工確認）", () => {
    const uses = jsFiles.filter(({ js }) => /onMouse(?:Enter|Over)\s*=/.test(js)).map(({ file }) => file);
    // 目前已知：toast 暫停倒數（後台）。新增使用時請確認有對應的 onFocus／onTouchStart 路徑。
    expect(uses.length).toBeLessThanOrEqual(10);
  });
});

describe("手機版（階段 6-4）", () => {
  const everyCss = walk(join(FRONTEND, "static", "css"), [".css"]).map((f) => ({ file: rel(f), css: stripCss(readFileSync(f, "utf8")) }));
  const ruleList = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

  it("按鈕的最小寬度不超過 64px（筆記頁電腦版的 100px 在手機寬度另有覆蓋）", () => {
    const hits = [];
    everyCss.filter(({ file }) => !isAdmin(file)).forEach(({ file, css }) => {
      ruleList(css).forEach(({ selector, body }) => {
        const m = body.match(/min-width:\s*(\d+)px/);
        if (m && Number(m[1]) > 64 && /button/.test(selector)) hits.push(`${file}: ${selector.replace(/\s+/g, " ").slice(0, 60)} ${m[0]}`);
      });
    });
    // 例外：筆記頁（路由專屬 CSS，限縮在 .note-page 底下）電腦版 100px，手機寬度在同檔另有覆蓋；遊戲開始頁單獨一顆的開始鈕 120px
    expect(hits.filter((h) => !/(_note\/buttons|_game\/game_start)\.css/.test(h)), hits.join(", ")).toEqual([]);
    const note = everyCss.find(({ file }) => file.endsWith("_note/buttons.css")).css;
    expect(note).toMatch(/@media \(max-width: 600px\)\s*\{[^}]*\.note-page \.btn\s*\{\s*min-width:\s*var\(--yy-control-md\)/);
  });

  it("貼著畫面底部的固定元素都把 safe-area-inset-bottom 算進去（瀏海機的手勢條不會蓋住）", () => {
    // 已經由 --yy-tabbar-h、--bot-bottom 變數間接包含安全區的，列在白名單
    const VIA_VARIABLE = [".menu-mobile", ".navbar"];
    const hits = [];
    everyCss.filter(({ file }) => !isAdmin(file)).forEach(({ file, css }) => {
      ruleList(css).forEach(({ selector, body }) => {
        if (!/position:\s*fixed/.test(body)) return;
        const bottom = body.match(/(?:^|[;\s])bottom:\s*([^;]+);/);
        if (!bottom) return;
        const value = bottom[1].trim();
        if (/^0(px)?$/.test(value) === false && !/\d/.test(value)) return;
        if (/var\(--(yy-tabbar-h|bot-bottom)/.test(value) && !/^\d/.test(value)) return;
        if (VIA_VARIABLE.some((s) => selector.endsWith(s))) return;
        if (!/safe-area-inset-bottom/.test(body) && !/safe-area-inset-bottom/.test(value)) hits.push(`${file}: ${selector.replace(/\s+/g, " ").slice(0, 50)} bottom:${value}`);
      });
    });
    expect(hits).toEqual([]);
  });

  it("跑馬燈暫停鈕視覺 32px，但點擊區用透明 ::after 擴成 44px", () => {
    const css = everyCss.find(({ file }) => file.endsWith("_home/masthead.css")).css;
    expect(css).toMatch(/\.home-ticker__toggle::after\s*\{[^}]*width:\s*max\(100%, var\(--yy-control-md\)\)/);
  });
});

describe("字級放大支援（階段 6-5）", () => {
  it("前台 CSS 的 font-size 沒有寫死 px：一律 rem、em、百分比或 token（瀏覽器調大字級時才會跟著放大）", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) => {
      lines(css).forEach((line, i) => {
        if (/font-size:\s*\d+(?:\.\d+)?px/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 60)}`);
      });
    });
    expect(hits).toEqual([]);
  });

  it("字級 token 是 rem，且 1rem = 16px 的對照沒變（根字級沒有被覆寫）", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    const expected = { xs: 0.75, sm: 0.875, base: 1, lg: 1.125, xl: 1.375, "2xl": 1.75, "3xl": 2.5 };
    Object.entries(expected).forEach(([name, rem]) => {
      expect(theme, name).toContain(`--yy-text-${name}: ${rem}rem;`);
    });
    cssFiles.forEach(({ file, css }) => {
      expect(/(^|\n)\s*(html|:root)\s*\{[^}]*font-size\s*:\s*\d+(?:\.\d+)?(px|%)/.test(css), `${file} 不要覆寫根字級`).toBe(false);
    });
  });
});

describe("換頁轉場（階段 6-2）", () => {
  const theme = () => cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
  const block = () => {
    const start = theme().indexOf("@media (prefers-reduced-motion: no-preference) {\n  ::view-transition-old(root)");
    expect(start, "找不到換頁轉場區塊").toBeGreaterThan(-1);
    return theme().slice(start, theme().indexOf("\n}\n", start));
  };

  it("舊畫面淡出、新畫面淡入，只用既有的淡入淡出關鍵影格與動態 token，曲線 ease-out", () => {
    expect(block()).toMatch(/::view-transition-old\(root\)\s*\{[^}]*animation:\s*yy-overlay-out var\(--dur-overlay-out\) var\(--ease-out\) both/);
    expect(block()).toMatch(/::view-transition-new\(root\)\s*\{[^}]*animation:\s*yy-overlay-in var\(--dur-base\) var\(--ease-out\) both/);
    expect(block()).not.toMatch(/ease-in(?!-out)|transform|translate|scale/);
  });

  it("只在沒有要求減少動態時才有轉場動畫（不支援的瀏覽器不會用到這些選擇器）", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) => {
      const i = css.indexOf("::view-transition");
      if (i > -1) hits.push(file);
    });
    expect(hits).toEqual([expect.stringMatching(/default\/theme-v2\.css$/)]);
    const outside = theme().replace(block(), "");
    expect(outside).not.toContain("::view-transition");
  });

  it("前台換頁副作用與路由都吃「畫面上顯示的位置」，不是直接用真實網址", () => {
    const read = (f) => readFileSync(join(FRONTEND, "src", f), "utf8");
    expect(read("RouteEffects.jsx")).toContain("useDisplayedLocation()");
    expect(read("route.jsx")).toMatch(/<Routes location=\{displayedLocation\}>/);
    expect(read("AppShell.jsx")).toContain("<RouteTransitionProvider>");
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

  // 持續循環的動畫只允許「正在進行」的狀態指示：載入佔位、錄音中、等待回覆的跳動點、轉圈、游標閃爍、發音播放中的波形
  // （yy-audio-wave：只在播放中那一顆存在，播完即消失，減少動態時凍結成靜態波形）。
  // home-ticker-scroll 是例外：首頁跑馬燈是契約要求的內容（HOMEPAGE_CONTRACT.md 4.3），
  // 有可見的暫停鈕、滑過與聚焦暫停、減少動態時改靜態（見 Ticker.jsx 與 mastheadLook.test.js）。
  const INFINITE_ALLOWED = ["home-ticker-scroll", "yy-skeleton-pulse", "yy-blink", "pron-pulse", "sentPulse", "listening-pulse", "pron-community-spin", "quiz-load-spin", "bot-bounce", "review-ai-bounce", "yy-audio-wave"];

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

  // 去掉 @media (prefers-reduced-motion: reduce) { ... } 區塊（括號配對），剩下的是「一般模式」的規則
  const stripReduced = (css) => {
    let out = "";
    let i = 0;
    const marker = /@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{/g;
    for (let m = marker.exec(css); m; m = marker.exec(css)) {
      out += css.slice(i, m.index);
      let depth = 1;
      let j = marker.lastIndex;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      i = j;
      marker.lastIndex = j;
    }
    return out + css.slice(i);
  };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it("按壓回饋（步驟 1-7）：導覽項、功能卡、專題卡、消息與公告列表列在一般模式按下都縮放（--yy-ui-press 或 0.99 級的列表列），只動 transform", () => {
    const PRESS = /^transform:\s*scale\((?:var\(--yy-ui-press\)|0\.99\d*)\);?$/;
    const REQUIRED = [".menu-item", ".home-func-card", "a.ann-item", ".topic-card", "a.news-text-item"];
    const missing = [];
    REQUIRED.forEach((sel) => {
      const re = new RegExp(`(?:^|[\\s,}])${escRe(sel)}:active(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}`, "gm");
      let ok = false;
      cssFiles.forEach(({ css }) => {
        const normal = stripReduced(css);
        for (const m of normal.matchAll(re)) {
          const body = m[1].trim();
          if (PRESS.test(body)) ok = true;
          else missing.push(`${sel}:active 一般模式的內容不是縮放：${body.slice(0, 50)}`);
        }
      });
      if (!ok) missing.push(`${sel} 在一般模式缺少 :active 縮放`);
    });
    expect(missing).toEqual([]);
  });

  it("動態語言 token（步驟 1-7）：彈簧用 linear()、數值與文件一致、按壓有 reduced-motion 停用版、沒有 transition: all（含多行）", () => {
    const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;
    expect(theme).toMatch(/--ease-spring:\s*linear\([^;]+\);/);
    expect(theme).toMatch(/--dur-spring:\s*550ms;/);
    expect(theme).toMatch(/--dur-press:\s*120ms;/);
    expect(theme).toMatch(/--yy-lift:\s*-3px;/);
    expect(theme).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.yy-press[^{]*\{[^}]*transition:/);
    expect(theme).toMatch(/\.yy-press:active[^{]*\{\s*transform:\s*scale\(var\(--yy-ui-press\)\);/);
    expect(theme).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.yy-press[^{]*\{\s*transition:\s*none;/);
    expect(theme).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.yy-press:active[^{]*\{\s*transform:\s*none;/);
    const all = [];
    cssFiles.forEach(({ file, css }) => {
      for (const m of css.matchAll(/transition(?:-property)?\s*:\s*all\b/g)) all.push(`${file}:${css.slice(0, m.index).split("\n").length}`);
    });
    expect(all).toEqual([]);
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
// 遊戲專區（入口與選族語頁）已於 Apple 化步驟 4-5 移除族色，統一單一強調色，所以不在名單內
const TRIBE_COLOR_CONSUMERS = [
  "components/ui/TribePill.jsx", // 選取中的小膠囊
  "components/ui/TribeSegmented.jsx", // 族語分段控制：只用在字前面 8px 的小圓點（P3-2）
  "src/_camera/result.jsx", // 把族色交給 TribeSegmented 當小圓點（P3）
  "src/_translate/index.jsx", // 把族色交給 TribeSegmented 當小圓點（P3-1）
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

  it("CSS 的 --tribe-color 只用在細框，或 .yy-pill__dot 8px 小圓點的降飽和底色（color-mix 混入表面色），不當大面積背景或文字色", () => {
    const hits = [];
    cssFiles.forEach(({ file, css }) =>
      lines(css).forEach((line, i) => {
        if (!/var\(--tribe-color/.test(line)) return;
        if (/^\s*background:\s*(?:var\(--tribe-color\);|color-mix\(in srgb, var\(--tribe-color\) \d+%, var\(--yy-calm-(?:surface|accent-on)\)\);)/.test(line)) return; // P1-2：小圓點
        if (!/^\s*border(?:-(?:top|right|bottom|left))?(?:-color)?\s*:/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }),
    );
    expect(hits).toEqual([]);
  });
});

// P1-3 / P1-6 / P1-8：新增動態的守門（DESIGN.md「動態語法」與「骨架、空狀態、提示與快捷鍵」）
describe("P1 新增動態規則", () => {
  const read = (...p) => unify(readFileSync(join(FRONTEND, ...p), "utf8"));

  it("抽屜曲線 --ease-drawer 在 :root 定義，手機底部抽屜進場用它、退場用 --ease-out（不過衝，底緣不露縫）", () => {
    expect(read("static", "css", "default", "theme-v2.css")).toMatch(/--ease-drawer:\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/);
    const sheet = read("static", "css", "_search", "wordSheet.css");
    expect(sheet).toMatch(/\.word-sheet--bottom\.offcanvas\s*\{\s*transition-timing-function:\s*var\(--ease-drawer\);/);
    expect(sheet).toMatch(/\.word-sheet--bottom\.offcanvas\.hiding\s*\{\s*transition-timing-function:\s*var\(--ease-out\);/);
  });

  it("詳情面板：鍵盤開啟（click 的 detail 為 0）不加動畫", () => {
    expect(read("src", "_search", "index.jsx")).toMatch(/setSheetAnimated\(event\?\.detail !== 0\)/);
    expect(read("src", "_search", "components", "WordDetailSheet.jsx")).toMatch(/animation=\{animated\}/);
  });

  it("共享元素轉場：只在滑鼠觸發、瀏覽器支援、非減少動態時啟動，其餘直接更新", () => {
    const js = read("utils", "viewTransition.js");
    expect(js).toMatch(/trigger !== 'pointer'/);
    expect(js).toMatch(/supportsViewTransition\(\)/);
    expect(js).toMatch(/reduced\(\)/);
  });

  it("toast 與快捷鍵說明視窗：減少動態時 CSS 取消動畫，且 toast 從 scale(.94) 起、不從 0 起", () => {
    const toast = read("static", "css", "ui", "toast.css");
    expect(toast).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.yy-toast,\s*\.yy-toast\.is-leaving\s*\{\s*animation:\s*none;/);
    expect(read("static", "css", "default", "theme-v2.css")).toMatch(/@keyframes yy-pop\s*\{\s*from\s*\{\s*transform:\s*scale\(0\.94\)/);
    // 說明視窗是鍵盤與按鈕直接觸發的，不加任何進出動畫
    expect(read("static", "css", "ui", "shortcutHelp.css")).not.toMatch(/animation|@keyframes/);
  });
});

// P2：單詞詳情浮出與查詢頁的守門（DESIGN.md「單詞詳情浮出與查詢頁」）
describe("P2 查詢頁規則", () => {
  const read = (...p) => unify(readFileSync(join(FRONTEND, ...p), "utf8"));

  it("背板 scrim 與模糊是 token，詳情背板直接覆寫 Bootstrap 的 background-color 與 .show 不透明度", () => {
    const theme = read("static", "css", "default", "theme-v2.css");
    expect(theme).toMatch(/--yy-scrim:/);
    expect(theme).toMatch(/--yy-scrim-blur:/);
    expect(theme).toMatch(/--yy-scrim-solid:/);
    const sheet = read("static", "css", "_search", "wordSheet.css");
    expect(sheet).toMatch(/\.word-sheet-backdrop[^{]*\{[^}]*background-color:\s*var\(--yy-scrim\)/);
    expect(sheet).toMatch(/prefers-reduced-transparency/);
  });

  it("詳情：桌面是置中卡片（Modal），進場用彈簧加淡入、從 scale(0.9) 起、不從 0 起；減少動態時不位移", () => {
    const sheet = read("static", "css", "_search", "wordSheet.css");
    expect(sheet).toMatch(/\.word-sheet--center\.modal\.fade \.modal-dialog\s*\{[^}]*transform:\s*translateY\(24px\) scale\(0\.9\)/);
    expect(sheet).toMatch(/\.word-sheet--center\.modal\.show \.modal-dialog\s*\{[^}]*var\(--ease-spring\)/);
    expect(sheet.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/scale\(0\)/);
    expect(sheet).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.word-sheet--center\.modal\.fade,/);
    expect(read("src", "_search", "components", "WordDetailSheet.jsx")).toMatch(/word-sheet word-sheet--center/);
  });

  it("結果清單兩欄只在 1100px 以上；詞卡上浮 3px 只在滑鼠（hover + fine pointer）", () => {
    const css = read("static", "css", "_search", "index.css");
    expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{\s*\.search-page \.list-group\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[^@]*translateY\(-3px\)/);
  });

  it("收藏愛心只動 transform 且一次性；減少動態時沒有彈跳", () => {
    const css = read("static", "css", "ui", "favoriteButton.css");
    expect(css).toMatch(/@keyframes yy-heart-pop[^}]*transform/);
    expect(css).not.toMatch(/animation:[^;]*infinite/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.yy-fav-heart\.is-pop\s*\{\s*animation:\s*none/);
  });

  it("詳情快捷鍵都登記在 shortcuts.js，近似詞畫面不宣稱語意相近", () => {
    const sc = read("hooks", "shortcuts.js");
    ["← →", "空白鍵", "Esc"].forEach((k) => expect(sc).toContain(`key: '${k}'`));
    expect(read("src", "_search", "index.jsx")).toMatch(/只是拼寫開頭相近，意思不一定相同/);
  });
});

// P3：翻譯與影像辨識的守門（DESIGN.md「翻譯與影像辨識」）
describe("P3 翻譯與影像辨識規則", () => {
  const readCss = (rel) => stripCss(readFileSync(join(FRONTEND, "static/css", rel), "utf8"));
  const readSrc = (rel) => readFileSync(join(FRONTEND, rel), "utf8");

  it("分段控制：指示塊只用 transform 位移，過衝被裁切層擋住，減少動態不過場", () => {
    const css = readCss("ui/tribeSegmented.css");
    expect(css).toMatch(/\.yy-seg__thumb\s*\{[^}]*transform:\s*translateX\(/);
    expect(css).not.toMatch(/\.yy-seg__thumb\s*\{[^}]*transition:[^;]*\b(width|left)\b/);
    expect(css).toMatch(/\.yy-seg__clip\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.yy-seg__thumb\s*\{\s*transition:\s*none/);
  });

  it("辨識光帶：只掃一次、不無限循環、減少動態時不顯示；標籤依序浮現的總延遲有上限", () => {
    const css = readCss("_camera/stage.css");
    expect(css).toMatch(/camera-scan-once[^;]*\b1 forwards/);
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.camera-scan\s*\{\s*display:\s*none/);
    expect(css).toMatch(/min\(var\(--i, 0\), 8\)/);
  });

  it("舞台只用 transform／opacity 做動態，不動 top／left／width／height", () => {
    const css = readCss("_camera/stage.css");
    for (const m of css.matchAll(/@keyframes[^{]+\{([\s\S]*?\n\})/g)) {
      expect(m[1]).not.toMatch(/\b(top|left|right|bottom|width|height|margin|padding)\s*:/);
    }
  });

  it("影像辨識不假裝有定位：舞台元件不用座標、不畫框", () => {
    const stage = readSrc("src/_camera/components/CameraStage.jsx");
    expect(stage).not.toMatch(/boundingPoly|bbox|boundingBox|vertices/i);
    expect(readCss("_camera/stage.css")).not.toMatch(/camera-box|bounding/);
  });

  it("隱私說明全文保留 Google Cloud Vision，提交鈕旁永遠有簡短揭露", () => {
    expect(readSrc("src/_camera/components/CameraPrivacyNote.jsx")).toMatch(/Google Cloud Vision/);
    expect(readSrc("src/_camera/index.jsx")).toMatch(/圖片會送到第三方（Google）辨識/);
  });

  it("翻譯輸入：維持 300 字上限、組字中不送出", () => {
    const src = readSrc("src/_translate/index.jsx");
    expect(src).toMatch(/const MAX_LEN = 300/);
    expect(src).toMatch(/composingRef\.current/);
    expect(src).toMatch(/keyCode === 229/);
  });
});

// P4-7：等級徽章是同一個銅褐色階（深淺代表等級），不再每級一個顏色；「推薦」是文字小標籤不是貼紙圖片
describe("P4-7 等級卡", () => {
  const css = stripCss(readFileSync(join(FRONTEND, "static/css/_quiz/quiz_panel_start.css"), "utf8"));
  it("四級徽章都由 --yy-calm-accent 調出來，沒有 success／olive／copper 之類的另一組顏色", () => {
    for (const n of [1, 2, 3, 4]) {
      const body = css.match(new RegExp(String.raw`\.level-${n} \.level-icon-text\s*\{([^}]*)\}`))?.[1] || "";
      expect(body, `level-${n}`).toMatch(/--yy-calm-accent/);
      expect(body).not.toMatch(/success|olive|copper/);
    }
  });
  it("「推薦」是膠囊小標籤，沒有貼紙圖片", () => {
    expect(css).toMatch(/\.level-recommend-tag\s*\{[^}]*border-radius:\s*var\(--yy-radius-pill\)/);
    expect(css).not.toMatch(/level-recommend-img/);
  });
});

// P4-8：AI 助手入口是玻璃膠囊，浮層開啟時自動隱藏
describe("P4-8 AI 助手入口", () => {
  const css = stripCss(readFileSync(join(FRONTEND, "static/css/_quiz/bot_launcher.css"), "utf8"));
  it("膠囊：pill 圓角、最小 44px 高、文字用主文字色（對比由 glass.test.js 把關）", () => {
    const body = css.match(/\.bot-launcher\s*\{([^}]*)\}/)?.[1] || "";
    expect(body).toMatch(/border-radius:\s*var\(--yy-radius-pill\)/);
    expect(body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(body).toMatch(/color:\s*var\(--yy-calm-text\)/);
  });
  it("modal、offcanvas、遮罩開著時隱藏（visibility 一起收，鍵盤也到不了）", () => {
    const m = css.match(/body:has\(([^)]*)\)\s*\.bot-launcher\s*\{([^}]*)\}/);
    expect(m?.[1]).toMatch(/\.modal\.show/);
    expect(m?.[1]).toMatch(/\.offcanvas\.show/);
    expect(m?.[1]).toMatch(/\.modal-backdrop\.show/);
    expect(m?.[2]).toMatch(/visibility 0s linear var\(--dur-fast\)/); // 先淡出再隱藏
    expect(m?.[2]).toMatch(/visibility:\s*hidden/);
    expect(m?.[2]).toMatch(/pointer-events:\s*none/);
  });
  it("減少動態：沒有過場與按下縮放", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.bot-launcher\s*\{\s*transition:\s*none/);
  });
});

// P4-3：答對與答錯回饋
describe("P4-3 答對答錯回饋", () => {
  const css = stripCss(readFileSync(join(FRONTEND, "static/css/_game/gameFeedback.css"), "utf8"));
  // 取出 @keyframes name { ... } 的整段內容（用括號計數，巢狀的 0%／100% 也算在內）
  const keyframes = (name) => {
    const start = css.indexOf(`@keyframes ${name}`);
    if (start < 0) return "";
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
    return "";
  };
  it("三組動畫（彈、勾彈、搖）都只動 transform，而且都不循環", () => {
    for (const name of ["game-pop", "game-check-pop", "game-shake"]) {
      const body = keyframes(name);
      expect(body, name).not.toBe("");
      for (const m of body.matchAll(/([a-z-]+)\s*:/g)) expect(m[1], name).toBe("transform");
    }
    expect(css).not.toMatch(/infinite/);
  });
  it("答錯輕搖左右各 6px、240ms；動畫只在 prefers-reduced-motion: no-preference 底下套用", () => {
    const shake = keyframes("game-shake");
    expect(shake).toMatch(/translateX\(-6px\)/);
    expect(shake).toMatch(/translateX\(6px\)/);
    expect(css).toMatch(/animation:\s*game-shake 240ms/);
    const idx = css.indexOf("prefers-reduced-motion: no-preference");
    expect(idx).toBeGreaterThan(-1);
    expect(css.indexOf("animation: game-shake")).toBeGreaterThan(idx);
    expect(css.indexOf("animation: game-pop")).toBeGreaterThan(idx);
  });
  it("對錯的 ✓／✗ 圖示與回饋文字一直在 JSX 裡（減少動態時靠它們，不靠動畫）", () => {
    for (const f of ["components/_game/listening_game.jsx", "components/_game/sentence_game.jsx"]) {
      const src = readFileSync(join(FRONTEND, f), "utf8");
      expect(src, f).toMatch(/game-mark[^>]*>✓/);
      expect(src, f).toMatch(/game-mark[^>]*>✗/);
    }
    expect(readFileSync(join(FRONTEND, "components/_game/listening_game.jsx"), "utf8")).toMatch(/答錯了，正確答案/);
  });
});

describe("P4 遊戲專區與測驗（其餘項目）", () => {
  const read = (f) => stripCss(readFileSync(join(FRONTEND, f), "utf8"));
  it("P4-1 卡片微傾斜：只在有滑鼠、沒開減少動態時；角度上限在 hook 裡（3 度）", () => {
    const css = read("static/css/_game/index.css");
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\)\s*\{\s*\.gamehub-card\s*\{\s*transform: perspective\(900px\) rotateX\(var\(--tilt-x, 0deg\)\) rotateY\(var\(--tilt-y, 0deg\)\)/);
    expect(readFileSync(join(FRONTEND, "src/_game/useCardTilt.js"), "utf8")).toMatch(/maxDeg = 3/);
  });
  it("P4-5 測驗導覽：選取是銅褐底、沒有紅色三角（func-hint）、沒有舊的手機浮動選單", () => {
    const css = read("static/css/_quiz/sideBar.css");
    expect(css).toMatch(/\.bar-item\.active\s*\{[^}]*background: var\(--yy-calm-accent\)/);
    expect(css).not.toMatch(/func-hint|mobile-menu|mobile-bar-menu/);
  });
  it("P4-9 診斷條形圖：長條用資料色 1、底色用細線色、數字在格子裡（樣式不靠陰影）", () => {
    const css = read("static/css/_quiz/quiz_recommon_result.css");
    expect(css).toMatch(/\.rule-bar-fill\s*\{[^}]*background: var\(--yy-data-1\)/);
    expect(css).toMatch(/\.rule-bar-track\s*\{[^}]*background: var\(--yy-calm-rule\)/);
  });
});

describe("P4-10 補充（實測後的修正）", () => {
  const readCss = (f) => stripCss(readFileSync(join(FRONTEND, f), "utf8"));
  it("前台 CSS 裡沒有上標數字亂碼（反斜線被吃掉的 \2713 會變成「¹3」）", () => {
    const bad = cssFiles.filter(({ css }) => /[\u00B9\u00B2\u00B3]/.test(css)).map(({ file }) => file);
    expect(bad).toEqual([]);
  });
  it("進階測驗對錯：用淺底加同色字與框，不用實心綠／實心紅；進度條是強調色", () => {
    const css = readCss("static/css/_quiz/quiz_recommon_question.css");
    expect(css).toMatch(/\.custom-btn\.correct\s*\{[^}]*background: var\(--yy-calm-success-bg\)/);
    expect(css).toMatch(/\.custom-btn\.wrong\s*\{[^}]*background: var\(--yy-calm-danger-bg\)/);
    expect(css).toMatch(/\.recommon-progress-fill\s*\{[^}]*background: var\(--yy-calm-accent\)/);
  });
  it("句型卡與發音卡是中性底，不是粉紅（粉紅只留給答錯）", () => {
    expect(readCss("static/css/_game/sentence.css")).toMatch(/\.sent-card\s*\{[^}]*background: var\(--yy-calm-info-bg\)/);
    expect(readCss("static/css/_game/pronunciation.css")).toMatch(/\.pron-card\s*\{[^}]*background: var\(--yy-calm-info-bg\)/);
  });
  it("測驗載入指示是 CSS 轉圈（銅褐、減少動態靜止），不再用紅色 Lottie", () => {
    const css = readCss("static/css/_quiz/quiz_panel.css");
    expect(css).toMatch(/\.load-spinner\s*\{[^}]*border-top-color: var\(--yy-calm-accent\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.load-spinner\s*\{\s*animation: none/);
    expect(readFileSync(join(FRONTEND, "components/_quiz/quiz_panel.jsx"), "utf8")).not.toMatch(/loadLoadingAnimation|useLottieAnimation/);
  });
});
