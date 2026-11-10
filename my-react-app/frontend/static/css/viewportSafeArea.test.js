// @vitest-environment node
//
// viewport-fit=cover：頁面延伸到瀏海與底部橫條下，所以貼邊的元素要自己用 env(safe-area-inset-*) 避開。
// 另外：頁尾兩字連結的點擊寬度。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const html = readFileSync(join(ROOT, "..", "..", "..", "index.html"), "utf8");
const theme = read(join(ROOT, "default", "theme-v2.css"));
const nav = read(join(ROOT, "navigation", "Navbar.css"));

describe("viewport-fit=cover", () => {
  it("index.html 宣告 viewport-fit=cover（不然 env(safe-area-inset-*) 永遠是 0）", () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  });

  it("body 橫放時左右避開瀏海", () => {
    const body = theme.match(/\nbody\s*\{([^}]*)\}/)[1];
    expect(body).toMatch(/padding-left:\s*env\(safe-area-inset-left,\s*0px\)/);
    expect(body).toMatch(/padding-right:\s*env\(safe-area-inset-right,\s*0px\)/);
  });

  it("手機底部 tab bar（貼 left/right 0）自己避開左右與底部", () => {
    const tabbar = nav.match(/\.yy-tabbar\s*\{\s*position:\s*fixed;([^}]*)\}/)[1];
    expect(tabbar).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
    expect(tabbar).toMatch(/padding-left:\s*env\(safe-area-inset-left,\s*0px\)/);
    expect(tabbar).toMatch(/padding-right:\s*env\(safe-area-inset-right,\s*0px\)/);
  });
});

describe("頁尾連結的點擊區", () => {
  it("高與寬都至少 44px（兩個字的連結寬度只有約 29px）", () => {
    const rule = theme.match(/\.yy-footer__links a\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(rule).toMatch(/min-width:\s*var\(--yy-control-md\)/);
  });
});

describe("其他貼邊元件也避開瀏海", () => {
  const css = (rel) => read(join(ROOT, rel));
  it("手機的助手視窗用 left＋right 加各自的內距決定寬度，不用固定的 100vw", () => {
    const mobile = css("_quiz/bot.css").slice(css("_quiz/bot.css").indexOf("@media (max-width: 600px)"));
    expect(mobile).toMatch(/left:\s*calc\(8px \+ env\(safe-area-inset-left/);
    expect(mobile).toMatch(/width:\s*auto/);
  });
  it("離線橫幅的最大寬度扣掉左右內距", () => {
    expect(css("ui/offlineBanner.css")).toMatch(/max-width:\s*calc\(100vw - 32px - env\(safe-area-inset-left, 0px\) - env\(safe-area-inset-right, 0px\)\)/);
  });
  it("筆記底部工具列左右都用 max(原內距, 瀏海內距)", () => {
    const toolbar = css("_note/toolbar.css");
    expect(toolbar).toMatch(/padding:\s*10px max\(20px, env\(safe-area-inset-right, 0px\)\)[^;]*max\(20px, env\(safe-area-inset-left, 0px\)\)/);
  });
});
