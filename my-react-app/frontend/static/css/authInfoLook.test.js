// @vitest-environment node
//
// S8-4 守門：登入、註冊、忘記密碼、個人資料、說明頁的樣式（adminLogin 屬於後台，留給 S9-1）。
import { readFileSync } from "node:fs";
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

const FILES = [..."_auth/authPage.css _auth/authField.css _auth/passwordField.css _auth/loginForm.css _auth/registerForm.css _auth/forgotPassword.css _auth/resetPassword.css _auth/editProfile.css _info/index.css".split(" ")];
const css = Object.fromEntries(FILES.map((f) => [f, strip(read(f))]));
const rules = Object.fromEntries(FILES.map((f) => [f, parse(css[f])]));
const find = (file) => finder(rules[file]);

describe("登入與說明頁：所有樣式檔", () => {
  it("有找到檔案", () => {
    expect(FILES.length).toBe(9);
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

describe("登入與註冊", () => {
  it("登入頁範圍內拿掉光暈與拼色圖樣，卡片用細框小圓角", () => {
    const f = find("_auth/authPage.css");
    expect(f(".auth-blob").body).toMatch(/display:\s*none/);
    expect(f(".auth-hero.yy-hero::before").body).toMatch(/display:\s*none/);
    expect(f(".auth-card.yy-card").body).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
  });

  it("輸入框字級 16px（iOS 不會自動放大），欄位整條畫焦點框", () => {
    expect(find("_auth/loginForm.css")(".loginForm .input-field").body).toMatch(/font-size:\s*16px/);
    expect(find("_auth/registerForm.css")(".input-field").body).toMatch(/font-size:\s*16px/);
    expect(find("_auth/loginForm.css")(".loginForm .input-wrapper:focus-within").body).toMatch(/outline:/);
    expect(find("_auth/registerForm.css")(".register-box .input-wrapper:focus-within").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it.each([
    ["_auth/loginForm.css", ".login-button"],
    ["_auth/registerForm.css", ".register-button"],
  ])("%s %s：至少 44px 高、按鈕字用 accent-on、按下縮放、減少動態不縮放", (file, sel) => {
    const body = find(file)(sel).body;
    expect(body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(body).toMatch(/color:\s*var\(--yy-calm-accent-on\)/);
    expect(find(file)(`${sel}:active:not(:disabled)`).body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find(file)(`${sel}:active:not(:disabled)`, /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("忘記密碼、重設密碼：輸入框與按鈕至少 44px、字級 16px、輸入框畫焦點框", () => {
    expect(find("_auth/forgotPassword.css")(".forgot-container input").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find("_auth/forgotPassword.css")(".forgot-container input").body).toMatch(/font-size:\s*16px/);
    expect(find("_auth/forgotPassword.css")(".forgot-container input:focus").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find("_auth/forgotPassword.css")(".forgot-button button").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find("_auth/resetPassword.css")(".reset-container input").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find("_auth/resetPassword.css")(".reset-container input:focus").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find("_auth/resetPassword.css")(".reset-button button").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("個人資料：頭像用細框不用陰影，鍵盤聚焦也看得到更換提示，欄位與按鈕畫焦點框、至少 44px", () => {
    const f = find("_auth/editProfile.css");
    expect(f(".avatar-uploader").body).toMatch(/border:\s*var\(--yy-border-width\) solid/);
    expect(f(".avatar-uploader:focus-within .edit-overlay").body).toMatch(/opacity:\s*1/);
    expect(f(".edit-container input:focus, .edit-container select:focus").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(f(".edit-container button").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f(".edit-container button:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("密碼顯示鈕有焦點框；hover 只給有滑鼠的裝置", () => {
    expect(find("_auth/passwordField.css")(".password-toggle:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });
});

describe("說明、隱私、聯絡", () => {
  it("說明頁範圍內卡片用細框小圓角，標題用標題字型", () => {
    const f = find("_info/index.css");
    expect(f(".info-card.yy-card").body).toMatch(/border-radius:\s*var\(--yy-ui-radius\)/);
    expect(f(".info-title").body).toMatch(/font-family:\s*var\(--yy-font-heading\)/);
    expect(f(".info-heading").body).toMatch(/font-family:\s*var\(--yy-font-heading\)/);
  });
});
