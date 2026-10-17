// @vitest-environment node
//
// S9-1 守門：後台（_admin）與後台登入頁（_auth/adminLogin.css）所有樣式檔。
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
const NO_DECORATION = /box-shadow\s*:\s*(?!none)\S|text-shadow|gradient|rgba?\(|transition:\s*all|ease-in(?![\w-])|#[0-9a-fA-F]{3,8}\b|(?<![-\w])color:\s*(?:white|black)\b|background(?:-color)?:\s*(?:white|black)\b/;

const FILES = [
  ...readdirSync(join(ROOT, "_admin")).filter((f) => f.endsWith(".css")).map((f) => `_admin/${f}`),
  "_auth/adminLogin.css",
];
const css = Object.fromEntries(FILES.map((f) => [f, strip(read(f))]));
const rules = Object.fromEntries(FILES.map((f) => [f, parse(css[f])]));
const find = (file) => finder(rules[file]);
const pxSizes = (f) => [...css[f].matchAll(/font-size:\s*([\d.]+)(px|rem)\b/g)].map((m) => (m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1])));

describe("後台：所有樣式檔", () => {
  it("有找到檔案", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(19);
  });

  it.each(FILES)("%s：沒有舊風格 token、寫死色碼、陰影、漸層、transition: all", (f) => {
    expect(css[f]).not.toMatch(OLD_TOKENS);
    expect(css[f]).not.toMatch(NO_DECORATION);
  });

  it.each(FILES)("%s：hover 只給有滑鼠的裝置", (f) => {
    rules[f]
      .filter((r) => /:hover/.test(r.selector))
      .forEach((r) => {
        expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), `${f} ${r.selector}`).toBe(true);
      });
  });

  it.each(FILES)("%s：不拿掉焦點框（沒有 outline: none）", (f) => {
    expect(css[f]).not.toMatch(/outline\s*:\s*(?:none|0)\b/);
  });

  it.each(FILES.filter((f) => f.startsWith("_admin/")))("%s：密集表格字級不低於 12px", (f) => {
    pxSizes(f).forEach((px) => expect(px).toBeGreaterThanOrEqual(12));
  });

  it("後台登入頁字級不低於 14px", () => {
    pxSizes("_auth/adminLogin.css").forEach((px) => expect(px).toBeGreaterThanOrEqual(14));
  });
});

describe("後台外殼", () => {
  it("設計變數取自沉穩 token，不再寫死色碼，陰影為 none", () => {
    const shell = css["_admin/layout.css"];
    expect(shell).toMatch(/--admin-bg:\s*var\(--yy-calm-bg\)/);
    expect(shell).toMatch(/--admin-border:\s*var\(--yy-calm-rule\)/);
    expect(shell).toMatch(/--admin-shadow:\s*none/);
  });

  it("側欄是單色底、啟用項目用左側實線標記，不靠漸層與陰影", () => {
    expect(find("_admin/layout.css")(".admin-sidebar").body).toMatch(/background:\s*var\(--yy-calm-block\)/);
    const active = find("_admin/layout.css")(".admin-nav-link.active").body;
    expect(active).toMatch(/border-left:\s*3px solid var\(--yy-calm-block-accent\)/);
    expect(active).not.toMatch(/box-shadow/);
  });

  it("窄螢幕選單的背景遮罩用主題色混出的半透明", () => {
    expect(find("_admin/layout.css")(".admin-nav-backdrop", /max-width/).body).toMatch(/color-mix\(in srgb, var\(--yy-calm-block\)/);
  });

  it("減少動態：側欄與遮罩不播動畫", () => {
    expect(find("_admin/layout.css")(".admin-nav-backdrop", /prefers-reduced-motion/).body).toMatch(/animation:\s*none/);
  });

  it("入口載入條不再用拼色漸層，動畫只動透明度", () => {
    const bar = find("_admin/admin-entry.css")(".admin-entry-bar").body;
    expect(bar).toMatch(/background:\s*var\(--yy-calm-block-accent\)/);
    expect(css["_admin/admin-entry.css"]).toMatch(/@keyframes admin-entry-pulse\s*\{[^@]*opacity/);
  });
});

describe("後台共用規則", () => {
  it("輸入框有焦點框，表單與按鈕至少 38px 高", () => {
    expect(css["_admin/admin-base.css"]).toMatch(/:is\(\.form-control, \.form-select\):focus\s*\{[^}]*outline:\s*var\(--admin-focus-ring\)/);
    expect(css["_admin/admin-base.css"]).toMatch(/min-height:\s*var\(--admin-control-height\)/);
  });

  it("焦點框取自沉穩 token", () => {
    expect(css["_admin/layout.css"]).toMatch(/--admin-focus-ring:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("圖表資料點：鍵盤聚焦有焦點框，hover 只給滑鼠", () => {
    const f = find("_admin/quiz-quality-analysis.css");
    expect(f(".quiz-quality-dot:focus-visible").body).toMatch(/outline:\s*var\(--admin-focus-ring\)/);
  });

  it("留存熱圖：待計算格用虛線框而不只靠顏色，資料深淺用 accent 的百分比", () => {
    const pending = find("_admin/retention-analysis.css")(".retention-analysis-cell-pending").body;
    expect(pending).toMatch(/border:\s*1px dashed/);
    expect(css["_admin/retention-analysis.css"]).toMatch(/color-mix\(in srgb, var\(--yy-calm-accent\) 90%/);
  });

  it("狀態標籤各自有不同的框色，不只靠底色", () => {
    expect(css["_admin/quiz-quality-analysis.css"]).toMatch(/border-color:\s*var\(--yy-calm-success\)/);
    expect(css["_admin/quiz-quality-analysis.css"]).toMatch(/border-color:\s*var\(--yy-calm-danger\)/);
  });
});

describe("後台登入頁", () => {
  it("登入卡用細框，沒有硬陰影與回彈", () => {
    const card = find("_auth/adminLogin.css")(".admin-login-card").body;
    expect(card).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(card).not.toMatch(/box-shadow/);
    expect(card).toMatch(/admin-login-card-in\s+\.3s var\(--ease-out\)/);
  });

  it("持續循環的裝飾（梭子、星塵、起伏、游標閃爍）都已拿掉", () => {
    expect(css["_auth/adminLogin.css"]).not.toMatch(/infinite/);
    expect(find("_auth/adminLogin.css")(".admin-login-shuttle, .admin-login-dust").body).toMatch(/display:\s*none/);
  });

  it("返回連結至少 44px 高，有焦點框", () => {
    expect(find("_auth/adminLogin.css")(".admin-login-back").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find("_auth/adminLogin.css")(".admin-login-back:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });
});
