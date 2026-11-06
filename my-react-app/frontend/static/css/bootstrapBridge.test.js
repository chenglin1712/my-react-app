// @vitest-environment node
//
// Apple 化步驟 1-9（Bootstrap 變數覆寫，第一步）：主色、狀態色、圓角、字型都接到我們的 token，
// 不再有 Bootstrap 預設藍（#0d6efd）從載入圖示（.text-primary）等地方漏出來。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const theme = strip(readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8"));

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
// 色盤順序：淺色 [0]、跟隨裝置深色 [1]、手動深色 [2]
const calm = (name) => [...theme.matchAll(new RegExp(`^\\s*--yy-calm-${name}:\\s*(#[0-9A-Fa-f]{6});`, "gm"))].map((m) => m[1]);
const bsRgb = (name) => [...theme.matchAll(new RegExp(`^\\s*--bs-${name}-rgb:\\s*([^;]+);`, "gm"))].map((m) => m[1].trim());

// 後面這個 :root 區塊是橋接（檔案裡最後一個 :root {）
const bridge = (() => {
  const all = [...theme.matchAll(/(?:^|\n):root\s*\{([^}]*)\}/g)];
  return all.at(-1)[1];
})();

describe("Bootstrap 變數橋接", () => {
  it("主色與狀態色引用 --yy-calm-*（深淺色自動跟著換）", () => {
    [
      ["primary", "accent"], ["success", "success"], ["warning", "warning"], ["danger", "danger"], ["info", "block"], ["secondary", "text-sub"],
    ].forEach(([bs, c]) => expect(bridge, bs).toMatch(new RegExp(`--bs-${bs}:\\s*var\\(--yy-calm-${c}\\)`)));
    expect(bridge).toMatch(/--bs-link-color:\s*var\(--yy-calm-accent\)/);
  });

  it("rgb 三元組與引用的色盤值一致：淺色在 :root，深色兩個區塊各一份且相同", () => {
    [["primary", "accent"], ["success", "success"], ["warning", "warning"], ["danger", "danger"], ["info", "block"], ["secondary", "text-sub"]].forEach(([bs, c]) => {
      const hex = calm(c);
      const got = bsRgb(bs);
      expect(got.length, `--bs-${bs}-rgb 應有淺色與兩個深色共 3 份`).toBe(3);
      // 檔案順序：兩個深色區塊在前、檔尾 :root 在後
      expect(got[0], `${bs} 跟隨裝置深色`).toBe(rgbOf(hex[1]));
      expect(got[1], `${bs} 手動深色`).toBe(rgbOf(hex[2]));
      expect(got[2], `${bs} 淺色`).toBe(rgbOf(hex[0]));
    });
  });

  it("圓角接到四階 token，字型接到內文字型 token", () => {
    expect(bridge).toMatch(/--bs-border-radius:\s*var\(--yy-radius-control\)/);
    expect(bridge).toMatch(/--bs-border-radius-sm:\s*var\(--yy-radius-tag\)/);
    expect(bridge).toMatch(/--bs-border-radius-lg:\s*var\(--yy-radius-panel\)/);
    expect(bridge).toMatch(/--bs-border-radius-xl:\s*var\(--yy-radius-block\)/);
    expect(bridge).toMatch(/--bs-border-radius-pill:\s*var\(--yy-radius-pill\)/);
    expect(bridge).toMatch(/--bs-body-font-family:\s*var\(--yy-font-body\)/);
  });

  it("前台 CSS 不再寫 Bootstrap 預設藍（#0d6efd、13, 110, 253）", () => {
    const walk = (dir) =>
      readdirSync(dir).flatMap((n) => {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) return walk(full);
        return full.endsWith(".css") ? [full] : [];
      });
    const hits = walk(ROOT).filter((f) => /#0d6efd|13,\s*110,\s*253/i.test(strip(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
  });

  it("載入圖示的預設主色會變成深銅（--bs-primary 不是 Bootstrap 預設藍）", () => {
    expect(bridge).not.toMatch(/--bs-primary:\s*#0d6efd/i);
    expect(bsRgb("primary").at(-1)).toBe("126, 82, 57");
  });
});
