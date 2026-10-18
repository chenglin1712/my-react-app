// @vitest-environment node
//
// 首頁最新消息（雜誌版，對齊 Artifact）守門：
// 顏色走語意層、控制項 44px、圖區 3:1 說明在白底、圓形按鈕在右下、hover 只給有滑鼠的裝置、減少動態只換顏色，
// 輪播箭頭的規則限縮在 .news-stage .news-carousel（不影響站內其他輪播）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "_home", "news.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

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
      if (prelude !== undefined && !prelude.startsWith("@")) rules.push({ selector: prelude.replace(/\s+/g, " "), body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      buf = "";
    } else buf += ch;
  }
}
const find = (selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

describe("最新消息樣式", () => {
  it("沒有寫死色碼、沒有舊風格色 token、沒有陰影；漸層只用在沒圖時的圖樣", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/--yy-(?:red|gold|gold-light|blue|cream|ink|green|border-soft|text-muted|text-secondary|radius-card|radius-lg|radius-btn)\b/);
    expect(css).not.toMatch(/text-shadow|box-shadow/);
    const gradientRules = rules.filter((r) => /gradient/.test(r.body));
    gradientRules.forEach((r) => expect(r.selector, r.selector).toMatch(/news-slide-pattern/));
  });

  it("沒有動畫，沒有 transition: all，沒有 ease-in", () => {
    expect(css).not.toMatch(/@keyframes|animation\s*:/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/ease-in(?![\w-])/);
  });

  it("輪播：圖區 3:1，說明在白底的卡片面，按鈕那一列留在說明區底下，不蓋住標題", () => {
    expect(find(".news-slide img, .news-slide-pattern").body).toMatch(/aspect-ratio:\s*3\s*\/\s*1/);
    expect(find(".news-stage").body).toMatch(/background:\s*var\(--yy-calm-surface\)/);
    const info = find(".news-slide-info").body;
    expect(info).toMatch(/padding:[^;]*calc\(var\(--yy-control-md\)/);
    expect(find(".news-slide-info a").body).toMatch(/position:\s*absolute/);
    expect(find(".news-slide-info a").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("沒有圖片時三款圖樣：斜紋、直紋、圓點", () => {
    [0, 1, 2].forEach((n) => expect(find(`.news-slide-pattern[data-pattern="${n}"]`), String(n)).toBeTruthy());
  });

  it("上一則、下一則、暫停：44px 圓形，並排在右下；規則限縮在 .news-stage .news-carousel", () => {
    const toggle = find(".news-autoplay-toggle");
    const arrows = find(".news-stage .news-carousel .swiper-button-prev, .news-stage .news-carousel .swiper-button-next, .news-autoplay-toggle");
    [arrows.body, toggle ? toggle.body : ""].forEach((b) => expect(b).toMatch(/border-radius|right:/));
    expect(arrows.body).toMatch(/width:\s*var\(--yy-control-md\)/);
    expect(arrows.body).toMatch(/height:\s*var\(--yy-control-md\)/);
    expect(arrows.body).toMatch(/border-radius:\s*50%/);
    expect(arrows.body).toMatch(/bottom:\s*8px/);
    expect(find(".news-stage .news-carousel .swiper-button-prev").body).toMatch(/right:\s*calc\(/);
    expect(find(".news-stage .news-carousel .swiper-button-next").body).toMatch(/right:\s*calc\(/);
    rules.filter((r) => /swiper-button/.test(r.selector)).forEach((r) => {
      r.selector.split(",").filter((s) => /swiper-button/.test(s)).forEach((s) => expect(s.trim().startsWith(".news-stage .news-carousel"), s).toBe(true));
    });
  });

  it("可按的元件按下有縮放回饋、有焦點框；減少動態時不縮放", () => {
    ["a.news-text-item:active", ".news-autoplay-toggle:active, .news-stage .news-carousel .swiper-button-prev:active, .news-stage .news-carousel .swiper-button-next:active"].forEach((s) => {
      const r = rules.find((x) => x.selector.includes(s.split(",")[0]) && x.atRules.length === 0);
      expect(r.body, s).toMatch(/scale\(/);
    });
    expect(css).toMatch(/\.news-autoplay-toggle:focus-visible/);
    const reduced = rules.find((r) => r.atRules.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)) && r.selector.includes("a.news-text-item:active"));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("hover 只給有滑鼠的裝置", () => {
    const hovers = rules.filter((r) => /:hover/.test(r.selector));
    expect(hovers.length).toBeGreaterThan(0);
    hovers.forEach((r) => expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true));
  });

  it("分類標籤：預設石板灰，公告深銅、活動橄欖、系統維護只有細框", () => {
    expect(find(".news-tag").body).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(find('.news-tag[data-tag="公告"]').body).toMatch(/var\(--yy-calm-accent\)/);
    expect(find('.news-tag[data-tag="活動"]').body).toMatch(/var\(--yy-calm-tag\)/);
    expect(find('.news-tag[data-tag="系統維護"]').body).toMatch(/background:\s*transparent/);
  });

  it("字級至少 14px（沒有 rem 小數寫死的小字）", () => {
    const small = [...css.matchAll(/font-size:\s*(0\.\d+)rem/g)].map((m) => Number(m[1])).filter((n) => n < 0.875);
    expect(small).toEqual([]);
  });

  it("標題下雙線；列表只有一列一條底線", () => {
    expect(find(".news-section-header").body).toMatch(/border-bottom:\s*3px double var\(--yy-calm-line\)/);
    expect(find(".text-list li").body).toMatch(/border-bottom:\s*1px solid var\(--yy-calm-line\)/);
    expect(find(".news-text-item").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("有輪播時列表只放日期與標題（標籤留給報讀器）；只有列表時才顯示標籤", () => {
    expect(find(".text-list:not(.text-list--only) .news-text-item-tag").body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(find(".text-list--only .news-text-item").body).toMatch(/grid-template-areas:\s*"tag date"\s*"title title"/);
  });

  it("列表標題最多兩行，不是單行截斷（窄螢幕也讀得到完整意思）", () => {
    expect(find(".news-text-item h3").body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(find(".news-text-item h3").body).not.toMatch(/white-space:\s*nowrap/);
  });

  it("沒有資料與載入失敗是虛線狀態框；載入中用同尺寸骨架", () => {
    expect(find(".news-state").body).toMatch(/border:\s*var\(--yy-border-width\) dashed var\(--yy-calm-line\)/);
    expect(find(".news-state__btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find(".news-skeleton__tall").body).toMatch(/min-height:/);
  });
});
