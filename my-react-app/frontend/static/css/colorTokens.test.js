// B-4 色彩與字型 token：舊紅清掉、token 補齊、color-scheme 宣告、像素字有中文回退、
// 遊戲專區卡片標題的對比達標。後台（_admin、含 admin 的檔名）用另一套樣式，留到階段 G。
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

// 移除註解但保留換行，回報的行號才會和原始檔一致
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
// 後台（_admin 資料夾，或檔名以 admin 開頭）留到階段 G
const isAdmin = (file) => /(^|\/)_admin\//i.test(file) || /(^|\/)admin[^/]*$/i.test(file);
const isTestFile = (file) => /\.(test|spec)\.[jt]sx?$/.test(file);
const rel = (file) => relative(FRONTEND, file).split(/[\\/]/).join("/");
const read = (file) => readFileSync(file, "utf8");

const cssFiles = walk(join(FRONTEND, "static", "css"), [".css"]).map((f) => ({ file: rel(f), css: strip(read(f)) }));
const frontCss = cssFiles.filter(({ file }) => !isAdmin(file));
const theme = cssFiles.find(({ file }) => file.endsWith("default/theme-v2.css")).css;

// WCAG 相對亮度與對比
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (name) => theme.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];

describe("舊紅與寫死的品牌紅", () => {
  it("前台 CSS 與 JSX 不再有舊紅 #9B1B30 及其 rgba(155, 27, 48)", () => {
    const scripts = walk(FRONTEND, [".js", ".jsx", ".ts", ".tsx"])
      .map((f) => ({ file: rel(f), text: read(f) }))
      .filter(({ file }) => !isTestFile(file) && !isAdmin(file));
    const sources = [...frontCss.map(({ file, css }) => ({ file, text: css })), ...scripts];
    // #9B1B30 後面不能再接十六進位數字（連 8 位的 #9B1B30CC 也要抓），也抓現代的 rgb(155 27 48 / .2) 寫法
    const oldRed = /#9b1b30(?![0-9a-f])|rgba?\(\s*155[\s,]+27[\s,]+48/i;
    const offenders = sources.filter(({ text }) => oldRed.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("前台 CSS 的規則裡不直接寫 #9E1B24，一律引用 var(--yy-red)（token 定義行除外）", () => {
    const offenders = [];
    frontCss.forEach(({ file, css }) => {
      css.split("\n").forEach((line, i) => {
        if (/^\s*--[\w-]+\s*:/.test(line)) return; // token 定義
        if (/#9e1b24\b/i.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    });
    expect(offenders).toEqual([]);
  });

  it("沒有 var(--x, var(--x)) 這種指向自己的備援值", () => {
    // 後台有一行既有的同類寫法（_admin/homepage-config.css:24），留到階段 G 一併處理
    const offenders = frontCss.filter(({ css }) => /var\(\s*(--[\w-]+)\s*,\s*var\(\s*\1\s*[,)]/.test(css)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("筆記頁的平行 token 改指向全站 token", () => {
    const note = frontCss.find(({ file }) => file.endsWith("_note/notestyle.css")).css;
    expect(note).toMatch(/--brand-red:\s*var\(--yy-calm-accent\)/);
    expect(note).toMatch(/--brand-red-600:\s*var\(--yy-calm-accent\)/);
    expect(note).toMatch(/--danger:\s*var\(--yy-calm-danger\)/);
    const share = frontCss.find(({ file }) => file.endsWith("_note/notesharestyle.css")).css;
    expect(share).toMatch(/--rose-700:\s*var\(--yy-calm-accent\)/);
  });

  it("測驗側欄與結果頁的圖示不再用寫死的 color 屬性", () => {
    ["components/_quiz/sideBar.jsx", "components/_quiz/ReviewAttemptDetail.jsx", "components/_quiz/quiz_matching_question.jsx", "components/_quiz/quiz_panel_submit.jsx"].forEach((file) => {
      expect(read(join(FRONTEND, file)), file).not.toMatch(/\b(color|fill)="#[0-9A-Fa-f]{3,8}"/);
    });
  });
});

describe("theme-v2 token", () => {
  it("宣告 color-scheme: light，meta 也一致", () => {
    expect(theme).toMatch(/:root\s*\{[^}]*color-scheme:\s*light\s*;/);
    expect(readFileSync(join(FRONTEND, "..", "index.html"), "utf8")).toMatch(/<meta name="color-scheme" content="light"/);
  });

  it("像素字 token 已改成內文字型的別名（Silkscreen 已移除，字型堆疊細節見 fontStack.test.js）", () => {
    expect(theme).toMatch(/--yy-font-pixel:\s*var\(--yy-font-body\)/);
    const offenders = cssFiles.filter(({ css }) => /Silkscreen/.test(css)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("補齊表面、焦點、間距、字級、控制項高度與層級 token", () => {
    [
      "--yy-surface", "--yy-surface-page", "--yy-border", "--yy-focus-ring", "--yy-focus-offset",
      "--yy-space-1", "--yy-space-4", "--yy-space-8",
      "--yy-text-xs", "--yy-text-base", "--yy-text-3xl", "--yy-leading-tight", "--yy-leading-normal", "--yy-leading-loose",
      "--yy-control-sm", "--yy-control-md", "--yy-control-lg",
      "--yy-z-raised", "--yy-z-sticky", "--yy-z-nav", "--yy-z-overlay", "--yy-z-popover", "--yy-z-top",
    ].forEach((name) => expect(theme, name).toContain(`${name}:`));
    // 觸控區至少 44px
    expect(theme).toMatch(/--yy-control-md:\s*44px/);
    // 層級必須由低到高
    const z = ["raised", "sticky", "nav", "overlay", "popover", "top"].map((n) => Number(theme.match(new RegExp(`--yy-z-${n}:\\s*(\\d+)`))[1]));
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });

  it("焦點基線使用 --yy-ui-focus-ring token", () => {
    expect(theme).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });
});

describe("遊戲專區卡片標題對比", () => {
  const gameCss = frontCss.find(({ file }) => file.endsWith("_game/index.css")).css;
  const head = (gameCss.match(/\.gamehub-card-head\s*\{([^}]*)\}/) || [])[1] ?? "";

  it("卡片頭部底色是米白，不再把漸層直接鋪在標題後面", () => {
    expect(head).toMatch(/background:\s*var\(--yy-calm-info-bg\)/);
    expect(head).not.toMatch(/animation:/);
    expect(read(join(FRONTEND, "src/_game/index.jsx"))).not.toMatch(/style=\{\{\s*background:\s*g\.headerBg/);
  });

  it("漸層色帶已移除（S8-2 沉穩外觀不用漸層），也沒有流動動畫", () => {
    const band = (gameCss.match(/\.gamehub-card-head::before\s*\{([^}]*)\}/) || [])[1] ?? "";
    expect(band).toMatch(/display:\s*none/);
    expect(band).not.toMatch(/animation:/);
  });

  it("標題、副標題、說明文字對米白底都 ≥ 4.5:1", () => {
    const cream = token("--yy-cream");
    ["--yy-ink", "--yy-text-tertiary", "--yy-text-secondary"].forEach((name) => {
      expect(contrast(token(name), cream), name).toBeGreaterThanOrEqual(4.5);
    });
  });
});
