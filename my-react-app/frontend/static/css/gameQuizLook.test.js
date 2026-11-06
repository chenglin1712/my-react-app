// @vitest-environment node
//
// S8-2 守門：遊戲專區與測驗（_game、_quiz）所有樣式檔。
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
const NO_DECORATION = /box-shadow\s*:\s*(?!none|var\(--yy-elev-[0-4]\)\s*;)\S|text-shadow|gradient|rgba?\(|transition:\s*all|ease-in(?![\w-])|#[0-9a-fA-F]{3,8}\b|(?<![-\w])color:\s*(?:white|black)\b|background(?:-color)?:\s*(?:white|black)\b/;

const FILES = [
  ...readdirSync(join(ROOT, "_game")).filter((f) => f.endsWith(".css")).map((f) => `_game/${f}`),
  ...readdirSync(join(ROOT, "_quiz")).filter((f) => f.endsWith(".css")).map((f) => `_quiz/${f}`),
];
const css = Object.fromEntries(FILES.map((f) => [f, strip(read(f))]));
const rules = Object.fromEntries(FILES.map((f) => [f, parse(css[f])]));
const find = (file) => finder(rules[file]);

describe("遊戲與測驗：所有樣式檔", () => {
  it("有找到檔案", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(30);
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

  it.each(FILES)("%s：字級不低於 14px", (f) => {
    const sizes = [...css[f].matchAll(/font-size:\s*([\d.]+)(px|rem)\b/g)].map((m) => (m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1])));
    sizes.forEach((px) => expect(px).toBeGreaterThanOrEqual(14));
  });
});

