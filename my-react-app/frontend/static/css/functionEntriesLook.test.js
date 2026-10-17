// @vitest-environment node
//
// S7-2 守門：功能入口、五族語言列與主打卡片、行事曆（DateReminder）的樣式。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(ROOT, "_home", name), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

const parse = (source) => {
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of source) {
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

const OLD_TOKENS = /--yy-(?:red|gold|blue|blue-light|cream|ink|green|border-soft|text-muted|text-tertiary|text-secondary|radius-card|radius-btn|surface|font-pixel)\b/;
const NO_DECORATION = /box-shadow|text-shadow|linear-gradient|repeating-conic-gradient|@keyframes|animation\s*:|transition:\s*all|ease-in(?![\w-])/;

const funcCss = read("functionBtn.css");
const func = parse(funcCss);
const findFunc = finder(func);
const indexCss = read("index.css");
const indexRules = parse(indexCss);
const findIdx = finder(indexRules);
const reminderCss = read("dateReminder.css");
const reminder = parse(reminderCss);
const findRem = finder(reminder);

// 只看 index.css 裡「五族語言 + 現正主打」那一段
const tribeSection = indexCss.slice(indexCss.indexOf(".home-tribes-section"), indexCss.indexOf(".home-first {"));

describe("功能入口樣式", () => {
  it("沒有舊風格 token、寫死色碼、陰影、漸層、動畫", () => {
    expect(funcCss).not.toMatch(OLD_TOKENS);
    expect(funcCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(funcCss).not.toMatch(NO_DECORATION);
  });

  it("每個入口頂端一條細線，不是有框的卡片；標題下雙線", () => {
    expect(findFunc(".home-func-card").body).toMatch(/border-top:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(findFunc(".home-func-card").body).not.toMatch(/(?:^|[\s;])border:/);
    expect(findFunc(".function-section-header").body).toMatch(/border-bottom:\s*3px double var\(--yy-calm-line\)/);
  });

  it("單字標記與「前往體驗」至少 44px 高", () => {
    expect(findFunc(".card-letter").body).toMatch(/height:\s*var\(--yy-control-md\)/);
    expect(findFunc(".card-cta").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("手機一欄、720px 兩欄、1100px 四欄", () => {
    expect(findFunc(".card-container").body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(findFunc(".card-container", /min-width:\s*720px/).body).toMatch(/repeat\(2,/);
    expect(findFunc(".card-container", /min-width:\s*1100px/).body).toMatch(/repeat\(4,/);
  });

  it("按下縮放回饋、焦點框、hover 只給有滑鼠的裝置、減少動態不縮放", () => {
    expect(findFunc(".home-func-card:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(findFunc(".home-func-card:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    func.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
    expect(findFunc(".home-func-card:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });
});

describe("五族語言列與現正主打", () => {
  it("沒有舊風格 token、陰影、漸層、拼色圖樣、動畫", () => {
    expect(tribeSection).not.toMatch(OLD_TOKENS);
    expect(tribeSection).not.toMatch(NO_DECORATION);
    expect(tribeSection).not.toMatch(/rgba?\(/);
  });

  it("每一列至少 44px 高，選取狀態用 aria-pressed 畫，按下縮放，焦點框清楚", () => {
    expect(findIdx(".home-tribe-row").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(findIdx('.home-tribe-row[aria-pressed="true"]').body).toMatch(/border-color:\s*var\(--yy-calm-line\)/);
    expect(findIdx(".home-tribe-row:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(findIdx(".home-tribe-row:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("hover 只給有滑鼠的裝置；減少動態不縮放", () => {
    indexRules.filter((r) => /home-tribe-row:hover|home-feature-card:hover/.test(r.selector)).forEach((r) => {
      expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
    });
    const reduced = indexRules.find((r) => r.atRules.some((a) => /prefers-reduced-motion/.test(a)) && r.selector.includes(".home-tribe-row:active"));
    expect(reduced.body).toMatch(/transform:\s*none/);
  });

  it("主打卡片：細框、小圓角、沒有漸層頭，只有連結時才有按下回饋", () => {
    expect(findIdx(".home-feature-card").body).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(findIdx(".home-feature-card").body).toMatch(/border-radius:\s*var\(--yy-ui-radius\)/);
    expect(findIdx("a.home-feature-card:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(findIdx(".home-feature-image").body).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
  });
});

describe("行事曆（DateReminder）樣式", () => {
  it("沒有舊風格 token、陰影、動畫，沒有用透明度壓低文字", () => {
    expect(reminderCss).not.toMatch(OLD_TOKENS);
    expect(reminderCss).not.toMatch(NO_DECORATION);
    expect(reminderCss).not.toMatch(/opacity\s*:/);
  });

  it("沒有裝飾圓形；倒數數字仍用等寬數字", () => {
    expect(reminderCss).not.toMatch(/\.circle\b/);
    expect(findRem(".countdown-box").body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("目前進行中的時程用深色細框標出，已過的只換文字色", () => {
    expect(findRem(".schedule-item.current").body).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(findRem(".schedule-item.past").body).toMatch(/color:\s*var\(--yy-calm-text-sub\)/);
  });

  it("字級不低於 14px（0.875rem）", () => {
    expect(reminderCss).not.toMatch(/font-size:\s*0\.(?:[0-7]\d*|8[0-6]\d*)rem/);
    expect(reminderCss).not.toMatch(/font-size:\s*(?:\d|1[0-3])px/);
  });
});
