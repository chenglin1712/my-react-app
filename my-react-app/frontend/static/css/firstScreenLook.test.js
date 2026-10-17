// @vitest-environment node
//
// S6-4 守門：族語認證公告與第一屏版面的樣式。
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

describe("族語認證公告樣式", () => {
  it("沒有寫死色碼、舊風格色 token、陰影、動畫", () => {
    expect(calendarCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(calendarCss).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green|border-soft|text-muted|radius-card|radius-btn|surface)\b/);
    expect(calendarCss).not.toMatch(/box-shadow|text-shadow|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/);
  });

  it("標題下雙線，列與列之間一條細線，不是每列都有上下線", () => {
    expect(findCal(".exam-header").body).toMatch(/border-bottom:\s*3px double var\(--yy-calm-line\)/);
    expect(findCal(".exam-card + .exam-card").body).toMatch(/border-top:\s*1px solid var\(--yy-calm-rule\)/);
    expect(findCal(".exam-card").body).not.toMatch(/border/);
  });

  it("公告連結與展開鈕至少 44px 高", () => {
    expect(findCal(".exam-link").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(findCal(".exam-more").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("按下縮放回饋、焦點框、hover 只給有滑鼠的裝置；減少動態不縮放", () => {
    expect(findCal("a.exam-link:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(findCal(".exam-more:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(findCal("a.exam-link:focus-visible, .exam-more:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    cal.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
    const reduced = cal.find((r) => r.atRules.some((a) => /prefers-reduced-motion/.test(a)) && r.selector.includes("a.exam-link:active"));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("字級至少 14px，沒有寫死的小字", () => {
    expect(calendarCss).not.toMatch(/font-size:\s*(?:\d|1[0-3])px/);
    expect(calendarCss).not.toMatch(/font-size:\s*0\.\d+rem/);
  });
});

describe("第一屏版面", () => {
  it("1100px 以上依 --home-first-cols 並排，其餘單欄直向堆疊", () => {
    expect(findIdx(".home-first").body).toMatch(/display:\s*grid/);
    expect(findIdx(".home-first").body).not.toMatch(/grid-template-columns/);
    expect(findIdx(".home-first", /min-width:\s*1100px/).body).toMatch(/grid-template-columns:\s*var\(--home-first-cols,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("每一欄 min-width: 0（不被長內容撐破），三塊放進來後外距內距由這一層管理", () => {
    expect(findIdx(".home-first > *").body).toMatch(/min-width:\s*0/);
    const inner = findIdx(".home-first .home-promo, .home-first .news-section, .home-first .exam-section");
    expect(inner.body).toMatch(/padding:\s*0/);
    expect(inner.body).toMatch(/margin:\s*0/);
    expect(inner.body).toMatch(/max-width:\s*none/);
  });

  it("欄位窄時輪播與右側列表上下排", () => {
    expect(findIdx(".home-first .event-container").body).toMatch(/flex-direction:\s*column/);
  });

  it("手機左右內距 24px", () => {
    expect(findIdx(".home-first", /max-width:\s*720px/).body).toMatch(/padding:[^;]*24px/);
  });
});
