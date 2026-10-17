// @vitest-environment node
//
// F-4 金色與族色上的文字對比守門（審查項 P1-19、P2-14、P2-15）。
// 規則：文字對比至少 4.5:1；金色 --yy-gold 只當底色或邊框，要放文字時用墨字；
// 金色當資料標記（星星、圖表）改用 --yy-gold-mark。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRIBES } from "../../src/constants/tribes";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");

const walk = (dir, exts) =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });
const rel = (file) => relative(FRONTEND, file).split(/[\\/]/).join("/");
const isAdmin = (file) => /(^|\/)_admin\//i.test(file) || /(^|\/)admin[^/]*$/i.test(file) || /adminLogin/i.test(file);
const isTest = (file) => /\.(test|spec)\.[jt]sx?$/.test(file);

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("族色與其上的文字", () => {
  it("每個啟用的族群都有 textColor，且對 color 的對比至少 4.5:1", () => {
    TRIBES.forEach((t) => {
      expect(t.textColor, t.slug).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(ratio(t.color, t.textColor), `${t.slug} ${t.color}/${t.textColor}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("排灣金底用墨字，不用白字", () => {
    const paiwan = TRIBES.find((t) => t.slug === "paiwan");
    expect(paiwan.textColor.toUpperCase()).toBe("#221812");
  });

  it("金色資料標記色 --yy-gold-mark 對白底與米白底至少 3:1（圖形元件標準）", () => {
    expect(ratio("#8A6816", "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(ratio("#8A6816", "#F3E7CF")).toBeGreaterThanOrEqual(3);
  });
});

describe("前台不再把金色當白字底或資料標記", () => {
  it("原始碼不再硬寫 #D9A227（要用 token）", () => {
    const hits = [];
    walk(FRONTEND, [".jsx", ".js"]).forEach((file) => {
      const r = rel(file);
      if (isTest(file) || isAdmin(r) || r.startsWith("node_modules") || r.startsWith("dist")) return;
      if (/#D9A227/i.test(readFileSync(file, "utf8"))) hits.push(r);
    });
    expect(hits).toEqual([]);
  });

  it("金色底的規則不搭配白字或米白字", () => {
    const hits = [];
    walk(join(FRONTEND, "static", "css"), [".css"]).forEach((file) => {
      const r = rel(file);
      if (isAdmin(r)) return;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2];
        const bg = body.match(/background(?:-color)?\s*:\s*var\(--yy-gold\)\s*(?:;|!)/);
        const color = body.match(/(?<![-\w])color\s*:\s*var\(--yy-(surface|cream)\)/);
        if (bg && color) hits.push(`${r}: ${m[1].trim().split("\n").pop()}`);
      }
    });
    expect(hits).toEqual([]);
  });
});

// G-1 後台共用基礎層：後台的文字、狀態、焦點、圓角 token 要取自前台 --yy-*，不再各自寫一份色碼
describe("後台共用基礎層（G-1）", () => {
  const layout = readFileSync(join(ROOT, "_admin", "layout.css"), "utf8");
  const block = layout.slice(layout.indexOf("--admin-bg:"), layout.indexOf("--admin-page-padding:"));

  it.each([
    ["--admin-text-strong", "var(--yy-calm-text)"],
    ["--admin-muted", "var(--yy-calm-text-sub)"],
    ["--admin-success", "var(--yy-calm-success)"],
    ["--admin-success-bg", "var(--yy-calm-success-bg)"],
    ["--admin-danger", "var(--yy-calm-danger)"],
    ["--admin-danger-bg", "var(--yy-calm-danger-bg)"],
    ["--admin-warning-text", "var(--yy-calm-warning)"],
    ["--admin-warning-bg", "var(--yy-calm-warning-bg)"],
    ["--admin-radius", "var(--yy-ui-radius)"],
    ["--admin-radius-sm", "var(--yy-ui-radius)"],
    ["--admin-focus-ring", "var(--yy-ui-focus-ring)"],
  ])("%s 取自 %s", (name, value) => {
    const escaped = value.replace(/[()]/g, "\\$&");
    expect(block).toMatch(new RegExp(`${name}:\\s*${escaped}\\s*;`));
  });

  it("後台 CSS 不再硬寫被共用 token 取代的舊色碼", () => {
    const old = /#b02a37|#146c43|#8a5a00|#14213a|#5f6b7a|#a3cfbb|#f1b8bd|#ecf8f2|#fff5f5/i;
    const hits = [];
    walk(join(ROOT, "_admin"), [".css"]).forEach((file) => {
      if (old.test(readFileSync(file, "utf8"))) hits.push(rel(file));
    });
    expect(hits).toEqual([]);
  });

  it("表單與選單的焦點框用共用焦點框，不再用淡色 box-shadow", () => {
    const base = readFileSync(join(ROOT, "_admin", "admin-base.css"), "utf8");
    expect(base).not.toMatch(/--admin-focus\)/);
    expect(base).toMatch(/\.form-select\):focus\s*\{[^}]*outline:\s*var\(--admin-focus-ring\)/);
  });

  it("各頁篩選欄的 :focus 不再用淡藍 box-shadow 蓋過共用焦點框", () => {
    ["dashboard.css", "analytics.css", "quiz-quality-analysis.css"].forEach((name) => {
      const css = readFileSync(join(ROOT, "_admin", name), "utf8");
      expect(css, name).not.toMatch(/box-shadow:\s*0 0 0 \.2rem rgba\(31, 58, 92, \.1\)/);
    });
  });

  it("--yy-*-border 有不依賴 color-mix 的固定色備援", () => {
    const theme = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8");
    expect(theme).toMatch(/--yy-success-border:\s*#[0-9A-Fa-f]{6};/);
    expect(theme).toMatch(/--yy-danger-border:\s*#[0-9A-Fa-f]{6};/);
    expect(theme).toMatch(/@supports \(color: color-mix\(/);
  });

  it("後台沉穩 token 的前景與底色配對對比至少 4.5:1", () => {
    const pairs = [
      ["#8A3A4E", "#F5E1E6"], ["#8A3A4E", "#FFF9ED"], ["#2F6F4B", "#E3F0E8"], ["#7D5B0E", "#F6ECD3"],
      ["#41464B", "#FFF9ED"], ["#41464B", "#EFE6DA"], ["#7E5239", "#EFE6DA"], ["#FFF9ED", "#41464B"], ["#D7A98B", "#41464B"],
    ];
    pairs.forEach(([fg, bg]) => expect(ratio(fg, bg), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5));
  });
});
