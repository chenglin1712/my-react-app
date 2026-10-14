// @vitest-environment node
//
// E-10 舊世代視覺收斂：把「內頁看起來和首頁屬於同一個產品」變成可驗證的規則。
// 舊字型（Comic Sans、Segoe UI）、Bootstrap 預設狀態色、灰字、寫死的圓角與邊框粗細、
// 遊戲專區的寫死色碼、emoji 當圖示，一律不准再回來。後台（_admin、檔名含 admin）留到階段 G。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");

const walk = (dir, exts) =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
const isAdmin = (file) => /(^|\/)_admin\//i.test(file) || /(^|\/)admin[^/]*$/i.test(file);
const isTest = (file) => /\.(test|spec)\.[jt]sx?$/.test(file);
const rel = (file) => relative(FRONTEND, file).split(/[\\/]/).join("/");
const read = (file) => readFileSync(file, "utf8");

const css = walk(join(FRONTEND, "static", "css"), [".css"])
  .map((f) => ({ file: rel(f), text: strip(read(f)) }))
  .filter(({ file }) => !isAdmin(file));
const jsx = walk(FRONTEND, [".jsx"])
  .map((f) => ({ file: rel(f), text: read(f) }))
  .filter(({ file }) => !isTest(file) && !isAdmin(file));

