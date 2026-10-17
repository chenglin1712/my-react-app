// @vitest-environment node
//
// S6-3 守門：首頁最新消息的樣式。
// 顏色走語意層、控制項 44px、說明文字不蓋在照片上、hover 只給有滑鼠的裝置、
// 手機改單欄、減少動態只換顏色，輪播箭頭的規則限縮在 .news-carousel（不影響站內其他輪播）。
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
  it("沒有寫死色碼、沒有舊風格色 token、沒有陰影、沒有漸層遮罩", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/--yy-(?:red|gold|gold-light|blue|cream|ink|green|border-soft|text-muted|text-secondary|radius-card|radius-lg|radius-btn)\b/);
    expect(css).not.toMatch(/box-shadow|text-shadow|linear-gradient/);
  });

  it("沒有動畫，沒有 transition: all，沒有 ease-in", () => {
    expect(css).not.toMatch(/@keyframes|animation\s*:/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/ease-in(?![\w-])/);
  });

  it("說明文字在照片下方的石板灰區塊，不是 absolute 蓋在圖上", () => {
    const info = find(".news-slide-info").body;
    expect(info).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(info).toMatch(/color:\s*var\(--yy-calm-block-on\)/);
    expect(info).not.toMatch(/position:\s*absolute/);
    expect(find(".news-slide-date").body).toMatch(/var\(--yy-calm-block-accent\)/);
  });

  it("輪播圖固定 16:10，換張時版面不跳動", () => {
    expect(find(".news-slide img").body).toMatch(/aspect-ratio:\s*16\s*\/\s*10/);
    expect(find(".news-slide-info").body).toMatch(/min-height:/);
  });

  it("暫停鈕與左右箭頭至少 44px；箭頭規則限縮在 .news-carousel", () => {
    expect(find(".news-autoplay-toggle").body).toMatch(/width:\s*var\(--yy-control-md\)/);
    expect(find(".news-autoplay-toggle").body).toMatch(/height:\s*var\(--yy-control-md\)/);
    const arrows = find(".news-carousel .swiper-button-prev, .news-carousel .swiper-button-next");
    expect(arrows.body).toMatch(/width:\s*var\(--yy-control-md\)/);
    expect(arrows.body).toMatch(/height:\s*var\(--yy-control-md\)/);
    rules.filter((r) => /swiper-button/.test(r.selector)).forEach((r) => {
      r.selector.split(",").filter((s) => /swiper-button/.test(s)).forEach((s) => expect(s.trim().startsWith(".news-carousel"), s).toBe(true));
    });
  });

  it("箭頭取消垂直置中的規則要壓過 Swiper 的 .swiper-horizontal 規則（多一層 .swiper）", () => {
    const place = find(".news-carousel.swiper .swiper-button-prev, .news-carousel.swiper .swiper-button-next");
    expect(place.body).toMatch(/top:\s*auto/);
    expect(place.body).toMatch(/bottom:\s*var\(--yy-space-2\)/);
    expect(place.body).toMatch(/margin-top:\s*0/);
    expect(find(".news-carousel.swiper .swiper-button-prev").body).toMatch(/right:\s*calc\(/);
    expect(find(".news-carousel.swiper .swiper-button-next").body).toMatch(/right:\s*var\(--yy-space-2\)/);
    // 位置屬性不能放在低優先序的規則裡，否則會被 Swiper 蓋掉
    expect(find(".news-carousel .swiper-button-prev, .news-carousel .swiper-button-next").body).not.toMatch(/(?:^|[\s;])(?:top|bottom|left|right|margin-top):/);
  });

  it("可按的元件按下有縮放回饋、有焦點框；減少動態時不縮放", () => {
    ["a.news-card:active", ".news-autoplay-toggle:active"].forEach((s) => expect(find(s).body, s).toMatch(/scale\(var\(--yy-ui-press\)\)/));
    expect(find(".news-autoplay-toggle:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find("a.news-card:focus-visible, a.news-text-item:focus-visible, .news-slide-info a:focus-visible").body).toMatch(/outline-offset:\s*var\(--yy-ui-focus-offset\)/);
    const reduced = rules.find((r) => r.atRules.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)) && r.selector.includes("a.news-card:active"));
    expect(reduced.body).toMatch(/transform:\s*none/);
    // 位移型 hover 只在「有滑鼠且沒有要求減少動態」時才有
    const lift = rules.find((r) => r.selector === "a.news-card:hover" && /translateY/.test(r.body));
    expect(lift.atRules.join(" ")).toMatch(/prefers-reduced-motion:\s*no-preference/);
  });

  it("hover 只給有滑鼠的裝置", () => {
    const hovers = rules.filter((r) => /:hover/.test(r.selector) && !r.atRules.some((a) => /prefers-reduced-motion/.test(a)));
    expect(hovers.length).toBeGreaterThan(0);
    hovers.forEach((r) => expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true));
  });

  it("標籤只有一個顏色，不再依文字換色", () => {
    expect(css).not.toMatch(/data-tag/);
    expect(find(".news-tag").body).toMatch(/background:\s*var\(--yy-calm-tag\)/);
    expect(find(".news-tag").body).toMatch(/color:\s*var\(--yy-calm-tag-on\)/);
  });

  it("字級至少 14px（沒有 rem 小數寫死的小字）", () => {
    expect(css).not.toMatch(/font-size:\s*0\.\d+rem/);
  });

  it("標題下雙線；列表只有列與列之間一條細線", () => {
    expect(find(".news-section-header").body).toMatch(/border-bottom:\s*3px double var\(--yy-calm-line\)/);
    expect(find(".text-list li + li").body).toMatch(/border-top:\s*1px solid var\(--yy-calm-rule\)/);
    expect(find(".news-text-item").body).not.toMatch(/border-bottom/);
  });

  it("手機：900px 以下輪播與列表上下排，600px 以下卡片單欄、列表日期換到標題上方", () => {
    expect(find(".event-container", /max-width:\s*900px/).body).toMatch(/flex-direction:\s*column/);
    expect(find(".news-card-grid", /max-width:\s*600px/).body).toMatch(/grid-template-columns:\s*1fr/);
    expect(find(".news-text-item", /max-width:\s*600px/).body).toMatch(/flex-direction:\s*column/);
  });

  it("列表標題最多兩行，不是單行截斷（手機也讀得到完整意思）", () => {
    expect(find(".news-text-item h3").body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(find(".news-text-item h3").body).not.toMatch(/white-space:\s*nowrap/);
  });
});
