// @vitest-environment node
//
// 步驟 2-3 導覽規則守門：目前頁膠囊、下拉彈簧（有 @supports 後備）、首頁 sticky 玻璃與小字標、減少動態、桌面單行高度。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const nav = read("navigation", "Navbar.css");
const home = read("_home", "index.css");
const mast = read("_home", "masthead.css");

describe("導覽列 2-3", () => {
  it("目前頁用膠囊底（銅色淡階、pill 圓角），仍保留粗體與底線，不只靠顏色", () => {
    expect(nav).toMatch(/\.menu-item\.active\s*\{[^}]*background-color:\s*var\(--yy-calm-tint-copper-2\);[^}]*border-radius:\s*var\(--yy-radius-pill\);/);
    expect(nav).toMatch(/\.menu-item\.active\s*\{[^}]*font-weight:\s*700;/);
    expect(nav).toMatch(/\.menu-item\.active::after\s*\{\s*transform:\s*scaleX\(1\);/);
  });

  it("下拉彈簧：用 --ease-spring 與 --dur-spring，包在 @supports linear() 內；收合維持短時長", () => {
    expect(nav).toMatch(/@supports \(transition-timing-function: linear\(0, 1\)\)\s*\{[\s\S]*transform var\(--dur-spring\) var\(--ease-spring\)/);
    expect(nav).toMatch(/\.dropdown-content\s*\{[\s\S]*?transform var\(--dur-overlay-out\) var\(--ease-out\) 100ms/);
  });

  it("首頁 slot 貼頂：sticky、top 0、滿版、層級在導覽層", () => {
    expect(home).toMatch(/\.homepage > \.home-nav-slot\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*calc\(var\(--yy-z-nav\) - 1\);[^}]*max-width:\s*none;/);
  });

  it("雜誌版玻璃：只在 data-stuck=true 時顯示，模糊放 ::before，並有不支援與 reduced-transparency 的純色降級", () => {
    expect(nav).toMatch(/\.navbar--magazine::before\s*\{[^}]*opacity:\s*0;[^}]*backdrop-filter:/);
    expect(nav).toMatch(/\.navbar--magazine\[data-stuck="true"\]::before\s*\{\s*opacity:\s*1;/);
    expect(nav).toMatch(/@supports not[^{]*\{\s*\.navbar--magazine::before\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
    expect(nav).toMatch(/prefers-reduced-transparency: reduce\)\s*\{[^@]*\.navbar--magazine::before/);
    expect(nav).not.toMatch(/\.navbar--magazine\s*\{[^}]*backdrop-filter/);
  });

  it("小字標：未貼頂 visibility:hidden，貼頂淡入；窄螢幕（漢堡選單）不顯示；字標本身只用 translate／opacity", () => {
    expect(nav).toMatch(/\.navbar--magazine \.logo--mini\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;/);
    expect(nav).toMatch(/\[data-stuck="true"\] \.logo--mini\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;/);
    expect(nav).toMatch(/@media \(max-width: 1200px\)\s*\{\s*\.navbar--magazine \.logo--mini\s*\{\s*display:\s*none;/);
  });

  it("雜誌版玻璃有自己的堆疊層（isolation），::before 不會掉到頁面底色後面", () => {
    expect(nav).toMatch(/\.navbar--magazine\s*\{[^}]*isolation:\s*isolate;/);
  });

  it("左側讓位用 .menu 的 padding-left（佈局自己分配空間，不與右側重疊），不用 translate 位移個別項目", () => {
    expect(nav).toMatch(/\[data-stuck="true"\] \.menu\s*\{\s*padding-left:\s*var\(--mini-logo-w\);/);
    expect(nav).not.toMatch(/\.note-dropdown-wrap\s*\{[^}]*translate:/);
  });

  it("桌面導覽高度不超過 80px：用實際生效的內距與 --yy-control-md 計算（一般頁 12px、首頁雜誌版 2px）", () => {
    const px = (re) => Number(nav.match(re)[1]);
    const generic = px(/\.navbar-container\s*\{[^}]*padding:\s*(\d+)px 56px;/);
    const magazine = px(/\.navbar--magazine \.navbar-container\s*\{\s*padding:\s*(\d+)px 16px;/);
    const theme = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8");
    const control = Number(theme.match(/--yy-control-md:\s*(\d+)px;/)[1]);
    expect(generic * 2 + control + 1.5).toBeLessThanOrEqual(80);
    expect(magazine * 2 + control + 1).toBeLessThanOrEqual(80);
    expect(nav).toMatch(/\.navbar--magazine \.navbar-container\s*\{[^}]*max-width:\s*1200px/);
  });

  it("減少動態：小字標不位移，大字標的縮放淡出由 JS 在減少動態時停寫（CSS 只讀 --mast-p）", () => {
    expect(nav).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*\.navbar--magazine \.logo--mini[^{]*\{[^}]*translate:\s*none;/);
    expect(mast).toMatch(/\.home-mast__name\s*\{[\s\S]*scale:\s*calc\(1 - var\(--mast-p, 0\) \* 0\.12\);[\s\S]*opacity:\s*calc\(1 - var\(--mast-p, 0\) \* 0\.7\);/);
  });
});

describe("手機底部 tab bar 2-4", () => {
  // 取「選擇器 { … }」的內容：用字串找選擇器（前面必須是行首或空白），不必跳脫正規表示式
  const mobileBlock = nav.slice(nav.indexOf("--yy-tabbar-h: calc(60px"));
  const rule = (sel) => {
    let from = 0;
    for (;;) {
      const at = mobileBlock.indexOf(`${sel} {`, from);
      if (at === -1) return "";
      const before = mobileBlock[at - 1];
      if (at === 0 || before === " " || before === "\n") return mobileBlock.slice(mobileBlock.indexOf("{", at) + 1, mobileBlock.indexOf("}", at));
      from = at + 1;
    }
  };

  it("只在 ≤768px 顯示：預設 display:none，固定在底部，高度變數含底部安全區", () => {
    expect(nav).toMatch(/\.yy-tabbar\s*\{\s*display:\s*none;\s*\}/);
    expect(nav).toMatch(/@media \(max-width: 768px\)\s*\{\s*:root\s*\{\s*--yy-tabbar-h:\s*calc\(60px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    const bar = rule(".yy-tabbar");
    expect(bar).toMatch(/position:\s*fixed;/);
    expect(bar).toMatch(/bottom:\s*0;/);
    expect(bar).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom, 0px\);/);
  });

  it("觸控區至少 44px，按壓縮放，焦點環，reduced-motion 停用縮放", () => {
    expect(rule(".yy-tabbar__item")).toMatch(/min-height:\s*44px;/);
    expect(rule(".yy-tabbar__item:active")).toMatch(/transform:\s*scale\(var\(--yy-ui-press\)\);/);
    expect(rule(".yy-tabbar__item:focus-visible")).toMatch(/outline:\s*var\(--yy-ui-focus-ring\);/);
    expect(nav).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*\.yy-tabbar__item:active\s*\{\s*transform:\s*none;/);
  });

  it("目前頁不只靠顏色：粗體加上緣短線；標籤字級不小於 12px", () => {
    expect(rule(".yy-tabbar__item.active")).toMatch(/font-weight:\s*700;/);
    expect(rule(".yy-tabbar__item.active::before")).toMatch(/height:\s*3px;/);
    expect(rule(".yy-tabbar__item")).toMatch(/font-size:\s*var\(--yy-text-xs\);/);
  });

  it("玻璃放 ::before，有 reduced-transparency 與不支援時的純色降級", () => {
    expect(nav).toMatch(/\.yy-tabbar::before\s*\{[^}]*backdrop-filter:/);
    expect(nav).toMatch(/prefers-reduced-transparency: reduce\)\s*\{\s*\.yy-tabbar::before\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
    expect(nav).toMatch(/@supports not[^{]*\{\s*\.yy-tabbar::before\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
  });

  it("置底元素讓位：頁面底部留白、AI 助手與離線橫幅、錯誤提示都吃 --yy-tabbar-h", () => {
    expect(nav).toMatch(/body:has\(\.yy-tabbar\)\s*\{[^}]*padding-bottom:\s*var\(--yy-tabbar-h\);[^}]*--bot-bottom:\s*calc\(var\(--yy-tabbar-h\) \+ 16px\);/);
    expect(nav).toMatch(/body:has\(\.yy-tabbar\) \.offline-banner\s*\{\s*bottom:\s*calc\(var\(--yy-tabbar-h\) \+ 12px\);/);
    expect(readFileSync(join(ROOT, "..", "..", "src", "AppShell.jsx"), "utf8")).toContain("var(--bot-bottom, 24px)");
  });

  it("手機寬度：漢堡鈕隱藏，面板變成貼在 tab bar 上方的底部面板（可捲動、不超過 70dvh）", () => {
    expect(nav).toMatch(/@media \(max-width: 768px\)[\s\S]*\.menu-toggle\s*\{\s*display:\s*none;/);
    const panel = rule(".menu-mobile");
    expect(panel).toMatch(/position:\s*fixed;/);
    expect(panel).toMatch(/bottom:\s*var\(--yy-tabbar-h\);/);
    expect(panel).toMatch(/max-height:\s*70dvh;/);
    expect(panel).toMatch(/overflow-y:\s*auto;/);
  });
});
