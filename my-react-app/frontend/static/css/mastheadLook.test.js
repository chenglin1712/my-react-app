// @vitest-environment node
//
// S6-1 守門：首頁報頭與跑馬燈的樣式。
// 跑馬燈是契約要求的自動捲動內容（HOMEPAGE_CONTRACT.md 4.3）：暫停鈕 44px、滑過與聚焦暫停、
// 只動 transform、減少動態時靜態；報頭顏色走語意層、手機換版面、沒有引言時不留空位。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "_home", "masthead.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const walkRules = (text) => {
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) rules.push({ selector: prelude, body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      buf = "";
    } else buf += ch;
  }
  return rules;
};
const rules = walkRules(css);
const find = (selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

describe("跑馬燈樣式", () => {
  it("沒有寫死色碼、沒有舊風格色 token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green)\b/);
  });

  it("暫停鈕至少 44px，有按下回饋，hover 只給有滑鼠的裝置", () => {
    const body = find(".home-ticker__toggle").body;
    // 跑馬燈是一條細帶（對齊設計稿）：暫停鈕 32px，仍大於 WCAG 2.5.8 的最小 24px
    expect(body).toMatch(/min-width:\s*32px/);
    expect(body).toMatch(/min-height:\s*32px/);
    expect(find(".home-ticker__toggle:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    rules.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
  });

  it("捲動：恆速 linear、無限循環、只動 transform（不動 left、margin 等版面屬性）", () => {
    const track = find(".home-ticker__track").body;
    expect(track).toMatch(/animation:\s*home-ticker-scroll[^;]*\blinear\b[^;]*\binfinite\b/);
    const keyframes = css.match(/@keyframes home-ticker-scroll\s*\{([\s\S]*?\})\s*\}/)[1];
    expect(keyframes.match(/[\w-]+(?=\s*:)/g).filter((p) => !["from", "to"].includes(p))).toEqual(["transform", "transform"]);
    expect(keyframes).toMatch(/translateX\(0\)/);
    expect(keyframes).toMatch(/translateX\(-50%\)/);
    expect(css.match(/@keyframes\s+[\w-]+/g)).toEqual(["@keyframes home-ticker-scroll", "@keyframes home-mast-in"]);
  });

  it("暫停只由按鈕狀態決定：沒有 hover／focus-within 自動暫停（否則按下播放後畫面仍不動，與按鈕標示不一致）", () => {
    expect(find('.home-ticker[data-paused="true"] .home-ticker__track').body).toMatch(/animation-play-state:\s*paused/);
    const pausers = rules.filter((r) => /animation-play-state:\s*paused/.test(r.body)).map((r) => r.selector);
    expect(pausers).toEqual(['.home-ticker[data-paused="true"] .home-ticker__track']);
    expect(css).not.toMatch(/:focus-within|\.home-ticker:hover/);
  });

  it("接縫不留大片空白：每一份至少和視窗一樣寬（容器單位，附不支援時的退路）", () => {
    const body = find(".home-ticker__copy").body;
    expect(body).toMatch(/min-width:\s*100vw;\s*min-width:\s*100cqw/);
    expect(find(".home-ticker__viewport").body).toMatch(/container-type:\s*inline-size/);
  });

  it("減少動態：不捲動、複本與暫停鈕隱藏；靜態版換行排開", () => {
    const reduced = find(".home-ticker__track", /prefers-reduced-motion:\s*reduce/);
    expect(reduced.body).toMatch(/animation:\s*none/);
    const hide = find('.home-ticker__copy[aria-hidden="true"],\n  .home-ticker__toggle', /prefers-reduced-motion:\s*reduce/)
      ?? rules.find((r) => r.selector.includes(".home-ticker__toggle") && r.atRules.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)));
    expect(hide.body).toMatch(/display:\s*none/);
    expect(find(".home-ticker__copy--static").body).toMatch(/flex-wrap:\s*wrap/);
  });

  it("項目後面一個銅色星號分隔（對齊 Artifact）；字級至少 14px", () => {
    expect(find(".home-ticker__copy li::after").body).toMatch(/content:\s*"\\2731"/);
    expect(find(".home-ticker__copy li").body).toMatch(/font-size:\s*var\(--yy-text-sm\)/);
  });
});

describe("報頭樣式", () => {
  it("石板灰底、象牙白字、1.5px 邊框走語意層", () => {
    const body = find(".home-mast").body;
    expect(body).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(body).toMatch(/color:\s*var\(--yy-calm-block-on\)/);
    expect(body).toMatch(/border-block:\s*1px solid var\(--yy-calm-line\)/);
  });

  it("桌面三欄：左原語、中引言、右刊名；沒有引言時只剩兩欄", () => {
    expect(find(".home-mast").body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto\s*minmax\(0,\s*1fr\)/);
    expect(find(".home-mast").body).toMatch(/grid-template-areas:\s*"name quote en"/);
    const noQuote = find(".home-mast--no-quote").body;
    expect(noQuote).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
    expect(noQuote).toMatch(/grid-template-areas:\s*"name en"/);
  });

  it("手機（720px 以下）：第一列原語與刊名、第二列引言；沒有引言時只有一列", () => {
    const mobile = find(".home-mast", /max-width:\s*720px/);
    expect(mobile.body).toMatch(/"name en"\s*"quote quote"/);
    expect(find(".home-mast--no-quote", /max-width:\s*720px/).body).toMatch(/grid-template-areas:\s*"name en"/);
  });

  it("引言置中，標語用象牙白（對石板灰 4.5:1 以上）且至少 14px", () => {
    expect(find(".home-mast__quote").body).toMatch(/text-align:\s*center/);
    const tagline = find(".home-mast__tagline").body;
    expect(tagline).toMatch(/color:\s*var\(--yy-calm-block-on\)/);
    expect(tagline).toMatch(/font-size:\s*var\(--yy-text-sm\)/);
  });

  it("沒有硬偏移陰影，沒有 transition: all；只有「原語」有一道帶模糊的銅色影子（對齊雜誌版 Artifact）", () => {
    expect(css).not.toMatch(/box-shadow/);
    expect(css.match(/text-shadow/g) || []).toHaveLength(1);
    expect(find(".home-mast__name").body).toMatch(/text-shadow:\s*calc\(var\(--sx\) \* 0\.6em\) calc\(var\(--sy\) \* 0\.6em\) 1px/);
    expect(css).not.toMatch(/transition:\s*all/);
  });
});
