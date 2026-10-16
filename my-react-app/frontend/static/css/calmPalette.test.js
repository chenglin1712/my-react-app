// @vitest-environment node
//
// S1-2 沉穩文藝語意色（--yy-calm-*）守門：淺色與深色兩組都從 theme-v2.css 讀實際值重算 WCAG 對比，
// 值被改壞（或深色兩個區塊不一致）就會失敗。DESIGN.md 的對比表也是這些數字。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const tokensIn = (body) => Object.fromEntries([...body.matchAll(/(--yy-calm-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

// 淺色：第一個 :root 區塊（沒有 :not、沒有屬性選擇器）
const rootBody = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const light = tokensIn(rootBody);
// 深色 1：跟隨裝置（<html> 沒有 data-theme 屬性時才跟隨；未知值當淺色）
const mediaBody = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/)[1];
const darkAuto = tokensIn(mediaBody);
// 深色 2：使用者明確選深色
const darkManual = tokensIn(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)[1]);

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [前景 token, 背景 token, 最低對比, 說明]。4.5 是 WCAG 小字，3 是大字、邊框與功能圖示。
const PAIRS = [
  ["text", "bg", 4.5, "內文"],
  ["text", "surface", 4.5, "卡片內文"],
  ["text-sub", "bg", 4.5, "次要文字"],
  ["text-sub", "surface", 4.5, "卡片次要文字"],
  ["accent", "bg", 4.5, "連結與小字強調"],
  ["accent", "surface", 4.5, "卡片內連結"],
  ["accent", "info-bg", 4.5, "提示底上的連結"],
  ["accent-on", "accent", 4.5, "主要按鈕文字"],
  ["tag-on", "tag", 4.5, "小字標記"],
  ["block-on", "block", 4.5, "石板灰區塊內文"],
  ["text", "info-bg", 4.5, "提示底上的內文"],
  ["success", "success-bg", 4.5, "成功訊息"],
  ["success", "bg", 4.5, "成功文字直接放頁面底"],
  ["warning", "warning-bg", 4.5, "注意訊息"],
  ["warning", "bg", 4.5, "注意文字直接放頁面底"],
  ["danger", "danger-bg", 4.5, "錯誤訊息"],
  ["danger", "bg", 4.5, "錯誤文字直接放頁面底"],
  ["line", "bg", 3, "控制項邊框對頁面底"],
  ["line", "surface", 3, "控制項邊框對卡片底"],
  ["focus", "bg", 3, "焦點外框對頁面底"],
  ["focus", "surface", 3, "焦點外框對卡片底"],
  ["focus-on-block", "block", 3, "焦點外框對石板灰區塊內的控制項"],
  ["copper", "bg", 3, "銅褐原色（大字、邊框、圖示）"],
  ["block-accent", "block", 4.5, "石板灰上的淺銅（小字也可用）"],
];
// 原色不可當小字：淺色模式的銅褐與橄欖對象牙白低於 4.5（DESIGN.md 記錄為 4.49、4.29）
const KNOWN_SMALL_TEXT_FAILS = { light: [["copper", "bg"], ["olive", "bg"]], dark: [] };

const check = (name, t, theme) => {
  describe(`${name}對比`, () => {
    PAIRS.forEach(([fg, bg, need, label]) => {
      it(`${label}：${fg} 對 ${bg} 至少 ${need}:1`, () => {
        expect(ratio(t[`--yy-calm-${fg}`], t[`--yy-calm-${bg}`]), `${t[`--yy-calm-${fg}`]} on ${t[`--yy-calm-${bg}`]}`).toBeGreaterThanOrEqual(need);
      });
    });
    KNOWN_SMALL_TEXT_FAILS[theme].forEach(([fg, bg]) => {
      it(`${fg} 原色對 ${bg} 未達 4.5:1，維持「不做小字」的限制（不達標時才需要這條規則）`, () => {
        expect(ratio(t[`--yy-calm-${fg}`], t[`--yy-calm-${bg}`])).toBeLessThan(4.5);
      });
    });
  });
};

describe("語意色 token 結構", () => {
  it("淺色、跟隨裝置的深色、手動深色三組 token 名稱完全一致", () => {
    const names = Object.keys(light).sort();
    expect(names.length).toBeGreaterThan(20);
    expect(Object.keys(darkAuto).sort()).toEqual(names);
    expect(Object.keys(darkManual).sort()).toEqual(names);
  });

  it("跟隨裝置與手動深色的色值逐一相同", () => {
    expect(darkAuto).toEqual(darkManual);
  });

  it("所有值都是 6 位十六進位色碼，深色不使用純黑或純白", () => {
    [light, darkAuto].forEach((t) => Object.entries(t).forEach(([k, v]) => expect(v, k).toMatch(/^#[0-9A-Fa-f]{6}$/)));
    Object.entries(darkAuto).forEach(([k, v]) => expect(["#000000", "#FFFFFF"], k).not.toContain(v.toUpperCase()));
  });

  it("深色底與淺色底確實不同（避免兩組複製貼上而沒換值）", () => {
    expect(darkAuto["--yy-calm-bg"]).not.toBe(light["--yy-calm-bg"]);
    expect(lum(darkAuto["--yy-calm-bg"])).toBeLessThan(lum(darkAuto["--yy-calm-text"]));
    expect(lum(light["--yy-calm-bg"])).toBeGreaterThan(lum(light["--yy-calm-text"]));
  });
});

describe("尚未改版的頁面不受影響", () => {
  it("color-scheme 仍是 light（深色區塊不改它，等頁面都改版完再開）", () => {
    expect(rootBody).toMatch(/color-scheme:\s*light\s*;/);
    expect(mediaBody).not.toMatch(/color-scheme/);
    expect(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)[1]).not.toMatch(/color-scheme/);
  });

  it("舊 token 沿用原值，沒有被新色覆蓋", () => {
    expect(rootBody).toMatch(/--yy-red:\s*#9E1B24;/);
    expect(rootBody).toMatch(/--yy-cream:\s*#F3E7CF;/);
    expect(rootBody).toMatch(/--yy-ink:\s*#221812;/);
  });

  it("主題切換不對 :root、html、body 做顏色過渡（切換瞬間整頁不會慢慢變色）", () => {
    const hits = [...css.matchAll(/(^|\})\s*((?::root|html|body)[^{]*)\{([^}]*)\}/g)]
      .filter((m) => /(^|[;\s])transition(-property)?\s*:[^;]*(color|background|all)/i.test(m[3]))
      .map((m) => m[2].trim());
    expect(hits).toEqual([]);
  });
});

check("淺色", light, "light");
check("深色", darkAuto, "dark");
