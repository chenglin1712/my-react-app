// @vitest-environment node
//
// 三態共用樣式（Apple 化步驟 2-2）：按壓有縮放且 reduced-motion 停用、焦點環、觸控區 44px、vh 有 dvh 對應。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "stateViews.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("stateViews.css", () => {
  it("重試鈕：高度至少 --yy-control-md、按壓縮放、有焦點環；reduced-motion 不縮放", () => {
    expect(css).toMatch(/\.yy-state__btn\s*\{[^}]*min-height:\s*var\(--yy-control-md\);/);
    expect(css).toMatch(/\.yy-state__btn:active\s*\{\s*transform:\s*scale\(var\(--yy-ui-press\)\);/);
    expect(css).toMatch(/\.yy-state__btn:focus-visible\s*\{[^}]*outline:\s*var\(--yy-ui-focus-ring\);/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.yy-state__btn:active\s*\{\s*transform:\s*none;/);
  });

  it("沒有 transition: all、沒有寫死色碼", () => {
    expect(css).not.toMatch(/transition\s*:\s*all/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("延遲期間的佔位高度同時有 vh 與 dvh", () => {
    expect(css).toMatch(/min-height:\s*60vh;\s*min-height:\s*60dvh;/);
  });
});
