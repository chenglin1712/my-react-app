// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 所有公告頁的樣式守門：沉穩文藝的 token、44px 觸控、hover 只給滑鼠、減少動態不縮放。
const css = readFileSync(new URL("./_announcements/index.css", import.meta.url), "utf8");
const newsCss = readFileSync(new URL("./_home/news.css", import.meta.url), "utf8");

const rules = [];
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
const re = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = re.exec(stripped))) rules.push({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] });
const find = (selector) => rules.find((r) => r.selector === selector);

describe("所有公告頁樣式", () => {
  it("沒有寫死色碼、舊風格 token、陰影、動畫", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green|border-soft|text-muted|radius-card|radius-btn|surface)\b/);
    expect(css).not.toMatch(/box-shadow|text-shadow|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/);
  });

  it("窄欄置中（最寬 760px）、標題下雙線", () => {
    expect(find(".ann-page").body).toMatch(/max-width:\s*760px/);
    expect(find(".ann-head").body).toMatch(/border-bottom:\s*3px double/);
  });

  it("篩選鈕與按鈕至少 44px 高，目前分類反白", () => {
    expect(find(".ann-chip").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find(".ann-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find('.ann-chip[aria-pressed="true"]').body).toMatch(/background:\s*var\(--yy-calm-text\)/);
  });

  it("按下回饋；hover 只給有滑鼠的裝置；減少動態不縮放", () => {
    expect(find(".ann-chip:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    rules.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      const idx = stripped.indexOf(r.selector);
      const before = stripped.slice(0, idx);
      expect(before.lastIndexOf("(hover: hover)"), r.selector).toBeGreaterThan(before.lastIndexOf("}\n\n"));
    });
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transform:\s*none/);
  });

  it("鍵盤焦點都看得到，且不關掉 outline", () => {
    expect(find(".ann-chip:focus-visible, .ann-btn:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(css).not.toMatch(/outline:\s*none/);
  });

  it("字級至少 14px，沒有寫死的小字", () => {
    expect(css).not.toMatch(/font-size:\s*(?:1[0-3]|[0-9])px/);
  });
});

describe("首頁「查看更多公告」連結樣式", () => {
  it("至少 44px 高、底線、焦點框、hover 只給滑鼠", () => {
    const body = /\.news-more\s*\{([^}]*)\}/.exec(newsCss)[1];
    expect(body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(body).toMatch(/text-decoration:\s*underline/);
    expect(newsCss).toMatch(/\.news-more:focus-visible\s*\{[^}]*outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(newsCss).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.news-more:hover/);
  });
});