describe("遊戲專區", () => {
  it("專區頁範圍內拿掉頁首拼色圖樣，卡片用細框小圓角", () => {
    expect(find("_game/index.css")(".gamehub-page .yy-hero::before").body).toMatch(/display:\s*none/);
    const card = find("_game/index.css")(".gamehub-page .yy-card").body;
    expect(card).toMatch(/border:\s*var\(--yy-border-width\) solid var\(--yy-calm-line\)/);
    expect(card).toMatch(/border-radius:\s*var\(--yy-radius-panel\)/);
  });

  it("選中的族語不放大位移，改靠底色、框色與勾", () => {
    const sel = find("_game/index.css")(".gamehub-tribe-card.is-selected").body;
    expect(sel).not.toMatch(/transform/);
    expect(sel).toMatch(/border-color:\s*var\(--yy-calm-accent\)/);
    expect(find("_game/index.css")(".gamehub-tribe-card.is-selected .gamehub-tribe-name::before").body).toMatch(/content:\s*"\\2713"/);
  });

  it("入口是 bento 版面：兩欄網格，詞彙遊戲大圖卡佔三列高、用淡銅底；手機疊成單欄", () => {
    const f = find("_game/index.css");
    expect(f(".gamehub-grid").body).toMatch(/grid-template-columns:\s*minmax\(0, 1\.25fr\) minmax\(0, 1fr\)/);
    expect(f(".gamehub-card--feature").body).toMatch(/grid-row:\s*span 3/);
    expect(f(".gamehub-card--feature").body).toMatch(/background:\s*var\(--yy-calm-tint-copper-2\)/);
    expect(f(".gamehub-card-art").body).toMatch(/color:\s*var\(--yy-calm-copper\)/);
    expect(f(".gamehub-card-art", /max-width:\s*720px/).body).toMatch(/display:\s*none/);
    expect(f(".gamehub-grid", /max-width:\s*720px/).body).toMatch(/grid-template-columns:\s*1fr/);
    expect(f(".gamehub-card--feature", /max-width:\s*720px/).body).toMatch(/grid-row:\s*auto/);
  });

  it("一頁一強調色：族語標記統一石板灰底，選族語頁不再靠各族的 --tribe-color", () => {
    expect(find("_game/index.css")(".gamehub-tribe-mark").body).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(find("_game/gameTribeSelect.css")(".vocab-tribe-badge").body).toMatch(/background:\s*var\(--yy-calm-block\)/);
    expect(css["_game/gameTribeSelect.css"]).not.toMatch(/--tribe-color/);
  });

  it("結算頁慶祝動態：圓點只動 transform／opacity、一次性（不循環）、只用深銅與銅褐；減少動態時隱藏、分數不彈跳", () => {
    const f = find("_game/celebrate.css");
    expect(css["_game/celebrate.css"]).not.toMatch(/infinite/); // animation 簡寫與 animation-iteration-count 都不准無限循環
    expect(css["_game/celebrate.css"]).toMatch(/@keyframes game-celebrate-burst[\s\S]*transform: translate\(var\(--dx\), var\(--dy\)\)/);
    // keyframes 裡只准出現 transform、opacity 兩種屬性
    const props = [...css["_game/celebrate.css"].matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^}]*\})+)\s*\}/g)]
      .flatMap((m) => [...m[1].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]));
    expect(props.length).toBeGreaterThan(0);
    props.forEach((p) => expect(["transform", "opacity"]).toContain(p));
    expect(f(".game-celebrate-dot").body).toMatch(/background:\s*var\(--yy-calm-accent\)/);
    expect(f(".game-celebrate-dot:nth-child(even)").body).toMatch(/background:\s*var\(--yy-calm-copper\)/);
    expect(f(".game-celebrate").body).toMatch(/pointer-events:\s*none/);
    expect(f(".game-celebrate", /prefers-reduced-motion/).body).toMatch(/display:\s*none/);
    expect(f(".is-celebrating .listening-result-num, .is-celebrating .sent-result-num").body).toMatch(/var\(--ease-spring\)/);
    expect(f(".is-celebrating .listening-result-num, .is-celebrating .sent-result-num", /prefers-reduced-motion/).body).toMatch(/animation:\s*none/);
  });

  it("遊戲卡片頂端流動色帶（漸層）已移除", () => {
    expect(css["_game/index.css"]).not.toMatch(/\.gamehub-card-head::before/);
  });

  it("整張卡片都點得到：覆蓋層偽元素只對 .gamehub-card 撐滿，頭部與標題不能設定位", () => {
    // 偽元素 inset:0 是對最近的定位祖先撐滿；頭部若是 relative，點擊範圍會縮到頭部，
    // 按卡片下半部（含「選這個」）沒有反應
    expect(find("_game/index.css")(".gamehub-card").body).toMatch(/position:\s*relative/);
    expect(find("_game/index.css")(".gamehub-card-btn::after").body).toMatch(/position:\s*absolute/);
    [".gamehub-card-head", ".gamehub-card-title", ".gamehub-card-btn"].forEach((sel) => {
      expect(find("_game/index.css")(sel).body, sel).not.toMatch(/position:/);
    });
  });

  it.each([
    ["_game/listening.css", ".listening-play-btn.playing"],
    ["_game/pronunciation.css", ".pron-mic-btn.recording"],
    ["_game/sentence.css", ".sent-play-btn.playing"],
  ])("%s：播放／錄音中的脈動只動透明度，減少動態時停止", (f, sel) => {
    expect(css[f]).not.toMatch(/@keyframes[^{]+\{[^@]*box-shadow/);
    expect(find(f)(sel, /prefers-reduced-motion/).body).toMatch(/animation:\s*none/);
  });

  it("彈窗遮罩用主題色混出的半透明，不寫死黑色", () => {
    expect(find("_game/pronunciation-community.css")(".pron-community-modal-backdrop").body).toMatch(/color-mix\(in srgb, var\(--yy-calm-block\)/);
  });
});

describe("測驗", () => {
  it("彈窗與遮罩用主題色混出的半透明", () => {
    expect(find("_quiz/bot_study_plan.css")(".bot-animation-overlay").body).toMatch(/color-mix\(in srgb, var\(--yy-calm-block\)/);
  });

  it("AI 助手 iMessage 式氣泡（4-7）：大圓角、尾巴在靠說話者那側的下角；輸入列是浮起的圓角卡片（陰影用 elev token），不再是雙線頂框", () => {
    const f = find("_quiz/bot.css");
    expect(f(".bot .message-bubble").body).toMatch(/border-bottom-left-radius:\s*var\(--yy-radius-min\)/);
    expect(f(".user .message-bubble").body).toMatch(/border-bottom-right-radius:\s*var\(--yy-radius-min\)/);
    expect(f(".message-bubble").body).toMatch(/border-radius:\s*var\(--yy-radius-panel\)/);
    const bar = f(".input-area").body;
    expect(bar).toMatch(/border-radius:\s*var\(--yy-radius-panel\)/);
    expect(bar).toMatch(/box-shadow:\s*var\(--yy-elev-3\)/);
    expect(bar).not.toMatch(/double/);
    expect(f(".message-input").body).toMatch(/min-width:\s*0/);
    // 背景交給 .yy-glass，這裡不能再自己蓋一層不透明底
    expect(bar).not.toMatch(/background/);
  });

  it("AI 助手的樣式拆成六個檔，bot.css 只留外殼、訊息、輸入列", () => {
    ["bot_attachments", "bot_notices", "bot_entries", "bot_feedback", "bot_header"].forEach((n) => expect(css[`_quiz/${n}.css`], n).toBeTruthy());
    expect(css["_quiz/bot.css"].split(String.fromCharCode(10)).length).toBeLessThan(450);
  });

  it("聊天機器人：頁首與輸入列沒有圖樣，輸入框畫焦點框", () => {
    const f = find("_quiz/bot.css");
    expect(f(".chat-header::before").body).toMatch(/display:\s*none/);
    expect(f(".input-area::before").body).toMatch(/display:\s*none/);
    expect(f(".user .message-bubble::after").body).toMatch(/display:\s*none/);
    expect(f(".message-input:focus").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(f(".message-input").body).toMatch(/font-size:\s*16px/);
  });

  it("詞義標色除了底色還有線條樣式（底線實線／虛線／點線／雙線、頂線），每類都不同，不只靠顏色", () => {
    const f = find("_quiz/review_AI.css");
    const lines = ["color1", "color2", "color3", "color4", "color5"].map((c) => (f(`.meaning.${c}`).body.match(/border-(?:bottom|top):\s*2px \w+/) || [""])[0]);
    expect(new Set(lines).size).toBe(5);
    ["color1", "color2", "color3", "color4", "color5"].forEach((c) => {
      expect(f(`.meaning.${c}`).body, c).toMatch(/border-(?:bottom|top):\s*2px (?:solid|dashed|dotted|double)/);
    });
  });

  it("目前所在的題與側欄項目不靠陰影，改用框線", () => {
    expect(find("_quiz/quiz_answerBox.css")('.box-question-btn[aria-current="step"]').body).toMatch(/outline:\s*3px solid/);
    expect(find("_quiz/sideBar.css")(".bar-item.active").body).toMatch(/border-left:\s*7px solid var\(--yy-calm-accent\)/);
  });

  it("答對答錯回饋（4-6b）：彈簧只動 transform／opacity、只在 .is-springy 上、減少動態關閉；推薦測驗的對錯按鈕有勾叉，不只靠顏色", () => {
    const f = find("_quiz/scenario_quiz.css");
    expect(f(".scenario-quiz-feedback.is-springy").body).toMatch(/var\(--ease-spring\)/);
    expect(f(".scenario-quiz-option.is-springy .scenario-quiz-option-result").body).toMatch(/var\(--ease-spring\)/);
    const kf = [...css["_quiz/scenario_quiz.css"].matchAll(/@keyframes scenario-[\w-]+\s*\{((?:[^{}]*\{[^}]*\})+)\s*\}/g)]
      .flatMap((m) => [...m[1].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]));
    expect(kf.length).toBeGreaterThan(0);
    kf.forEach((p) => expect(["transform", "opacity"]).toContain(p));
    expect(f(".scenario-quiz-feedback.is-springy, .scenario-quiz-option.is-springy .scenario-quiz-option-result", /prefers-reduced-motion/).body).toMatch(/animation:\s*none/);
    expect(css["_quiz/scenario_quiz.css"]).not.toMatch(/infinite/);
    const r = find("_quiz/quiz_recommon_question.css");
    expect(r(".custom-btn.correct::before").body).toMatch(/content:\s*"\2713";[\s\S]*content:\s*"\2713" \/ "答對"/);
    expect(r(".custom-btn.wrong::before").body).toMatch(/content:\s*"\2717";[\s\S]*content:\s*"\2717" \/ "答錯"/);
  });

  it("結果頁分數環（4-6c）：環只用單一強調色與細線底色、用 pathLength 當百分比、沒有動畫", () => {
    const f = find("_quiz/quiz_panel_submit.css");
    expect(f(".score-ring-fill").body).toMatch(/stroke:\s*var\(--yy-calm-accent\)/);
    expect(f(".score-ring-fill").body).toMatch(/stroke-linecap:\s*butt/);
    expect(f(".score-ring-fill").body).toMatch(/stroke-dasharray:\s*var\(--ring-pct, 0\) 100/);
    expect(f(".score-ring-track").body).toMatch(/stroke:\s*var\(--yy-calm-rule\)/);
    expect(css["_quiz/quiz_panel_submit.css"]).not.toMatch(/stroke-dashoffset|@keyframes score-ring/);
  });

  it("作答專注模式：只在 html[data-quiz-focus] 下收起導覽、tab bar、頁尾、測驗選單；歸還 tab bar 保留的底部空間", () => {
    const f = find("_quiz/quiz_focus.css");
    const hide = f("html[data-quiz-focus] .navbar, html[data-quiz-focus] .yy-tabbar, html[data-quiz-focus] .yy-footer, html[data-quiz-focus] .quiz-body .bar-container, html[data-quiz-focus] .quiz-body .mobile-bar-menu").body;
    expect(hide).toMatch(/display:\s*none/);
    expect(f("html[data-quiz-focus]").body).toMatch(/--yy-tabbar-h:\s*0px/);
    // 每一條規則都要在專注模式屬性之下，不能漏出去影響別的頁
    rules["_quiz/quiz_focus.css"].forEach((r) => expect(r.selector.split(",").every((s) => s.trim().startsWith("html[data-quiz-focus]")), r.selector).toBe(true));
  });

  it("作答專注模式：大題幹（2xl，手機 xl）、是非題作答鍵釘在視窗底部（sticky、留安全區、按鍵至少 56px）", () => {
    const f = find("_quiz/quiz_focus.css");
    expect(f("html[data-quiz-focus] .panel-quiz-container .title-container p").body).toMatch(/font-size:\s*var\(--yy-text-2xl\)/);
    expect(f("html[data-quiz-focus] .panel-quiz-container .title-container p", /max-width:\s*900px/).body).toMatch(/font-size:\s*var\(--yy-text-xl\)/);
    expect(f("html[data-quiz-focus] .panel-quiz-container").body).toMatch(/overflow:\s*visible/);
    const dock = f("html[data-quiz-focus] .panel-quiz-container .answers").body;
    expect(dock).toMatch(/position:\s*sticky/);
    expect(dock).toMatch(/bottom:\s*0/);
    expect(dock).toMatch(/env\(safe-area-inset-bottom/);
    expect(f("html[data-quiz-focus] .panel-quiz-container .answers button").body).toMatch(/min-height:\s*56px/);
  });

  it("作答專注模式沒有任何動畫或轉場（鍵盤作答不加動畫）", () => {
    expect(css["_quiz/quiz_focus.css"]).not.toMatch(/animation|transition|@keyframes/);
  });

  it("測驗頁底沒有拼色圖樣", () => {
    expect(find("_quiz/index.css")(".quiz-body").body).toMatch(/background:\s*var\(--yy-calm-info-bg\)/);
  });
});
