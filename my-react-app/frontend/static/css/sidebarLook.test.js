// @vitest-environment node
//
// 個人資料側欄（毛玻璃面板）的外觀守門：材質、配色、觸控區與動態。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const sidebarCss = strip(read("navigation/userSidebar.css"));
const navbarCss = strip(read("navigation/Navbar.css"));
const navbarJsx = read("../../components/navigation/navbar.jsx");

const rulesOf = (css) => {
  const out = [];
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") { stack.push(buf.trim()); buf = ""; }
    else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) out.push({ selector: prelude.replace(/\s+/g, " "), body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      buf = "";
    } else buf += ch;
  }
  return out;
};
const sidebarRules = rulesOf(sidebarCss);
const navbarRules = rulesOf(navbarCss);
const find = (rules, selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

describe("個人資料側欄：毛玻璃材質", () => {
  it("側欄元素掛 yy-glass（背景、模糊、降級純色與焦點光暈都由它提供）", () => {
    expect(navbarJsx).toMatch(/className=\{`sidebar yy-glass /);
  });

  it(".sidebar 不自己鋪實色底，只用高度 4 的陰影（有細框就不加 edge）", () => {
    const rule = find(navbarRules, ".sidebar");
    expect(rule.body).not.toMatch(/background(-color)?:/);
    expect(rule.body).toMatch(/box-shadow:\s*var\(--yy-elev-4\)\s*;/);
    expect(rule.body).not.toMatch(/--yy-edge-4/);
  });

  it("貼右邊，只畫左邊的框；標題列不鋪實色底（不擋住玻璃）", () => {
    expect(find(navbarRules, ".sidebar.yy-glass").body).toMatch(/border-width:\s*0 0 0 1px/);
    expect(find(navbarRules, ".sidebar-header").body).not.toMatch(/background/);
  });
});

describe("個人資料側欄：配色只用沉穩文藝 token", () => {
  it("沒有舊 Y2K 的紅、米色、墨色 token，也沒有寫死色碼或 white", () => {
    expect(sidebarCss).not.toMatch(/--yy-(red|red-dark|cream|cream-dim|ink|surface|text-tertiary|text-muted|text-secondary|border-soft)\b/);
    expect(sidebarCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sidebarCss).not.toMatch(/\bwhite\b/);
  });

  it("沒有舊的『選項右側 4px 紅線』與整塊色底的頭部", () => {
    expect(sidebarCss).not.toMatch(/border-right:\s*4px/);
    expect(find(sidebarRules, ".sidebar-profile").body).not.toMatch(/background/);
  });

  it("文字只用 --yy-calm-text／--yy-calm-text-sub（最壞底圖下仍達 4.5:1）", () => {
    const colors = [...sidebarCss.matchAll(/(?<![-\w])color:\s*([^;]+);/g)].map((m) => m[1].trim());
    // danger 只給圖示（.sidebar-signout-error svg），錯誤文字本身用 --yy-calm-text
    const allowed = new Set([
      "var(--yy-calm-text)", "var(--yy-calm-text-sub)", "var(--yy-calm-accent)", "var(--yy-calm-tag-on)",
      "var(--yy-calm-danger)", "currentColor",
    ]);
    expect(find(sidebarRules, ".sidebar-signout-error").body).toMatch(/color:\s*var\(--yy-calm-text\)/);
    colors.forEach((c) => expect(allowed.has(c), `不在允許清單的文字色：${c}`).toBe(true));
  });
});

describe("個人資料側欄：互動", () => {
  it("所有 :hover 都在 (hover: hover) and (pointer: fine) 裡", () => {
    sidebarRules.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
  });

  it("按鈕按下縮到 0.97，只過渡會變的屬性（沒有 transition: all），減少動態時不縮放", () => {
    expect(find(sidebarRules, ".profile-btn:active").body).toMatch(/transform:\s*scale\(0\.97\)/);
    expect(sidebarCss).not.toMatch(/transition:\s*all/);
    expect(find(sidebarRules, ".profile-btn:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("選項列至少 44px 高，登出／編輯按鈕用 ::after 擴成 44px 點擊區", () => {
    expect(find(sidebarRules, ".nav-button").body).toMatch(/min-height:\s*(5[2-9]|[6-9]\d)px/);
    expect(find(sidebarRules, ".profile-btn::after").body).toMatch(/width:\s*max\(100%,\s*var\(--yy-control-md\)\)/);
  });

  it("分隔線畫在偽元素上（懸停的圓角底色不會把線彎掉），最後一列不畫", () => {
    expect(find(sidebarRules, ".nav-button::after").body).toMatch(/height:\s*1px/);
    expect(find(sidebarRules, ".nav-button:last-child::after").body).toMatch(/display:\s*none/);
  });
});

describe("個人資料側欄：減少動態與按壓回饋", () => {
  it("減少動態時側欄不位移（transform: none），改成原地淡入淡出", () => {
    const closed = find(navbarRules, ".sidebar", /prefers-reduced-motion/);
    const open = find(navbarRules, ".sidebar.open", /prefers-reduced-motion/);
    expect(closed.body).toMatch(/transform:\s*none/);
    expect(closed.body).toMatch(/opacity:\s*0/);
    expect(open.body).toMatch(/opacity:\s*1/);
    expect(closed.body).toMatch(/visibility 0s linear/); // 收起時等淡出結束才隱藏，Tab 仍進不去
  });

  it("關閉鈕按下有回饋（縮到 0.95），減少動態時不縮放", () => {
    expect(find(navbarRules, ".sidebar-header .close-btn:active").body).toMatch(/transform:\s*scale\(0\.95\)/);
    expect(find(navbarRules, ".sidebar-header .close-btn:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("編輯資料與登出本身就是 44px 高（兩顆相距 8px，不靠偽元素硬撐）", () => {
    expect(find(sidebarRules, ".profile-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });
});

describe("個人資料側欄：字級用 rem", () => {
  it("沒有 px 字級", () => {
    expect(sidebarCss).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});
