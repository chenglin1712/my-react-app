// @vitest-environment node
//
// 本期專題（雜誌版，對齊 Artifact）守門：三張等寬細框白卡、5:2 圖區（沒圖畫圖樣）、整張卡可點。
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
    expect(css).not.toMatch(/text-shadow|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/);
  });

  it("陰影只有 hover 時一道柔和的下緣（有模糊，不是硬偏移）", () => {
    [...css.matchAll(/box-shadow:\s*([^;]+);/g)].forEach((m) => expect(m[1]).toMatch(/^(?:0 14px 22px -16px|none$)/));
  });

  it("標題下雙線；字級至少 14px", () => {
    expect(find(".topics-header").body).toMatch(/border-bottom:\s*3px double var\(--yy-calm-line\)/);
    expect(css).not.toMatch(/font-size:\s*(?:\d|1[0-3])px/);
  });

  it("三張等寬的細框白卡：一、兩、三張都用三欄的欄寬", () => {
    ["--1", "--2", "--3"].forEach((n) => {
      expect(find(`.topics-grid${n}`, /min-width:\s*720px/), n).toBeUndefined();
    });
    const three = find(".topics-grid--1, .topics-grid--2, .topics-grid--3", /min-width:\s*720px/);
    expect(three.body).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    const card = find(".topic-card").body;
    expect(card).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(card).toMatch(/background:\s*var\(--yy-calm-surface\)/);
    expect(card).toMatch(/border-radius:\s*var\(--yy-ui-radius\)/);
  });

  it("整張卡可點（標題連結伸展），圖片寬高比固定避免版面跳動；沒圖時三款圖樣", () => {
    expect(find(".topic-link::after").body).toMatch(/position:\s*absolute/);
    expect(find(".topic-link::after").body).toMatch(/inset:\s*0/);
    expect(find(".topic-image").body).toMatch(/aspect-ratio:\s*5\s*\/\s*2/);
    [0, 1, 2].forEach((n) => expect(find(`.topic-image--pattern[data-pattern="${n}"]`), String(n)).toBeTruthy());
  });

  it("標籤顏色依序用橄欖、深銅、石板灰", () => {
    expect(find(".topic-tag").body).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(find('.topic-tag[data-tone="0"]').body).toMatch(/var\(--yy-calm-tag\)/);
    expect(find('.topic-tag[data-tone="1"]').body).toMatch(/var\(--yy-calm-accent\)/);
  });

  it("按下縮放回饋、焦點框畫在整張卡；hover 只給有滑鼠且不減少動態的裝置；減少動態不縮放", () => {
    expect(find(".topic-card:has(.topic-link):active").body).toMatch(/scale\(0\.99\)/);
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

  it("手機單欄，左右內距 16px；多欄只在 720px 以上才開", () => {
    expect(find(".topics-section").body).toMatch(/padding-inline:\s*16px/);
    expect(find(".topics-grid").body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
