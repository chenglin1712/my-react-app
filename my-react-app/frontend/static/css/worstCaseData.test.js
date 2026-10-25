// B-2「最壞資料與換行」的回歸檢查：長族語詞、長中文翻譯、窄螢幕時版面不能被撐破。
// 這些是靜態檢查（讀 CSS 文字），不能取代瀏覽器實測，但能防止之後有人把規則改回去。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const css = (rel) => readFileSync(resolve(dir, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// 取出第一個以 selector 開頭的規則內容
const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = source.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};

// 標準屬性（不含 -webkit- 前綴版本）
const hasProp = (block, prop, value) =>
  new RegExp(String.raw`(?:^|[;\s{])${prop}:\s*${value}`).test(block);

describe("長詞不會撐破 grid／flex 欄位", () => {
  it("聽力題選項 grid 的欄位最小寬為 0，並允許斷行", () => {
    const src = css("_game/listening.css");
    expect(rule(src, ".listening-options")).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(rule(src, ".listening-option")).toMatch(/overflow-wrap:\s*anywhere/);
    // 480px 以下改單欄，欄寬同樣要能縮到 0
    const narrow = src.match(/max-width:\s*480px\)\s*\{([\s\S]*)$/)?.[1] ?? "";
    expect(rule(narrow, ".listening-options")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("遊戲首頁與專區的兩欄 grid 不用裸的 1fr", () => {
    expect(rule(css("_game/index.css"), ".gamehub-grid")).toMatch(/minmax\(0,\s*1fr\)/);
    expect(css("_game/zone.css")).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
    // 專區改成置中的 flex wrap（落單的卡片置中）；手機兩欄的卡片寬度要能縮到 0，不被長字撐破
    const zone = css("_game/zone.css");
    expect(rule(zone, ".zone-grid")).toMatch(/justify-content:\s*center/);
    expect(rule(zone, ".zone-card")).toMatch(/min-width:\s*0/);
    const zoneNarrow = zone.match(/max-width:\s*600px\)\s*\{([\s\S]*)$/)?.[1] ?? "";
    expect(rule(zoneNarrow, ".zone-card")).toMatch(/flex:\s*0 1 calc\(\(100% - 1\.25rem\) \/ 2\)/);
  });

  it("收藏字卡的標題可換行、中文翻譯最多兩行", () => {
    const src = css("_favorite/index.css");
    const word = rule(src, ".word-card-front .favorite-word-info h3 .tayal-word-text");
    expect(word).toMatch(/min-width:\s*0/);
    expect(word).toMatch(/overflow-wrap:\s*anywhere/);
    expect(word).toMatch(/display:\s*-webkit-box/);
    expect(word).toMatch(/-webkit-line-clamp:\s*2/);
    expect(word).toMatch(/overflow:\s*hidden/);
    const h5 = rule(src, ".word-card-front .favorite-word-info h5");
    expect(h5).toMatch(/display:\s*-webkit-box/);
    expect(h5).toMatch(/-webkit-box-orient:\s*vertical/);
    expect(h5).toMatch(/-webkit-line-clamp:\s*2/);
    expect(h5).toMatch(/overflow:\s*hidden/);
  });
});

describe("題號面板與作答統計在窄螢幕不溢出", () => {
  it("題號面板寬度不超過容器，題數多時在面板內捲動", () => {
    const src = css("_quiz/quiz_answerBox.css");
    expect(rule(src, ".box-container")).toMatch(/width:\s*min\(280px,\s*100%\)/);
    const list = rule(src, ".box-question-list");
    expect(list).toMatch(/minmax\(0,\s*1fr\)/);
    expect(list).toMatch(/max-height:\s*50vh/);
    expect(list).toMatch(/overflow-y:\s*auto/);
  });

  it("作答情形頁的題目欄位不再固定 280px", () => {
    const src = css("_quiz/quiz_panel_submit.css");
    expect(rule(src, ".submit-question-q")).toMatch(/width:\s*min\(280px,\s*100%\)/);
    expect(rule(src, ".submit-question-q2")).toMatch(/width:\s*min\(280px,\s*100%\)/);
  });
});

describe("手機輸入框字級與全站基礎規則", () => {
  it("搜尋與翻譯輸入框在手機上是 16px，避免 iOS 自動放大", () => {
    const search = css("_search/index.css").match(/max-width:\s*720px\)\s*\{([^@]*?\.search-terminal-input[\s\S]*?\}\s*)\}/)?.[1] ?? "";
    expect(search).toMatch(/font-size:\s*16px/);
    const translate = css("_translate/index.css").match(/max-width:\s*720px\)\s*\{\s*\.translate-textarea\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(translate).toMatch(/font-size:\s*16px/);
  });

  it("html-reset 有 scroll-padding-top、字體平滑、touch-action 與 ::selection", () => {
    const src = css("default/html-reset.css");
    expect(src).toMatch(/scroll-padding-top:\s*100px/);
    expect(src).toMatch(/-webkit-font-smoothing:\s*antialiased/);
    expect(src).toMatch(/touch-action:\s*manipulation/);
    expect(src).toMatch(/::selection\s*\{/);
  });

  it("theme-v2 有共用的斷字與標題換行規則", () => {
    const src = css("default/theme-v2.css");
    expect(src).toMatch(/\.yy-page\s*\{\s*overflow-wrap:\s*break-word/);
    expect(src).toMatch(/\.yy-page :is\(h1, h2, h3, h4\)\s*\{\s*text-wrap:\s*balance/);
    expect(src).toMatch(/\.yy-page :is\(p, li\)\s*\{\s*text-wrap:\s*pretty/);
    // 手機輸入框 16px 的規則要排除 checkbox、radio 與各種按鈕型 input
    const mobile = src.match(/max-width:\s*720px\)\s*\{([\s\S]*?font-size:\s*16px;[\s\S]*?)\}/)?.[1] ?? "";
    ["checkbox", "radio", "range", "file", "button", "submit", "reset"].forEach((t) =>
      expect(mobile).toContain(`[type="${t}"]`),
    );
  });

  it("遊戲選項與題號按鈕不可選取文字", () => {
    expect(hasProp(rule(css("_game/listening.css"), ".listening-option"), "user-select", "none")).toBe(true);
    expect(hasProp(rule(css("_game/sentence.css"), ".sent-option"), "user-select", "none")).toBe(true);
    expect(rule(css("_game/sentence.css"), ".sent-option")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(hasProp(rule(css("_quiz/quiz_answerBox.css"), ".box-question-btn"), "user-select", "none")).toBe(true);
    expect(hasProp(rule(css("_quiz/quiz_panel.css"), ".quiz-image-box"), "user-select", "none")).toBe(true);
  });
});
