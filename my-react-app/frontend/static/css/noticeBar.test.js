// @vitest-environment node
//
// 首頁頂部通知條（步驟 2-6）樣式守門：語意色、44px 觸控區、按壓回饋與 reduced-motion、連結不只靠顏色。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "_home", "notice.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

describe("notice.css", () => {
  it("沒有寫死色碼，顏色走語意層", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toMatch(/background:\s*var\(--yy-calm-tint-copper-2\)/);
    expect(css).toMatch(/color:\s*var\(--yy-calm-text\)/);
  });

  it("關閉鈕至少 44px，按壓縮放，焦點環；reduced-motion 不縮放", () => {
    expect(css).toMatch(/\.home-notice__close\s*\{[^}]*width:\s*var\(--yy-control-md\);[^}]*height:\s*var\(--yy-control-md\);/);
    expect(css).toMatch(/\.home-notice__close:active\s*\{\s*transform:\s*scale\(var\(--yy-ui-press\)\);/);
    expect(css).toMatch(/\.home-notice__close:focus-visible[^{]*\{[^}]*outline:\s*var\(--yy-ui-focus-ring\);/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.home-notice__close:active\s*\{\s*transform:\s*none;/);
  });

  it("連結有底線（不只靠顏色），hover 只給有滑鼠的裝置", () => {
    expect(css).toMatch(/\.home-notice__link\s*\{[^}]*text-decoration:\s*underline;/);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.home-notice__link:hover/);
  });

  it("沒有 transition: all；長文字可換行，不撐破版面", () => {
    expect(css).not.toMatch(/transition\s*:\s*all/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
