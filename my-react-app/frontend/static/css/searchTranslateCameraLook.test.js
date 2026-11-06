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
const NO_DECORATION = /box-shadow\s*:\s*(?!none|var\(--yy-elev-[0-4]\)\s*;)\S|text-shadow|linear-gradient|repeating-conic-gradient|transition:\s*all|ease-in(?![\w-])|rgba?\(|#[0-9a-fA-F]{3,8}\b/;

const FILES = {
  search: "_search/index.css",
  wordCard: "_search/wordCard.css",
  wordSheet: "_search/wordSheet.css",
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
  it("族語選擇器是分段控制：淡底圓角軌道、窄螢幕可橫向捲動不換行", () => {
    const track = find.search(".tribe-selector").body;
    expect(track).toMatch(/background:\s*var\(--yy-calm-info-bg\)/);
    expect(track).toMatch(/border-radius:\s*var\(--yy-radius-pill\)/);
    expect(track).toMatch(/overflow-x:\s*auto/);
    expect(track).not.toMatch(/flex-wrap:\s*wrap/);
    expect(find.search(".tribe-btn").body).toMatch(/flex:\s*0 0 auto/);
  });

  it("族語按鈕至少 44px 高、選取靠底色不位移、按下縮放、有焦點框", () => {
    expect(find.search(".tribe-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".tribe-btn.active").body).not.toMatch(/transform/);
    expect(find.search(".tribe-btn.active").body).toMatch(/background:\s*var\(--yy-calm-accent\)/);
    expect(find.search(".tribe-btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find.search(".tribe-btn:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("選取的族語前面有勾，不只靠顏色", () => {
    expect(find.search(".tribe-btn.active::before").body).toMatch(/content:\s*"\\2713" \/ ""/);
  });

  it("各族語不再各自上色", () => {
    expect(css.search).not.toMatch(/data-tribe=/);
  });

  it("結果是兩層卡片：細框、面板圓角、沒有陰影；字卡第二層放詞性標籤與詞頻，字級不低於 14px", () => {
    const card = find.search(".search-page .list-group > .list-group-item").body;
    expect(card).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-rule\)\s*!important/);
    expect(card).toMatch(/border-radius:\s*var\(--yy-radius-panel\)\s*!important/);
    expect(card).toMatch(/background:\s*var\(--yy-calm-surface\)/);
    expect(card).not.toMatch(/box-shadow/);
    expect(find.search(".search-page .list-group").body).toMatch(/display:\s*grid/);
    const meta = find.wordCard(".word-card-meta").body;
    expect(meta).toMatch(/border-top:\s*1px solid var\(--yy-calm-rule\)/);
    expect(meta).toMatch(/font-size:\s*var\(--yy-text-sm\)/);
    expect(find.wordCard(".word-card-tag").body).toMatch(/background:\s*var\(--yy-calm-tag\)/);
  });

  it("箭頭只給真正會原地展開的按鈕（有 aria-expanded）；開 dialog 的詞條鈕不畫箭頭", () => {
    expect(find.wordCard(".word-card-toggle[aria-expanded] .word-card-name::after")).toBeTruthy();
    expect(css.wordCard).not.toMatch(/\.word-card-toggle \.word-card-name::after/);
  });

  it("詳情 sheet：掛在 body 底下所以自己交代外觀；手機底部大圓角、桌面右側；陰影 elev-4；關閉鈕與動作鈕至少 44px；減少動態不位移", () => {
    expect(find.wordSheet(".word-sheet.offcanvas").body).toMatch(/box-shadow:\s*var\(--yy-elev-4\)/);
    expect(find.wordSheet(".word-sheet--bottom.offcanvas-bottom").body).toMatch(/border-radius:\s*var\(--yy-radius-block\) var\(--yy-radius-block\) 0 0/);
    expect(find.wordSheet(".word-sheet--end.offcanvas-end").body).toMatch(/width:\s*min\(480px, 100vw\)/);
    expect(find.wordSheet(".word-sheet-actions .btn, .word-sheet-head .btn-close").body).toMatch(/min-width:\s*var\(--yy-control-md\)/);
    expect(find.wordSheet(".word-sheet-actions .btn, .word-sheet-head .btn-close").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.wordSheet(".word-sheet.offcanvas, .word-sheet.offcanvas.hiding", /prefers-reduced-motion/).body).toMatch(/transition:\s*none/);
    expect(find.wordSheet(".word-sheet.offcanvas.hiding").body).toMatch(/transition-duration:\s*var\(--dur-overlay-out\)/);
  });

  it("卡片內展開的項目（原地展開）仍是只有細線分隔的清單列", () => {
    const row = find.search(".search-page .list-group-item .list-group-item").body;
    expect(row).toMatch(/border:\s*none\s*!important/);
    expect(row).toMatch(/border-top:\s*1px solid var\(--yy-calm-rule\)\s*!important/);
    expect(row).toMatch(/border-radius:\s*0\s*!important/);
  });

  it("Spotlight 大搜尋框：面板圓角、柔影 elev-2、整條畫焦點框、輸入字級手機 16px、按鈕至少 44px", () => {
    const field = find.search(".spotlight-field").body;
    expect(field).toMatch(/border-radius:\s*var\(--yy-radius-panel\)/);
    expect(field).toMatch(/box-shadow:\s*var\(--yy-elev-2\)/);
    expect(field).toMatch(/min-height:\s*60px/);
    expect(find.search(".spotlight-field:focus-within").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find.search(".spotlight-input", /max-width:\s*720px/)?.body ?? "").toMatch(/font-size:\s*(?:16px|1rem)/);
    expect(find.search(".spotlight-go").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".spotlight-go:active:not(:disabled)").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(find.search(".spotlight-go:active:not(:disabled)", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });

  it("建議清單：浮在搜尋框之上用 elev-4，選項至少 44px，作用中的選項不只靠底色（左側深銅線），進場動畫減少動態時關閉", () => {
    const list = find.search(".spotlight-list").body;
    expect(list).toMatch(/box-shadow:\s*var\(--yy-elev-4\)/);
    expect(list).toMatch(/z-index:\s*var\(--yy-z-dropdown\)/);
    expect(find.search(".spotlight-option").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".spotlight-option.is-active").body).toMatch(/border-inline-start-color:\s*var\(--yy-calm-accent\)/);
    expect(find.search(".spotlight-list:not([hidden])", /prefers-reduced-motion/).body).toMatch(/animation:\s*none/);
    expect(css.search).toMatch(/@keyframes spotlight-in/);
  });

  it("查無結果的建議鈕至少 44px，按下縮放", () => {
    expect(find.search(".search-suggest-chip").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.search(".search-suggest-chip:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
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
  it("翻譯頁範圍內拿掉拼色圖樣；兩個窗格是卡片：細框、面板圓角、elev-2 柔影", () => {
    expect(find.translate(".translate-page .yy-hero::before").body).toMatch(/display:\s*none/);
    const pane = find.translate(".translate-page .yy-card.translate-pane").body;
    expect(pane).toMatch(/background:\s*var\(--yy-calm-surface\)/);
    expect(pane).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-rule\)/);
    expect(pane).toMatch(/border-radius:\s*var\(--yy-radius-panel\)/);
    expect(pane).toMatch(/box-shadow:\s*var\(--yy-elev-2\)/);
  });

  it("互換鈕在雙欄中間：三欄網格（左卡、鈕、右卡），窄螢幕疊成單欄、鈕夾在上下卡之間且箭頭轉 90 度；鈕至少 44px", () => {
    expect(find.translate(".translate-grid").body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
    expect(find.translate(".translate-grid", /max-width:\s*900px/).body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(find.translate(".translate-swap-btn svg", /max-width:\s*900px/).body).toMatch(/rotate\(90deg\)/);
    expect(find.translate(".translate-swap-btn").body).toMatch(/width:\s*var\(--yy-control-md\)/);
    expect(find.translate(".translate-swap-btn").body).toMatch(/height:\s*var\(--yy-control-md\)/);
    expect(css.translate).not.toMatch(/translate-direction-bar/);
  });

  it("訪客額度是低調的一行字：沒有框與底色；用完的提示（callout）才保持醒目", () => {
    const strip = find.translate(".translate-guest-strip").body;
    expect(strip).not.toMatch(/border|background/);
    expect(find.translate(".translate-guest-count").body).toMatch(/font-size:\s*var\(--yy-text-base\)/);
    expect(find.translate(".translate-guest-callout").body).toMatch(/border|background/);
  });

  it("形態分析結果是折疊層次：摘要列至少 44px、有焦點框、箭頭在展開時轉向，減少動態不轉場", () => {
    expect(find.translate(".yy-morph-fold > summary").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find.translate(".yy-morph-fold > summary:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(find.translate(".yy-morph-fold[open] > summary::before").body).toMatch(/rotate\(90deg\)/);
    expect(find.translate(".yy-morph-fold > summary::before", /prefers-reduced-motion/).body).toMatch(/transition:\s*none/);
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

  it("查詢結果頁與單詞查詢同為兩層卡片：細框、面板圓角、沒有陰影；卡片內展開的項目仍是細線列", () => {
    const card = find.result(".camera-step3 .list-group > .list-group-item").body;
    expect(card).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-rule\)\s*!important/);
    expect(card).toMatch(/border-radius:\s*var\(--yy-radius-panel\)\s*!important/);
    expect(card).not.toMatch(/box-shadow/);
    expect(find.result(".camera-step3 .list-group").body).toMatch(/display:\s*grid/);
    const inner = find.result(".camera-step3 .list-group-item .list-group-item").body;
    expect(inner).toMatch(/border-top:\s*1px solid var\(--yy-calm-rule\)\s*!important/);
  });

  it("取景框：大圓角、玻璃提示貼在下緣不攔截點擊；玻璃材質來自 .yy-glass，這支檔案不自己寫 backdrop-filter", () => {
    expect(find.wizard(".camera-dropzone").body).toMatch(/border-radius:\s*var\(--yy-radius-block\)/);
    expect(find.wizard(".camera-dropzone").body).toMatch(/position:\s*relative/);
    const hint = find.wizard(".camera-dropzone-hint").body;
    expect(hint).toMatch(/position:\s*absolute/);
    expect(hint).toMatch(/pointer-events:\s*none/);
    expect(hint).toMatch(/color:\s*var\(--yy-calm-text\)/);
    expect(css.wizard).not.toMatch(/backdrop-filter/);
  });
});

describe("詞類篩選（Apple 化步驟 4-2）", () => {
  it("分段按鈕至少 44px、選取有勾號與強調框（不只靠顏色）、按下縮放且減少動態不縮放", () => {
    const f = find.search;
    expect(f(".pos-filter-btn").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(f('.pos-filter-btn[aria-pressed="true"]').body).toMatch(/border-color:\s*var\(--yy-calm-accent\)/);
    expect(f('.pos-filter-btn[aria-pressed="true"]::before').body).toMatch(/content:\s*"\2713"/);
    expect(f(".pos-filter-btn:active").body).toMatch(/scale\(var\(--yy-ui-press\)\)/);
    expect(f(".pos-filter-btn:active", /prefers-reduced-motion/).body).toMatch(/transform:\s*none/);
  });
});
