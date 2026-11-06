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
// 步驟 4-1：大卡可用 --yy-elev-2 柔影；漸層只准在 authPage.css（見下方專屬測試），其他檔仍禁止
const NO_DECORATION = /box-shadow\s*:\s*(?!none|var\(--yy-elev-2\))\S|text-shadow|backdrop-filter|rgba?\(|transition:\s*all|ease-in(?![\w-])|#[0-9a-fA-F]{3,8}\b|(?<![-\w])color:\s*(?:white|black)\b|background(?:-color)?:\s*(?:white|black)\b/;

const FILES = [..."_auth/authPage.css _auth/authField.css _auth/passwordField.css _auth/loginForm.css _auth/registerForm.css _auth/forgotPassword.css _auth/resetPassword.css _auth/editProfile.css _info/index.css _error/notFound.css".split(" ")];
const css = Object.fromEntries(FILES.map((f) => [f, strip(read(f))]));
const rules = Object.fromEntries(FILES.map((f) => [f, parse(css[f])]));
const find = (file) => finder(rules[file]);

describe("登入與說明頁：所有樣式檔", () => {
  it("有找到檔案", () => {
    expect(FILES.length).toBe(10);
  });

  it.each(FILES)("%s：沒有舊風格 token、寫死色碼、陰影、漸層、模糊、transition: all", (f) => {
    expect(css[f]).not.toMatch(OLD_TOKENS);
    expect(css[f]).not.toMatch(NO_DECORATION);
    if (f !== "_auth/authPage.css") expect(css[f]).not.toMatch(/gradient/);
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

  it("單卡置中，背景有柔漸層層次：只准 radial-gradient、每層只用語意 token、圓心在區塊內；大卡陰影恰好是 --yy-elev-2", () => {
    const f = find("_auth/authPage.css");
    const bg = f(".auth-hero, .auth-backdrop").body;
    expect(bg).toMatch(/justify-content:\s*center/);
    // 不准有 linear／conic／repeating 等其他漸層
    expect((bg.match(/[\w-]*gradient\(/g) ?? []).every((g) => g === "radial-gradient(")).toBe(true);
    const layers = bg.split("radial-gradient(").slice(1);
    expect(layers.length).toBeGreaterThanOrEqual(2);
    layers.forEach((layer) => {
      expect(layer).toMatch(/var\(--yy-calm-tint-[a-z]+-\d\)/);
      expect(layer).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:red|blue|white|black)\b/);
      const at = layer.match(/at\s+(\d+)%\s+(\d+)%/);
      expect(at, "每層要寫明圓心").not.toBeNull();
      [at[1], at[2]].forEach((n) => {
        expect(Number(n)).toBeGreaterThanOrEqual(10);
        expect(Number(n)).toBeLessThanOrEqual(90);
      });
    });
    const shadow = (file, sel) => find(file)(sel).body.match(/box-shadow:\s*([^;]+);/)?.[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(shadow("_auth/authPage.css", ".auth-card.yy-card")).toBe("var(--yy-elev-2)");
    expect(shadow("_auth/forgotPassword.css", ".forgot-container")).toBe("var(--yy-elev-2)");
    expect(shadow("_auth/resetPassword.css", ".reset-container")).toBe("var(--yy-elev-2)");
  });

  it("輸入框字級 16px（iOS 不會自動放大），欄位整條畫焦點框", () => {
    expect(find("_auth/loginForm.css")(".loginForm .input-field").body).toMatch(/font-size:\s*(?:16px|1rem)/);
    expect(find("_auth/registerForm.css")(".input-field").body).toMatch(/font-size:\s*(?:16px|1rem)/);
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
    expect(find("_auth/forgotPassword.css")(".forgot-container input").body).toMatch(/font-size:\s*(?:16px|1rem)/);
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
    expect(f(".info-card.yy-card").body).toMatch(/border-radius:\s*var\(--yy-radius-panel\)/);
    expect(f(".info-title").body).toMatch(/font-family:\s*var\(--yy-font-heading\)/);
    expect(f(".info-heading").body).toMatch(/font-family:\s*var\(--yy-font-heading\)/);
  });
});

describe("說明頁目錄與 404（Apple 化步驟 4-9）", () => {
  it("有目錄時桌面兩欄、手機單欄；目錄連結至少 44px、目錄 sticky", () => {
    const f = find("_info/index.css");
    expect(f(".info-layout.has-toc").body).toMatch(/grid-template-columns:\s*200px minmax\(0, 760px\)/);
    expect(f(".info-layout.has-toc", /max-width:\s*900px/).body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(f(".info-toc").body).toMatch(/position:\s*sticky/);
    expect(f(".info-toc", /max-width:\s*900px/).body).toMatch(/position:\s*static/);
    expect(f(".info-toc a").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("正文行寬不超過 65 字元", () => {
    const widths = [...css["_info/index.css"].matchAll(/max-width:\s*(\d+)ch/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    widths.forEach((w) => expect(w).toBeLessThanOrEqual(65));
  });

  it("404 不再用舊像素字體，數字用標題字體與強調色", () => {
    const f = find("_error/notFound.css");
    expect(f(".notfound-code").body).toMatch(/font-family:\s*var\(--yy-font-heading\)/);
    expect(f(".notfound-code").body).toMatch(/color:\s*var\(--yy-calm-accent\)/);
  });
});
