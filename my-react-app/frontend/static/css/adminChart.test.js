// @vitest-environment node
//
// 後台圖表配色守門（Apple 化 5-4）：資料色是 token、淺色與深色各一組、在表面色上對比 ≥ 3:1；
// 儀表板與分析頁的圖表程式不再寫死色碼。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "..", "..", "src", "_admin");
const theme = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8").replace(/\r\n/g, "\n");

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a, b, p) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, "0")).join("")}`;

// 淺色在 :root 區塊；深色取 [data-theme="dark"] 區塊
const lightBlock = theme.slice(theme.indexOf(":root {"), theme.indexOf("@media (prefers-color-scheme: dark)"));
const darkStart = theme.indexOf(':root[data-theme="dark"] {');
const darkBlock = theme.slice(darkStart, theme.indexOf("}", darkStart));
const tokens = (block) => Object.fromEntries([...block.matchAll(/--(yy-[\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
const light = tokens(lightBlock);
const dark = tokens(darkBlock);

describe("圖表資料色 token", () => {
  it.each([["淺色", light], ["深色", dark]])("%s：五個資料色在卡片表面上對比 ≥ 3:1，兩兩之間也分得開", (_, t) => {
    const colors = [1, 2, 3, 4, 5].map((i) => t[`yy-data-${i}`]);
    colors.forEach((c, i) => {
      expect(c, `yy-data-${i + 1}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(ratio(c, t["yy-calm-surface"]), `chart-${i + 1} 對表面`).toBeGreaterThanOrEqual(3);
    });
    // 沒有任兩個資料色相同（色盲友善的前提：色相與亮度都分得開，另外圖上還有線型與標記）
    expect(new Set(colors.map((c) => c.toUpperCase())).size).toBe(5);
  });

  it("深色的資料色比淺色亮（深色表面上要提高亮度）", () => {
    [1, 2, 3, 4, 5].forEach((i) => expect(lum(dark[`yy-data-${i}`])).toBeGreaterThan(lum(light[`yy-data-${i}`])));
  });

  it.each([["淺色", light], ["深色", dark]])("%s：熱力圖最深的格子（資料色 45% 混表面）上的主文字對比 ≥ 4.5:1", (_, t) => {
    const cell = mix(t["yy-data-1"], t["yy-calm-surface"], 0.45);
    expect(ratio(cell, t["yy-calm-text"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("圖表程式不寫死色碼", () => {
  it.each([
    "dashboard/Dashboard.jsx",
    "analytics/QuizQualityAnalysis.jsx",
    "analytics/RetentionAnalysis.jsx",
  ])("%s：沒有 #rrggbb、rgb()、rgba()，圖表色都取 token", (file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/rgba?\(/);
  });

  it("熱力圖格子：底色是資料色混表面（最多 45%），字永遠是主文字色", () => {
    const source = readFileSync(join(SRC, "analytics", "RetentionAnalysis.jsx"), "utf8");
    expect(source).toMatch(/color-mix\(in srgb, var\(--yy-data-1\) \$\{percent\}%, var\(--yy-calm-surface\)\)/);
    expect(source).toMatch(/Math\.round\(12 \+ \(normalizedRate \* 33\)\)/);
    expect(source).toMatch(/color: 'var\(--yy-calm-text\)'/);
  });
});
