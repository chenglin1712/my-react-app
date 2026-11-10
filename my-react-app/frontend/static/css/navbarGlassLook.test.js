// @vitest-environment node
//
// 導覽列的 Liquid Glass：頂緣高光、捲動後才出現邊線與陰影、降級回純色。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "navigation/Navbar.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

describe("導覽列玻璃（一般頁）", () => {
  it("玻璃底往下多蓋 1px（透明底框不漏出內容）", () => {
    expect(css).toMatch(/\.navbar:not\(\.navbar--magazine\)::before\s*\{[^}]*bottom:\s*calc\(-1 \* var\(--yy-border-width\)\)/);
  });

  it("玻璃底疊頂緣高光", () => {
    expect(css).toMatch(/\.navbar:not\(\.navbar--magazine\)::before\s*\{[^}]*linear-gradient\(180deg,\s*var\(--yy-glass-specular\)[^}]*var\(--yy-glass-bg\)/);
  });

  it("預設沒有邊線，捲動後（data-scrolled）才出現邊線與高度 2 的陰影", () => {
    expect(css).toMatch(/\.navbar:not\(\.navbar--magazine\)\s*\{[^}]*border-bottom-color:\s*transparent/);
    expect(css).toMatch(/\[data-scrolled="true"\]\s*\{[^}]*border-bottom-color:\s*var\(--yy-glass-border\)[^}]*box-shadow:\s*var\(--yy-elev-2\)/);
  });

  it("過渡只動邊線色（不用 all、不過渡陰影），減少動態時關掉", () => {
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).toMatch(/transition:\s*border-color var\(--dur-base\) var\(--ease-out\);/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.navbar:not\(\.navbar--magazine\)\s*\{\s*transition:\s*none/);
  });

  it("不支援 backdrop-filter、減少透明度時，::before 回純色（蓋掉高光）", () => {
    expect(css).toMatch(/@supports not[^{]*\{\s*\.navbar:not\(\.navbar--magazine\)::before\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
    expect(css).toMatch(/prefers-reduced-transparency: reduce\)\s*\{\s*\.navbar:not\(\.navbar--magazine\)::before\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
  });
});
