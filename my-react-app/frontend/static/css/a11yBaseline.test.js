// B-5 全站無障礙基線的靜態檢查：
// 1. 每個拿掉 outline 的規則都要有登記在案的替代焦點樣式（審查項 P2-97）
// 2. 小圖示按鈕有 44px 點擊區（審查項 P2-96）
// 3. B-1／B-2 留下的全站按鈕污染與窄螢幕寬度
// 後台（_admin 資料夾、檔名以 admin 開頭）用另一套樣式，留到階段 G。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".css") ? [full] : [];
  });

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
const rel = (file) => relative(ROOT, file).split(/[\\/]/).join("/");
const isAdmin = (file) => /(^|\/)_admin\//i.test(file) || /(^|\/)admin[^/]*$/i.test(file);
const files = walk(ROOT).map((f) => ({ file: rel(f), css: strip(readFileSync(f, "utf8")) }));
const front = files.filter(({ file }) => !isAdmin(file));
const theme = files.find(({ file }) => file === "default/theme-v2.css").css;

const rules = (css) => {
  const out = [];
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) out.push({ selector: prelude.replace(/\s+/g, " "), body: buf });
      buf = "";
    } else buf += ch;
  }
  return out;
};

// [檔案, 選擇器, 負責畫焦點外框的選擇器片段, 該規則所在的檔案（省略時是 default/theme-v2.css）]
const OUTLINE_NONE_ALLOWLIST = [
  ["_auth/loginForm.css", ".loginForm .input-field", ".input-wrapper:focus-within"],
  ["_auth/registerForm.css", ".input-field", ".input-wrapper:focus-within"],
  ["_game/game_crossword_board.css", ".area-inputgrid", ".area-inputgrid:focus-visible", "_game/game_crossword_board.css"],
  ["_note/notesharestyle.css", ".ns-search-input", ".ns-search:focus-within", "_note/notesharestyle.css"],
  ["_note/notestyle.css", ".note-text .ProseMirror", ".note-text:focus-within", "_note/notestyle.css"],
  ["_quiz/review_AI.css", ".assistant-input input", ".assistant-input input"],
  ["_quiz/review_discussion.css", ".input-box input", ".input-box input"],
  ["_quiz/situation_filter.css", ".filter-date-input:focus", ".filter-date-input"],
  ["_quiz/situation_filter.css", ".filter-select:focus", ".filter-select"],
  ["_translate/index.css", ".translate-textarea", ".translate-textarea"],
  ["default/theme-v2.css", ".yy-terminal__input", ".yy-terminal:focus-within"],
];

describe("outline: none 一律要有替代的焦點樣式", () => {
  const found = [];
  front.forEach(({ file, css }) =>
    rules(css).forEach(({ selector, body }) => {
      if (/outline\s*:\s*(none|0)\b/.test(body)) found.push([file, selector]);
    }),
  );

  it("前台所有拿掉 outline 的規則都已登記（新增的要先決定怎麼畫焦點，再加進清單）", () => {
    const key = ([f, s]) => `${f} | ${s}`;
    expect(found.map(key).sort()).toEqual(OUTLINE_NONE_ALLOWLIST.map((e) => key(e.slice(0, 2))).sort());
  });

  it.each(OUTLINE_NONE_ALLOWLIST)("%s 的「%s」由 %s 畫焦點外框", (_file, _selector, cover, coverFile = "default/theme-v2.css") => {
    const css = files.find((f) => f.file === coverFile).css;
    const rule = rules(css).find((r) => r.selector.includes(cover) && /--yy-ui-focus-ring/.test(r.body));
    expect(rule, `${coverFile} ${cover}`).toBeTruthy();
  });
});

describe("小圖示按鈕的 44px 點擊區", () => {
  it("--yy-control-md 是 44px，關閉鈕、收藏愛心用 ::after 往外擴到這個尺寸", () => {
    expect(theme).toMatch(/--yy-control-md:\s*44px/);
    const rule = rules(theme).find(
      (r) => r.selector.includes(".close-btn::after") && r.selector.includes(".favorite-btn::after"),
    );
    expect(rule).toBeTruthy();
    expect(rule.body).toMatch(/width:\s*max\(100%,\s*var\(--yy-control-md\)\)/);
    expect(rule.body).toMatch(/height:\s*max\(100%,\s*var\(--yy-control-md\)\)/);
  });

  it.each([
    ["navigation/userSidebar.css", ".profile-btn"],
    ["_auth/passwordField.css", ".password-toggle"],
  ])("%s 的 %s 同樣用 ::after 擴成 44px，並且自己是 relative", (file, selector) => {
    const all = rules(files.find((f) => f.file === file).css);
    expect(all.find((r) => r.selector === selector).body).toMatch(/position:\s*relative/);
    expect(all.find((r) => r.selector === `${selector}::after`).body).toMatch(/width:\s*max\(100%,\s*var\(--yy-control-md\)\)/);
  });

  it.each([
    ["_translate/index.css", ".translate-swap-btn", "::after"],
  ])("%s 的 %s 用 %s 把點擊區擴成 44px", (file, selector, pseudo) => {
    const all = rules(files.find((f) => f.file === file).css);
    const rule = all.find((r) => r.selector.split(",").map((x) => x.trim()).includes(`${selector}${pseudo}`));
    expect(rule, `${selector}${pseudo}`).toBeTruthy();
    expect(rule.body).toMatch(/width:\s*max\(100%,\s*var\(--yy-control-md\)\)/);
  });

  it("翻譯頁交換鈕自己是 relative", () => {
    const swap = rules(files.find((f) => f.file === "_translate/index.css").css).find((r) => r.selector === ".translate-swap-btn");
    expect(swap.body).toMatch(/position:\s*relative/);
  });

  it("首頁輪播的左右箭頭本身就是 44px（S6-3 起不再靠 ::before 擴大點擊區，見 newsLook.test.js）", () => {
    const all = rules(files.find((f) => f.file === "_home/news.css").css);
    const arrows = all.find((r) => r.selector.includes(".news-carousel .swiper-button-prev") && /width:/.test(r.body));
    expect(arrows.body).toMatch(/width:\s*var\(--yy-control-md\)/);
    expect(arrows.body).toMatch(/height:\s*var\(--yy-control-md\)/);
  });

  it("觸控裝置的導覽選單項目至少 44px 高", () => {
    expect(theme).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.menu-item\s*\{\s*min-height:\s*var\(--yy-control-md\)/);
  });

  it("會被 ::after 定位的按鈕本身是 relative（收藏愛心原本就是 absolute）", () => {
    const rule = rules(theme).find((r) => r.selector === ".close-btn");
    expect(rule.body).toMatch(/position:\s*relative/);
  });
});