// 逐行掃描，回報「檔案:行號」
const scanLines = (files, test) => {
  const hits = [];
  files.forEach(({ file, text }) => {
    text.split("\n").forEach((line, i) => {
      if (test(line, file)) hits.push(`${file}:${i + 1}`);
    });
  });
  return hits;
};
const isTokenDefinition = (line) => /^\s*--[\w-]+\s*:/.test(line);
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe("字型", () => {
  it("前台 CSS 不再使用 Comic Sans、Segoe UI、DFKai-SB、Microsoft JhengHei，內文字型一律取 --yy-font-body", () => {
    const hits = scanLines(css, (line) => /font-family:[^;]*(Comic Sans|Segoe UI|DFKai|JhengHei|Arial|Helvetica)/i.test(line));
    expect(hits).toEqual([]);
  });

  it("前台 CSS 不再單獨寫 \"Noto Sans TC\", sans-serif（theme-v2 的 token 定義除外）", () => {
    const hits = scanLines(css, (line, file) => !file.endsWith("default/theme-v2.css") && /font-family:\s*['"]Noto Sans TC['"]/.test(line));
    expect(hits).toEqual([]);
  });
});

describe("色碼", () => {
  it("Bootstrap／Tailwind 預設狀態色與灰階（#27ae60、#e74c3c、#888、#ccc…）不再出現在前台 CSS", () => {
    const BAD = /#(27ae60|e74c3c|2ecc71|3498db|f39c12|e53e3e|8b0000|0d6efd|dc3545|198754|ffc107|c0392b|28a745|888|999|aaa|bbb|ccc|ddd|eee|777|666|555|444|333)\b/i;
    const hits = scanLines(css, (line) => !isTokenDefinition(line) && BAD.test(line));
    expect(hits).toEqual([]);
  });

  it("遊戲專區（_game）CSS 完全不含寫死色碼，全部取用 --yy-* token", () => {
    const game = css.filter(({ file }) => file.includes("static/css/_game/"));
    expect(game.length).toBeGreaterThan(5);
    const hits = scanLines(game, (line) => !isTokenDefinition(line) && (line.match(HEX) || []).length > 0);
    expect(hits).toEqual([]);
  });

  it("其餘前台 CSS 的寫死色碼只剩刻意的分類色盤，數量不得增加", () => {
    // 新聞標籤的五種分類色、批改螢光筆的類別色、終端機漸層與停用鈕、詞素分類的紫色。
    // 要新增顏色請先加進 theme-v2.css 的 token，不要直接寫色碼。
    const ALLOWED = {
      "static/css/_home/news.css": 6,
      "static/css/default/theme-v2.css": 6,
      "static/css/_quiz/review_AI.css": 6,
      "static/css/_search/index.css": 2,
      "static/css/_morphology/index.css": 1,
    };
    const actual = {};
    css.forEach(({ file, text }) => {
      const n = text.split("\n").reduce((sum, line) => sum + (isTokenDefinition(line) ? 0 : (line.match(HEX) || []).length), 0);
      if (n) actual[file] = n;
    });
    Object.entries(actual).forEach(([file, n]) => {
      expect(n, `${file} 的寫死色碼變多了`).toBeLessThanOrEqual(ALLOWED[file] ?? 0);
    });
  });

  it("側欄與測驗成績頁的 JSX 不再寫死色碼", () => {
    ["components/navigation/userSidebar.jsx", "components/_quiz/quiz_panel_submit.jsx", "components/_auth/editProfile.jsx", "components/ui/StarRating.jsx"].forEach((file) => {
      expect(read(join(FRONTEND, file)), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  });
});

describe("Bootstrap 預設色", () => {
  it("前台 JSX 不再使用 Bootstrap 的 text-danger／text-warning／text-success／text-muted，改用 yy-text-*", () => {
    const hits = scanLines(jsx, (line) => /(?<![\w-])text-(danger|warning|success|muted)(?![\w-])/.test(line));
    expect(hits).toEqual([]);
  });

  it("前台 Bootstrap 狀態色改成品牌色，並排除後台", () => {
    const theme = css.find(({ file }) => file.endsWith("default/theme-v2.css")).text;
    expect(theme).toMatch(/\.btn-danger:not\(\.admin-shell \*\)\s*\{/);
    expect(theme).toMatch(/\.alert-danger:not\(\.admin-shell \*\)\s*\{/);
    expect(theme).toMatch(/\.alert-warning:not\(\.admin-shell \*\)\s*\{/);
  });
});

describe("圓角、邊框與陰影", () => {
  it("前台 CSS 不再寫單一 px 圓角（4、6、8、10、12、14、16），一律取 --yy-radius-*", () => {
    const hits = scanLines(css, (line) => !isTokenDefinition(line) && /border-radius:\s*(4|6|8|10|12|14|16)px\s*(!important)?\s*;/.test(line));
    expect(hits).toEqual([]);
  });

  it("輸入框、下拉、答題選項、外框按鈕的邊框不用 --yy-border-soft（對白底只有約 1.5:1，不到 WCAG 1.4.11 的 3:1）", () => {
    // --yy-border-soft 只給純分隔線與卡片外框；邊框是控制項唯一可見輪廓時要用 --yy-text-muted 或 --yy-ink
    const CONTROL = /(input|select|textarea|option|cancel|outline|page-btn)/i;
    const hits = [];
    css.forEach(({ file, text }) => {
      let selector = "";
      text.split("\n").forEach((line, i) => {
        if (line.includes("{") && !line.trim().startsWith("@")) selector = line.split("{")[0];
        if (/^\s*border(-color)?\s*:/.test(line) && line.includes("--yy-border-soft") && CONTROL.test(selector) && !/:disabled|\.disabled/.test(selector)) {
          hits.push(`${file}:${i + 1} ${selector.trim()}`);
        }
      });
    });
    expect(hits).toEqual([]);
  });

  it("沒有 2.5px 的邊框（1x 螢幕會被捨入成 2 或 3）", () => {
    const hits = scanLines(css, (line) => /border[\w-]*:[^;]*\b2\.5px\b/.test(line));
    expect(hits).toEqual([]);
  });

  it("陰影 token 為硬陰影；一般卡片不再用柔和的 rgba 模糊陰影", () => {
    // 例外：焦點環／脈動光環（模糊 0）、方向性陰影（負偏移）、0 0 光暈，這些不是卡片陰影
    const hits = scanLines(css, (line) => {
      if (isTokenDefinition(line)) return false;
      const m = line.match(/box-shadow:\s*(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)px\s+rgba?\(/);
      if (!m) return false;
      const [x, y, blur] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return blur > 0 && x >= 0 && y >= 0 && !(x === 0 && y === 0);
    });
    expect(hits).toEqual([]);
  });
});

describe("菱形與圖示", () => {
  it("菱形只旋轉背景層，文字不再旋轉 -45°", () => {
    const theme = css.find(({ file }) => file.endsWith("default/theme-v2.css")).text;
    expect(theme).not.toMatch(/rotate\(-45deg\)/);
    expect(theme).toMatch(/\.yy-step-diamond::before\s*\{[^}]*rotate\(45deg\)/);
    expect(theme).toMatch(/\.yy-diamond-badge::before\s*\{[^}]*rotate\(45deg\)/);
  });

  it("遊戲首頁、拍照、分類列、錄音、測驗選族語、筆記頁不再用 emoji 當圖示（改用 lucide）", () => {
    const EMOJI = /[\u{1F300}-\u{1FAFF}⏹]/u;
    [
      "src/_game/index.jsx", "src/_camera/index.jsx", "components/ui/CategoryBar.jsx",
      "components/_game/pronunciation/PlayingScreen.jsx", "src/_quiz/tribeSelect.jsx",
      "src/_note/noteshare.jsx", "src/_note/components/NoteCard.jsx",
    ].forEach((file) => {
      const text = read(join(FRONTEND, file)).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("{/*")).join("\n");
      expect(text, file).not.toMatch(EMOJI);
    });
  });

  it("CategoryBar 不再混用 react-icons，圖示統一用 lucide-react", () => {
    expect(read(join(FRONTEND, "components/ui/CategoryBar.jsx"))).not.toMatch(/react-icons/);
  });
});
