// @vitest-environment node
//
// S8-1 守門：單詞查詢、族語翻譯、影像辨識三頁的樣式。
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

const OLD_TOKENS = /--yy-(?:red|gold|gold-light|blue|blue-light|cream|cream-dim|ink|green|border|text-muted|text-tertiary|text-secondary|radius-card|radius-btn|surface|font-pixel|warning-bg|red-dark)(?![\w-])/;
const NO_DECORATION = /box-shadow\s*:\s*(?!none)\S|text-shadow|linear-gradient|repeating-conic-gradient|transition:\s*all|ease-in(?![\w-])|rgba?\(|#[0-9a-fA-F]{3,8}\b/;

const FILES = {
  search: "_search/index.css",
  wordCard: "_search/wordCard.css",
  translate: "_translate/index.css",
  wizard: "_camera/wizard.css",
  result: "_camera/result.css",
};
const css = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, strip(read(f))]));
const rules = Object.fromEntries(Object.entries(css).map(([k, v]) => [k, parse(v)]));
const find = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, finder(v)]));

const hoverOnlyFine = (list) =>
  list.filter((r) => /:hover/.test(r.selector)).forEach((r) => {
    expect(r.atRules.some((a) => /hover:\s*hover/.test(a) && /pointer:\s*fine/.test(a)), r.selector).toBe(true);
  });

describe("三頁共通", () => {
  it.each(Object.keys(FILES))("%s：沒有舊風格 token、寫死色碼、陰影、漸層、transition: all", (key) => {
    expect(css[key]).not.toMatch(OLD_TOKENS);
    expect(css[key]).not.toMatch(NO_DECORATION);
  });

  it.each(Object.keys(FILES))("%s：hover 只給有滑鼠的裝置", (key) => {
    hoverOnlyFine(rules[key]);
  });
});

describe("單詞查詢", () => {
  it("族語按鈕至少 44px 高、選取靠底色不位移、按下縮放、有焦點框", () => {
    expect(find.search(".tribe-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".tribe-btn.active").body).not.toMatch(/transform/);
    expect(find.search(".tribe-btn.active").body).toMatch(/background:\s*var\(--yy-calm-accent\)/);
    expect(find.search(".tribe-btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find.search(".tribe-btn:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("選取的族語前面有勾，不只靠顏色", () => {
    expect(find.search(".tribe-btn.active::before").body).toMatch(/content:\s*"\2713"/);
  });

  it("各族語不再各自上色", () => {
    expect(css.search).not.toMatch(/data-tribe=/);
  });

  it("結果是清單列：只有細線分隔，沒有厚框與圓角卡片", () => {
    const row = find.search(".search-page .list-group-item").body;
    expect(row).toMatch(/border:\s*none\s*!important/);
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--yy-calm-rule\)\s*!important/);
    expect(row).toMatch(/border-radius:\s*0\s*!important/);
  });

  it("搜尋按鈕與輸入列至少 44px 高；輸入列整條畫焦點框", () => {
    expect(find.search(".search-go-btn.btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".search-terminal-input, .search-terminal-input.form-control").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".search-terminal:focus-within").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("字卡的展開鈕、播放與收藏鈕都至少 44px", () => {
    expect(find.wordCard(".word-card-toggle").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.wordCard(".word-card-actions .btn").body).toMatch(/min-width:\s*var\(--yy-control-md\)/);
    expect(find.wordCard(".word-card-actions .btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });

  it("減少動態：精簡搜尋列不位移、按下不縮放", () => {
    expect(find.search(".search-compact-bar", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
    expect(find.search(".tribe-btn:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
    expect(find.wordCard(".word-card-actions .btn:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });
});

describe("族語翻譯", () => {
  it("翻譯頁範圍內拿掉拼色圖樣與厚框，兩個窗格改成頂端細線", () => {
    expect(find.translate(".translate-page .yy-hero::before").body).toMatch(/display:\s*none/);
    const pane = find.translate(".translate-page .yy-card.translate-pane").body;
    expect(pane).toMatch(/border-top:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(pane).toMatch(/border-radius:\s*0/);
  });

  it("交換鈕有按下縮放與焦點框；輸入框有替代焦點樣式", () => {
    expect(find.translate(".translate-swap-btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find.translate(".translate-swap-btn:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find.translate(".translate-textarea:focus").body).toMatch(/border-color:\s*var\(--yy-calm-accent\)/);
  });

  it("標示不只靠顏色：不支援詞有波浪底線，已佐證詞有實線，推導詞有點線", () => {
    expect(find.translate(".yy-gt-unsupported").body).toMatch(/underline wavy/);
    expect(find.translate(".yy-gt-attested").body).toMatch(/solid/);
    expect(find.translate(".yy-gt-derived").body).toMatch(/dotted/);
  });

  it("字級不低於 14px（沒有 12px、13px）", () => {
    expect(css.translate).not.toMatch(/font-size:\s*1[0-3]px/);
  });
});

describe("影像辨識", () => {
  it("拿掉頁首拼色圖樣；上傳區有焦點框；步驟一窗格改成頂端細線", () => {
    expect(find.wizard(".camera-page .yy-hero::before, .camera-hero::before").body).toMatch(/display:\s*none/);
    expect(find.wizard(".camera-dropzone:focus-visible, .camera-dropzone:focus-within").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find.wizard(".camera-page .yy-card.camera-step1-card").body).toMatch(/border-top:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
  });

  it("標籤選項至少 44px 高，有按下縮放、焦點框，減少動態不縮放", () => {
    expect(find.wizard(".camera-label-item").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.wizard(".camera-label-item:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find.wizard(".camera-label-item:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find.wizard(".camera-label-item:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("信心分數仍用等寬數字", () => {
    expect(find.wizard(".camera-label-score").body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("查詢結果頁與單詞查詢同為清單列", () => {
    const row = find.result(".camera-step3 .list-group-item").body;
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--yy-calm-rule\)\s*!important/);
    expect(row).toMatch(/border-radius:\s*0\s*!important/);
  });
});
