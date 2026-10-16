// @vitest-environment node
//
// S5-3 守門：顯示設定選單的樣式（44px、hover 只給滑鼠、減少動態、不寫死色碼）、
// 切換時暫停過渡的規則，以及 index.html 防閃白小腳本的行為與位置。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const navCss = strip(read("navigation", "Navbar.css"));
const themeCss = strip(read("default", "theme-v2.css"));
const html = read("..", "..", "..", "index.html");

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
const navRules = walkRules(navCss);
const find = (selector) => navRules.find((r) => r.selector === selector && r.atRules.length === 0);
const themeRules = navRules.filter((r) => /\.theme-/.test(r.selector));

describe("顯示設定選單樣式（S5-3）", () => {
  it("沒有寫死色碼、沒有舊風格色 token", () => {
    themeRules.forEach((r) => {
      expect(r.body, r.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(r.body, r.selector).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green)\b/);
    });
  });

  it("按鈕與每個選項的觸控區至少 44px", () => {
    expect(find(".theme-trigger").body).toMatch(/min-width:\s*var\(--yy-control-md\)/);
    expect(find(".theme-option").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("面板從按鈕右上角長出來，展開 160ms、收合 120ms，visibility 等退場結束才切換", () => {
    const closed = find(".theme-panel").body;
    expect(closed).toMatch(/transform-origin:\s*top right/);
    expect(closed).toMatch(/opacity:\s*0/);
    expect(closed).toMatch(/visibility:\s*hidden/);
    expect(closed).toMatch(/opacity 120ms[^;]*transform 120ms[^;]*visibility 0s linear 120ms/);
    const open = find(".theme-panel.active").body;
    expect(open).toMatch(/opacity 160ms[^;]*transform 160ms[^;]*visibility 0s linear 0s/);
    expect(closed).not.toMatch(/scale\(0\)|ease-in\b|transition:\s*all/);
  });

  it("所有 :hover 都在 (hover: hover) and (pointer: fine) 裡", () => {
    const hovers = themeRules.filter((r) => /:hover/.test(r.selector));
    expect(hovers.length).toBeGreaterThan(0);
    hovers.forEach((r) => expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true));
  });

  it("鍵盤焦點有 2px 以上外框，收在面板裡所以往內縮", () => {
    const focus = find(".theme-option:has(input:focus-visible)").body;
    expect(focus).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(focus).toMatch(/outline-offset:\s*-/);
  });

  it("fieldset 與 legend 重設（Safari、Firefox 的窄容器不會被撐開）", () => {
    expect(find(".theme-group").body).toMatch(/min-width:\s*0/);
    expect(find(".theme-group").body).toMatch(/border:\s*0/);
    expect(find(".theme-group__title").body).toMatch(/float:\s*none/);
  });

  it("減少動態時面板不位移不縮放", () => {
    const reduced = navRules.find((r) => r.atRules.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)) && r.selector.includes(".theme-panel"));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("手機抽屜版有分隔線、比桌面版大一級", () => {
    expect(find(".theme-group--mobile").body).toMatch(/border-top:\s*var\(--yy-border-width\) solid var\(--yy-calm-rule\)/);
    expect(find(".theme-group--mobile .theme-option").body).toMatch(/min-height:\s*var\(--yy-control-lg\)/);
  });
});

describe("切換時不做整頁顏色過渡", () => {
  it("data-theme-switching 時全部元件（含偽元素）的過渡關掉，每一段選擇器都有前綴", () => {
    const rule = walkRules(themeCss).find((r) => r.selector.startsWith(":root[data-theme-switching]"));
    const parts = rule.selector.split(",").map((s) => s.trim());
    expect(parts).toEqual([":root[data-theme-switching] *", ":root[data-theme-switching] *::before", ":root[data-theme-switching] *::after"]);
    expect(rule.body).toMatch(/transition:\s*none\s*!important/);
  });

  it("根元素與 body 本身沒有顏色過渡", () => {
    walkRules(themeCss)
      .filter((r) => /^(:root|html|body|\*)(\[[^\]]*\])?$/.test(r.selector) && !r.selector.includes("switching"))
      .forEach((r) => expect(r.body, r.selector).not.toMatch(/(?:^|[;\s])transition(?:-[a-z]+)?\s*:/));
  });
});

describe("index.html 防閃白小腳本", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const code = scripts[0]?.[1] ?? "";

  const run = ({ flag, stored, throws = false }) => {
    const attrs = {};
    const fakeWindow = {
      localStorage: {
        getItem: () => {
          if (throws) throw new Error("blocked");
          return stored;
        },
      },
    };
    const fakeDocument = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
    new Function("window", "document", code.replace("%VITE_ENABLE_DARK_THEME%", flag))(fakeWindow, fakeDocument);
    return attrs["data-theme"];
  };

  it("放在 <head> 裡、任何樣式表與字型連結之前", () => {
    expect(scripts.length).toBeGreaterThan(0);
    const at = html.indexOf("<script>");
    expect(at).toBeGreaterThan(html.indexOf("<head>"));
    expect(at).toBeLessThan(html.indexOf("</head>"));
    const firstStyle = Math.min(...["<style", 'rel="stylesheet"'].map((s) => html.indexOf(s)).filter((i) => i >= 0));
    expect(at).toBeLessThan(firstStyle);
  });

  it("旗標沒開（沒設、字面未取代、其他值）一律淺色，儲存值被忽略", () => {
    ["%VITE_ENABLE_DARK_THEME%", "", "false", "1"].forEach((flag) => {
      expect(run({ flag, stored: "dark" }), flag).toBe("light");
    });
  });

  it("旗標開：只認 dark、system，其餘（含損壞值、空值）淺色", () => {
    expect(run({ flag: "true", stored: "dark" })).toBe("dark");
    expect(run({ flag: "true", stored: "system" })).toBe("system");
    expect(run({ flag: "true", stored: "light" })).toBe("light");
    [null, "", "DARK", "{x", "auto"].forEach((stored) => expect(run({ flag: "true", stored }), String(stored)).toBe("light"));
  });

  it("讀取儲存空間丟例外時淺色", () => {
    expect(run({ flag: "true", stored: "dark", throws: true })).toBe("light");
  });

  it("儲存鍵與 themeStore 一致", () => {
    expect(code).toContain('"yy-theme"');
    expect(readFileSync(join(ROOT, "..", "..", "src", "theme", "themeStore.js"), "utf8")).toContain('"yy-theme"');
  });
});
