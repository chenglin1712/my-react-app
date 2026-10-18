// @vitest-environment node
//
// S5-2 頁尾與全站外殼守門：頁尾走石板灰區塊與語意色、連結觸控區 44px、hover 只給有滑鼠的裝置、
// 手機疊單欄、跳到主要內容的連結聚焦時有清楚外觀、導覽列（淺色）不再套深色底用的金色焦點框。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

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
const footerRules = rules.filter((r) => /\.yy-footer/.test(r.selector));

describe("頁尾（雜誌版，對齊 Artifact）", () => {
  it("收在 1200px 的欄裡的深色石板灰塊、象牙白字，沒有寫死色碼或舊風格色", () => {
    const body = find(".yy-footer").body;
    expect(body).toMatch(/max-width:\s*1200px/);
    expect(body).toMatch(/background:\s*var\(--yy-calm-block-deep\)/);
    expect(body).toMatch(/color:\s*var\(--yy-calm-block-on\)/);
    // 深色主題裡深石板灰與卡片底色很接近，頂端邊界讓頁尾分得出來
    expect(body).toMatch(/border-top:\s*1px solid var\(--yy-calm-line\)/);
    footerRules.forEach((r) => {
      expect(r.body, r.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(r.body, r.selector).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green)\b/);
    });
  });

  it("頁尾引用的 token 真的有定義（沒定義會退回預設色）", () => {
    expect(css).toMatch(/--yy-calm-focus-on-block:\s*#[0-9A-Fa-f]{6}/);
    expect(css).toMatch(/--yy-calm-block-accent:\s*#D7A98B/);
    expect(css).toMatch(/--yy-calm-block-deep:\s*#33383D/);
  });

  it("超大「原語」、連結與標語；窄螢幕自動換行，手機上方留白縮小", () => {
    expect(find(".yy-footer__inner").body).toMatch(/flex-wrap:\s*wrap/);
    expect(find(".yy-footer__name").body).toMatch(/font-size:\s*clamp\(3\.4rem,\s*12vw,\s*7rem\)/);
    expect(find(".yy-footer", /max-width:\s*720px/).body).toMatch(/margin-top:\s*80px/);
  });

  it("連結是細框按鈕：觸控區至少 44px，hover 只給有滑鼠的裝置，按下有回饋", () => {
    const link = find(".yy-footer__links a").body;
    expect(link).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(link).toMatch(/border:\s*1px solid var\(--yy-calm-block-on\)/);
    const hover = footerRules.filter((r) => /:hover/.test(r.selector));
    expect(hover.length).toBeGreaterThan(0);
    hover.forEach((r) => expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true));
    expect(find(".yy-footer__links a:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
  });

  it("減少動態時不縮放", () => {
    const reduced = rules.find((r) => r.selector === ".yy-footer__links a:active" && r.atRules.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("深石板灰底的焦點框用象牙白；導覽列不再套金色焦點框", () => {
    expect(find(".yy-footer :where(a, button):focus-visible").body).toMatch(/outline-color:\s*var\(--yy-calm-focus-on-block\)/);
    expect(css).not.toMatch(/\.navbar\s+:where\(a, button\):focus-visible/);
  });
});

describe("跳到主要內容（S5-2）", () => {
  it("聚焦時固定在左上角、深銅底實心、44px 高、層級在最上面", () => {
    const body = find(".visually-hidden-focusable:focus").body;
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/background:\s*var\(--yy-calm-accent\)/);
    expect(body).toMatch(/color:\s*var\(--yy-calm-accent-on\)/);
    expect(body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(body).toMatch(/z-index:\s*var\(--yy-z-top\)/);
  });
});
