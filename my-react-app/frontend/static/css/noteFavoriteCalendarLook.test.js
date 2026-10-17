// @vitest-environment node
//
// S8-3 守門：筆記、收藏、行事曆所有樣式檔。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(ROOT, name), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

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

const OLD_TOKENS = /--yy-(?:red|gold|gold-light|gold-mark|blue|blue-light|cream|cream-dim|ink|green|border|border-soft|text-muted|text-tertiary|text-secondary|radius-card|radius-btn|radius-lg|surface|font-pixel|warning-bg|warning-text|red-dark|success|success-bg|success-border|danger|danger-bg|danger-border|info-bg)(?![\w-])/;
const NO_DECORATION = /box-shadow\s*:\s*(?!none)\S|text-shadow|gradient|backdrop-filter|rgba?\(|transition:\s*all|ease-in(?![\w-])|#[0-9a-fA-F]{3,8}\b|(?<![-\w])color:\s*(?:white|black)\b|background(?:-color)?:\s*(?:white|black)\b/;

const FILES = ["_note", "_favorite", "_calendar"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".css")).map((f) => `${d}/${f}`));
const css = Object.fromEntries(FILES.map((f) => [f, strip(read(f))]));
const rules = Object.fromEntries(FILES.map((f) => [f, parse(css[f])]));
const find = (file) => finder(rules[file]);

describe("筆記、收藏、行事曆：所有樣式檔", () => {
  it("有找到檔案", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(7);
  });

  it.each(FILES)("%s：沒有舊風格 token、寫死色碼、陰影、漸層、模糊、transition: all", (f) => {
    expect(css[f]).not.toMatch(OLD_TOKENS);
    expect(css[f]).not.toMatch(NO_DECORATION);
  });

  it.each(FILES)("%s：沒有 transition 簡寫只給時間（等同 all）", (f) => {
    expect(css[f]).not.toMatch(/transition:\s*[\d.]+m?s\s*;/);
  });

  it.each(FILES)("%s：hover 只給有滑鼠的裝置", (f) => {
    rules[f]
      .filter((r) => /:hover/.test(r.selector))
      .forEach((r) => {
        expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), `${f} ${r.selector}`).toBe(true);
      });
  });

  it.each(FILES)("%s：字級不低於 14px", (f) => {
    const sizes = [...css[f].matchAll(/font-size:\s*([\d.]+)(px|rem)\b/g)].map((m) => (m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1])));
    sizes.forEach((px) => expect(px).toBeGreaterThanOrEqual(14));
  });
});

describe("筆記", () => {
  it("標題輸入框改用焦點框，不再靠陰影", () => {
    const f = find("_note/notestyle.css");
    expect(f(".note-title").body).not.toMatch(/outline:\s*none/);
    expect(f(".note-title:focus").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("筆記頁按鈕至少 44px 高、按下縮放，減少動態不縮放", () => {
    const f = find("_note/buttons.css");
    expect(f(".note-page button, .note-page .btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f(".note-page button:active, .note-page .btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(f(".note-page button:active, .note-page .btn:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("危險按鈕不再寫死 gray", () => {
    expect(css["_note/buttons.css"]).not.toMatch(/background:\s*gray/);
  });

  it("文字顏色色票選中時用外框環，不用陰影；底部工具列用雙線頂框", () => {
    expect(find("_note/toolbar.css")('.editor-toolbar .color-box[aria-pressed="true"]::before').body).toMatch(/outline:\s*2px solid/);
    expect(find("_note/toolbar.css")(".bottom-toolbar").body).toMatch(/border-top:\s*3px double var\(--yy-calm-line\)/);
  });

  it("分享區：卡片扁平、分頁籤與按鈕至少 44px、目前分頁有勾", () => {
    const f = find("_note/notesharestyle.css");
    expect(f(".ns-card").body).toMatch(/border-radius:var\(--yy-ui-radius\)/);
    expect(f(".ns-tab").body).toMatch(/min-height:var\(--yy-control-md\)/);
    expect(f(".ns-btn").body).toMatch(/min-height:var\(--yy-control-md\)/);
    expect(f(".ns-page-btn").body).toMatch(/min-height:var\(--yy-control-md\)/);
    expect(f(".ns-tab.active::before").body).toMatch(/content:\s*"\\2713"/);
  });

  it("彈窗遮罩用主題色混色；提示訊息減少動態時不動", () => {
    expect(find("_note/notesharestyle.css")(".ns-modal-mask").body).toMatch(/color-mix\(in srgb, var\(--yy-calm-block\)/);
    expect(find("_note/notesharestyle.css")(".ns-toast", /prefers-reduced-motion/).body).toMatch(/animation:\s*none/);
  });
});

describe("收藏", () => {
  it("收藏頁範圍內拿掉頁首拼色圖樣；字卡有細框", () => {
    const f = find("_favorite/index.css");
    expect(f(".favorite-hero.yy-hero::before").body).toMatch(/display:\s*none/);
    expect(f(".word-card-front, .word-card-back").body).toMatch(/border:\s*1px solid var\(--yy-calm-rule\)/);
  });

  it("翻牌減少動態時不轉場", () => {
    expect(find("_favorite/index.css")(".word-card", /prefers-reduced-motion/).body).toMatch(/transition:\s*none/);
  });
});

describe("行事曆", () => {
  it("今天的日期除了底色還有底線", () => {
    expect(find("_calendar/calendar_date.css")(".react-calendar__tile--now").body).toMatch(/text-decoration:\s*underline/);
  });

  it("輸入框、按鈕、刪除鈕至少 44px；輸入框畫焦點框", () => {
    const f = find("_calendar/calendar_date.css");
    expect(f(".event-input-bar input").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f(".event-input-bar button").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f(".event-card .delete-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f(".go-quiz-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f(".event-input-bar input:focus").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("按下縮放，減少動態不縮放", () => {
    const sel = ".go-quiz-btn:active, .event-input-bar button:active, .event-card .delete-btn:active";
    expect(find("_calendar/calendar_date.css")(sel).body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find("_calendar/calendar_date.css")(sel, /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });
});