describe("B-1／B-2 留下的項目", () => {
  it("quiz_panel_submit.css 不再定義全站通用的 .btn-primary／.btn-secondary", () => {
    const css = files.find(({ file }) => file === "_quiz/quiz_panel_submit.css").css;
    expect(css).not.toMatch(/(^|[\s,}])\.btn-(primary|secondary)\b/m);
    expect(css).toMatch(/\.submit-btn-primary\s*\{/);
    expect(css).toMatch(/\.submit-btn-secondary\s*\{/);
  });

  it("發音結果頁的詞不會在極窄螢幕把版面擠爆", () => {
    const css = files.find(({ file }) => file === "_game/pronunciation.css").css;
    const rule = rules(css).find((r) => r.selector === ".pron-result-word");
    expect(rule.body).toMatch(/min-width:\s*min\(80px,\s*100%\)/);
    expect(rule.body).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("B-6 測驗區：選中與已作答不只靠顏色，也不用低對比的金色邊框", () => {
  const quiz = files.find((f) => f.file === "_quiz/quiz_panel.css").css;

  it.each([".answers button.selected", ".quiz-image-box.selected", ".match-btn.selected", ".cloze-option-btn.selected"])("%s 的邊框是深銅色（淺色邊框對米白對比不足）", (selector) => {
    const rule = rules(quiz).find((r) => r.selector === selector);
    expect(rule, selector).toBeTruthy();
    expect(rule.body).toMatch(/border-color:\s*var\(--yy-calm-accent\)/);
    expect(rule.body).not.toMatch(/border-color:\s*var\(--yy-gold\)/);
  });

  it("選中的題目有勾勾標記（是非題文字前、圖片題右上角）", () => {
    expect(rules(quiz).find((r) => r.selector === ".answers button.selected::before").body).toMatch(/content:\s*"✓/);
    expect(rules(quiz).find((r) => r.selector === ".quiz-image-box.selected::after").body).toMatch(/content:\s*"✓"/);
  });

  it("標星按鈕有 44px 點擊區", () => {
    const rule = rules(quiz).find((r) => r.selector === ".star-btn");
    expect(rule.body).toMatch(/min-width:\s*var\(--yy-control-md\)/);
    expect(rule.body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
  });
});

describe("B-7 導覽列與側欄", () => {
  const navbar = files.find((f) => f.file === "navigation/Navbar.css").css;

  it("沒有 .auth-container button 這種會蓋過 .auth-container-user 的通用規則（P2-3）", () => {
    expect(rules(navbar).some((r) => r.selector === ".auth-container button")).toBe(false);
  });

  it("收起的使用者側欄用 visibility:hidden，Tab 進不去（P2-1）", () => {
    const closed = rules(navbar).find((r) => r.selector === ".sidebar");
    expect(closed.body).toMatch(/visibility:\s*hidden/);
    const open = rules(navbar).find((r) => r.selector === ".sidebar.open");
    expect(open.body).toMatch(/visibility:\s*visible/);
  });
});

describe("AI 助手懸浮視窗", () => {
  const bot = files.find((f) => f.file === "_quiz/bot.css").css;

  it("聊天視窗是右下角定位、非全螢幕遮罩，且低於 Navbar 彈窗遮罩（1000）", () => {
    const rule = rules(bot).find((r) => r.selector === ".bot-overlay");
    expect(rule.body).toMatch(/position:\s*fixed/);
    expect(rule.body).toMatch(/right:\s*20px/);
    expect(rule.body).not.toMatch(/inset:\s*0/);
    expect(rule.body).toMatch(/z-index:\s*var\(--yy-z-float\)/); // = 900，低於導覽列的 --yy-z-nav（1000）
  });

  it("收合時 visibility:hidden 並禁止指標事件；開合動畫有 reduced-motion 降級", () => {
    const closed = rules(bot).find((r) => r.selector === '.bot-overlay[data-open="false"]');
    expect(closed.body).toMatch(/visibility:\s*hidden/);
    expect(closed.body).toMatch(/pointer-events:\s*none/);
    expect(bot).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("手機版高度扣掉 Navbar（含跑馬燈約 98px）後仍留空隙", () => {
    expect(bot).toMatch(/calc\(100dvh - var\(--bot-bottom, 8px\) - 104px\)/);
  });
});
