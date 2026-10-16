// @vitest-environment node
//
// S6-2 守門：首頁宣傳影片的樣式。
// 控制項至少 44px、按下回饋與焦點框、hover 只給有滑鼠的裝置、控制列放影片下方（不蓋在畫面上）、
// 顏色走語意層、沒有任何動畫（只有按壓與顏色的 transition）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "_home", "promoVideo.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const rules = [];
{
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) rules.push({ selector: prelude, body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      buf = "";
    } else buf += ch;
  }
}
const find = (selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

describe("宣傳影片樣式", () => {
  it("沒有寫死色碼、沒有舊風格色 token、沒有陰影", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green)\b/);
    expect(css).not.toMatch(/box-shadow|text-shadow/);
  });

  it("按鈕與進度條至少 44px 高", () => {
    expect(find(".home-promo__btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find(".home-promo__btn").body).toMatch(/min-width:\s*var\(--yy-control-md\)/);
    expect(find(".home-promo__seek").body).toMatch(/height:\s*var\(--yy-control-md\)/);
    expect(find(".home-promo__transcript summary").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find(".home-promo__bar").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("封面上的播放鈕至少 64px", () => {
    expect(find(".home-promo__big-play").body).toMatch(/width:\s*72px/);
    expect(find(".home-promo__big-play", /max-width:\s*720px/).body).toMatch(/width:\s*64px/);
  });

  it("按下有縮放回饋（共用 token），減少動態時改成只換顏色", () => {
    expect(find(".home-promo__btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find(".home-promo__big-play:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    const reduced = find(".home-promo__btn:active,\n  .home-promo__big-play:active", /prefers-reduced-motion:\s*reduce/);
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("hover 只給有滑鼠的裝置", () => {
    const hovers = rules.filter((r) => /:hover/.test(r.selector));
    expect(hovers.length).toBeGreaterThan(0);
    hovers.forEach((r) => expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true));
  });

  it("每個控制項都有焦點框", () => {
    const body = find(".home-promo__btn:focus-visible,\n.home-promo__big-play:focus-visible,\n.home-promo__seek:focus-visible,\n.home-promo__transcript summary:focus-visible").body;
    expect(body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(body).toMatch(/outline-offset:\s*var\(--yy-ui-focus-offset\)/);
  });

  it("沒有動畫，也沒有 transition: all", () => {
    expect(css).not.toMatch(/@keyframes|animation\s*:/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/ease-in(?![\w-])/);
  });

  it("影片區固定 16:9，載入前後版面不跳動；控制列不蓋在畫面上", () => {
    expect(find(".home-promo__stage").body).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
    expect(css).not.toMatch(/\.home-promo__bar\s*\{[^}]*position:\s*absolute/);
  });

  it("手機換成較窄的左右內距，逐字稿可捲動", () => {
    expect(find(".home-promo", /max-width:\s*720px/).body).toMatch(/padding:/);
    expect(find(".home-promo__transcript p").body).toMatch(/overflow-y:\s*auto/);
  });
});
