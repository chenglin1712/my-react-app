// @vitest-environment node
//
// 第一屏（雜誌版，對齊 Artifact）守門：族語認證公告的石板灰色塊與第一屏的欄位版面。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(ROOT, "_home", name), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const parse = (css) => {
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of css) {
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
const finder = (rules) => (selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

const calendarCss = read("calendar.css");
const cal = parse(calendarCss);
const findCal = finder(cal);
const indexCss = read("index.css");
const findIdx = finder(parse(indexCss));

describe("族語認證時程樣式", () => {
  it("沒有寫死色碼、舊風格色 token、陰影、動畫", () => {
    expect(calendarCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(calendarCss).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green|border-soft|text-muted|radius-card|radius-btn|surface)\b/);
    expect(calendarCss).not.toMatch(/box-shadow|text-shadow|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/);
  });

  it("石板灰色塊：標題下雙線，每列「日期｜標題」只有一條底線", () => {
    const sec = findCal(".exam-section").body;
    expect(sec).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(sec).toMatch(/color:\s*var\(--yy-calm-block-on\)/);
    expect(sec).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(findCal(".exam-header").body).toMatch(/border-bottom:\s*3px double/);
    expect(findCal(".exam-card").body).toMatch(/border-bottom:\s*1px solid/);
    expect(findCal(".exam-card").body).toMatch(/grid-template-columns:\s*84px minmax\(0, 1fr\)/);
    expect(findCal(".exam-date").body).toMatch(/color:\s*var\(--yy-calm-block-accent\)/);
  });

  it("整列都能點：連結的偽元素撐滿整列；重新載入鈕至少 44px 高", () => {
    expect(findCal("a.exam-link::after").body).toMatch(/inset:\s*0/);
    expect(findCal(".exam-retry").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("按下回饋、焦點框用象牙白、hover 只給有滑鼠的裝置；減少動態不縮放", () => {
    expect(findCal(".exam-retry:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(findCal("a.exam-link:focus-visible").body).toMatch(/outline-color:\s*var\(--yy-calm-focus-on-block\)/);
    expect(findCal(".exam-retry:focus-visible").body).toMatch(/outline-color:\s*var\(--yy-calm-focus-on-block\)/);
    cal.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
    const reduced = cal.find((r) => r.atRules.some((a) => /prefers-reduced-motion/.test(a)) && r.selector.includes(".exam-retry:active"));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("字級至少 14px，沒有寫死的小字", () => {
    expect(calendarCss).not.toMatch(/font-size:\s*(?:\d|1[0-3])px/);
    const small = [...calendarCss.matchAll(/font-size:\s*(0\.\d+)rem/g)].map((m) => Number(m[1])).filter((n) => n < 0.875);
    expect(small).toEqual([]);
  });
});

describe("第一屏版面", () => {
  it("1100px 以上依 --home-first-cols 並排；1100px 以下兩欄（第三欄橫跨整列），720px 以下單欄", () => {
    expect(findIdx(".home-first").body).toMatch(/display:\s*grid/);
    expect(findIdx(".home-first").body).toMatch(/grid-template-columns:\s*var\(--home-first-cols,\s*minmax\(0,\s*1fr\)\)/);
    expect(findIdx(".home-first", /max-width:\s*1100px/).body).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(findIdx(".home-first > :nth-child(3)", /max-width:\s*1100px/).body).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(findIdx(".home-first", /max-width:\s*720px/).body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("每一欄 min-width: 0（不被長內容撐破）；欄間距 24px、左右內距 16px", () => {
    expect(findIdx(".home-first > *").body).toMatch(/min-width:\s*0/);
    expect(findIdx(".home-first").body).toMatch(/gap:\s*24px/);
    expect(findIdx(".home-first").body).toMatch(/padding-inline:\s*16px/);
  });

  it("整頁收在 1200px 的欄裡；選單位置沒有內容時不佔位", () => {
    expect(findIdx(".homepage > *").body).toMatch(/max-width:\s*1200px/);
    expect(findIdx(".home-nav-slot:empty").body).toMatch(/display:\s*none/);
  });
});
