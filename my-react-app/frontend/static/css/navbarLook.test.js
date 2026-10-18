// @vitest-environment node
//
// S5-1 導覽列新外觀守門：導覽列顏色走 --yy-calm-* 語意層（S5-3 深色主題才會自動跟著換）、
// 可按元件至少 44px、hover 只給有滑鼠的裝置、有減少動態的處理。
// 導覽下方的織紋細條（.navbar-marquee）在 S5-2 換成沉穩色，整份檔案不再有舊風格色 token。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(ROOT, "navigation", "Navbar.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

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
      if (prelude !== undefined && !prelude.startsWith("@")) {
        rules.push({ selector: prelude, body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      }
      buf = "";
    } else {
      buf += ch;
    }
  }
  return rules;
};
const rules = walkRules(css);
const find = (selector) => rules.filter((r) => r.selector === selector);

describe("導覽列新外觀（S5-1）", () => {
  it("沒有寫死的色碼，也沒有舊風格色 token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const old = /--yy-(?:red|gold|blue|cream|ink|green)\b/;
    expect(rules.filter((r) => old.test(r.body)).map((r) => r.selector)).toEqual([]);
  });

  it("導覽下方沒有織紋彩條（與首頁雜誌版一致）", () => {
    expect(css).not.toMatch(/navbar-marquee/);
  });

  it("導覽列是區塊、手機選單撐滿寬度（Bootstrap 的 .navbar 預設 flex 會讓選單縮在一角）", () => {
    expect(find(".navbar")[0].body).toMatch(/display:\s*block/);
    expect(find(".menu-mobile")[0].body).toMatch(/width:\s*100%/);
  });

  it("導覽列底色、文字、細線都取沉穩色", () => {
    const body = find(".navbar")[0].body;
    expect(body).toMatch(/background-color:\s*var\(--yy-calm-bg\)/);
    expect(body).toMatch(/color:\s*var\(--yy-calm-text\)/);
    expect(body).toMatch(/border-bottom:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
  });

  it("選單項目、下拉項目、手機項目、漢堡鈕的觸控區至少 44px", () => {
    [".menu-item", ".dropdown-item", ".menu-mobile-item", ".mobile-container-user", ".auth-container-user", ".menu-toggle", ".logo"].forEach((selector) => {
      expect(find(selector)[0].body, selector).toMatch(/min-height:\s*var\(--yy-control-(?:md|lg)\)/);
    });
    expect(find(".menu-toggle")[0].body).toMatch(/min-width:\s*var\(--yy-control-md\)/);
  });

  it("所有 :hover 規則都在 (hover: hover) and (pointer: fine) 裡，觸控裝置不會卡在 hover", () => {
    const hovers = rules.filter((r) => /:hover/.test(r.selector));
    expect(hovers.length).toBeGreaterThan(0);
    const bare = hovers.filter((r) => !r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)));
    expect(bare.map((r) => r.selector)).toEqual([]);
  });

  it("可按元件有按下回饋與 2px 以上的焦點外框", () => {
    expect(rules.filter((r) => /:active$/.test(r.selector) && /scale\(var\(--yy-ui-press\)\)/.test(r.body)).length).toBeGreaterThanOrEqual(5);
    const focus = rules.find((r) => r.selector.includes(".menu-item:focus-visible"));
    expect(focus.body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(focus.body).toMatch(/outline-offset:\s*var\(--yy-ui-focus-offset\)/);
  });

  it("目前頁用文字加底線標示，不只靠顏色", () => {
    expect(find(".menu-item.active::after")[0].body).toMatch(/scaleX\(1\)/);
    expect(find(".menu-mobile-item.active")[0].body).toMatch(/inset 3px 0 0/);
  });

  it("手機選單用 opacity／transform 過渡，展開比收合久，並有進場起點", () => {
    expect(find(".menu-mobile")[0].body).toMatch(/opacity:\s*0/);
    expect(find(".menu-mobile")[0].body).toMatch(/transition:[^;]*opacity 120ms[^;]*transform 120ms/);
    expect(find(".menu-mobile.active")[0].body).toMatch(/transition:[^;]*opacity 160ms[^;]*transform 160ms/);
    expect(css).toMatch(/@starting-style\s*\{\s*\.menu-mobile\.active\s*\{[^}]*opacity:\s*0/);
  });

  it("手機選單收合動畫期間先不隱藏之外，visibility 要等退場結束才切換（透明的連結不能被 Tab 聚焦）", () => {
    expect(find(".menu-mobile")[0].body).toMatch(/visibility:\s*hidden/);
    expect(find(".menu-mobile")[0].body).toMatch(/visibility 0s linear 120ms/);
    expect(find(".menu-mobile.active")[0].body).toMatch(/visibility:\s*visible/);
  });

  it("減少動態時不位移、不縮放", () => {
    const reduced = rules.filter((r) => r.atRules.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)));
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.find((r) => r.selector.includes(".menu-item:active")).body).toMatch(/transform:\s*none/);
    expect(reduced.find((r) => r.selector.startsWith(".menu-mobile,")).body).toMatch(/transform:\s*none/);
  });

  it("視窗拉寬到桌面導覽列時，不會同時留著手機選單", () => {
    const wide = rules.find((r) => r.selector === ".menu-mobile.active" && r.atRules.some((a) => /min-width:\s*1201px/.test(a)));
    expect(wide.body).toMatch(/display:\s*none/);
  });
});
