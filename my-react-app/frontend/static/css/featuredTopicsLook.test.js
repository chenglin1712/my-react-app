// @vitest-environment node
//
// S7-1 守門：本期專題的樣式。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "_home", "featuredTopics.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const parse = (source) => {
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of source) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) rules.push({ selector: prelude.replace(/\s+/g, " "), body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      buf = "";
    } else buf += ch;
  }
  return rules;
};
const rules = parse(css);
const find = (selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

describe("本期專題樣式", () => {
  it("沒有寫死色碼、舊風格色 token、陰影、動畫、transition: all、ease-in", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green|border-soft|text-muted|radius-card|radius-btn|surface)\b/);
    expect(css).not.toMatch(/box-shadow|text-shadow|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/);
  });

  it("標題下雙線；字級至少 14px", () => {
    expect(find(".topics-header").body).toMatch(/border-bottom:\s*3px double var\(--yy-calm-line\)/);
    expect(css).not.toMatch(/font-size:\s*(?:\d|1[0-3])px/);
  });

  it("三張不是等寬：第一張佔左側整高，左右 7:5", () => {
    const three = find(".topics-grid--3", /min-width:\s*720px/);
    expect(three.body).toMatch(/grid-template-columns:\s*minmax\(0,\s*7fr\)\s*minmax\(0,\s*5fr\)/);
    expect(find(".topics-grid--3 .topic-card--lead", /min-width:\s*720px/).body).toMatch(/grid-row:\s*span 2/);
    expect(css).not.toMatch(/repeat\(\s*3\s*,\s*(?:1fr|minmax\(0,\s*1fr\))\s*\)/);
  });

  it("整張卡可點（標題連結伸展），圖片寬高比固定避免版面跳動", () => {
    expect(find(".topic-link::after").body).toMatch(/position:\s*absolute/);
    expect(find(".topic-link::after").body).toMatch(/inset:\s*0/);
    expect(find(".topic-image").body).toMatch(/aspect-ratio:\s*16\s*\/\s*10/);
  });

  it("按下縮放回饋、焦點框畫在整張卡；hover 只給有滑鼠的裝置；減少動態不縮放", () => {
    expect(find(".topic-card:has(.topic-link:active)").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find(".topic-card:has(.topic-link:focus-visible)").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    // 連結自己的框只在支援 :has() 時才隱藏，否則舊瀏覽器完全沒有焦點提示
    expect(find(".topic-link:focus-visible", /@supports selector\(:has/).body).toMatch(/outline-color:\s*transparent/);
    expect(find(".topic-link:focus-visible")).toBeUndefined();
    rules.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
    const reduced = rules.find((r) => r.atRules.some((a) => /prefers-reduced-motion/.test(a)) && r.selector.includes(":active"));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("手機單欄，左右內距 24px", () => {
    expect(find(".topics-section").body).toMatch(/padding:\s*0 24px/);
    expect(find(".topics-section", /min-width:\s*720px/).body).toMatch(/padding:\s*0 56px/);
    // 兩欄以上的版面只在 720px 以上才開
    expect(find(".topics-grid--2", /min-width:\s*720px/)).toBeTruthy();
    expect(find(".topics-grid--2")).toBeUndefined();
  });
});
