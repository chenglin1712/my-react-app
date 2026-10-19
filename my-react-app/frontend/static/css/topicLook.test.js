// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 專題文章頁的樣式守門：沉穩文藝 token、閱讀寬度與行高、44px 觸控、hover 只給滑鼠、減少動態不縮放。
const css = readFileSync(new URL("./_topic/index.css", import.meta.url), "utf8");

const rules = [];
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
const re = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = re.exec(stripped))) rules.push({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] });
const find = (selector) => rules.find((r) => r.selector === selector);

describe("專題文章頁樣式", () => {
  it("沒有寫死色碼、舊風格 token、陰影、動畫", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green|border-soft|text-muted|radius-card|radius-btn|surface)\b/);
    expect(css).not.toMatch(/box-shadow|text-shadow|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/);
  });

  it("窄欄置中（最寬 760px）、標題區下雙線", () => {
    expect(find(".tpage-page").body).toMatch(/max-width:\s*760px/);
    expect(find(".tpage-head").body).toMatch(/border-bottom:\s*3px double/);
  });

  it("內文字級至少 18px、行高至少 1.9，保留段內換行並允許長字串折行", () => {
    const body = find(".tpage-body p").body;
    expect(body).toMatch(/font-size:\s*1\.125rem/);
    expect(Number(/line-height:\s*([\d.]+)/.exec(body)[1])).toBeGreaterThanOrEqual(1.9);
    expect(body).toMatch(/white-space:\s*pre-line/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("標題與導言、圖說都允許折行，不會撐出橫向捲軸", () => {
    expect(find(".tpage-title").body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(find(".tpage-figure img").body).toMatch(/width:\s*100%/);
  });

  it("按鈕與回首頁連結至少 44px 高，按下回饋；hover 只給有滑鼠的裝置；減少動態不縮放", () => {
    expect(find(".tpage-back, .tpage-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find(".tpage-btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    rules.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      const idx = stripped.indexOf(r.selector);
      const before = stripped.slice(0, idx);
      expect(before.lastIndexOf("(hover: hover)"), r.selector).toBeGreaterThan(before.lastIndexOf("}\n\n"));
    });
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transform:\s*none/);
  });

  it("鍵盤焦點看得到，不關掉 outline", () => {
    expect(find(".tpage-back:focus-visible, .tpage-btn:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(css).not.toMatch(/outline:\s*none/);
  });

  it("輔助字級（標籤、署名、圖說）至少 14px，沒有寫死的小字", () => {
    expect(css).not.toMatch(/font-size:\s*(?:1[0-3]|[0-9])px/);
  });
});
