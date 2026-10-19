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
const NO_DECORATION = /box-shadow\s*:\s*(?!none)\S|text-shadow|gradient|rgba?\(|transition:\s*all|ease-in(?![\w-])|#[0-9a-fA-F]{3,8}\b|(?<![-\w])color:\s*(?:white|black)\b|background(?:-color)?:\s*(?:white|black)\b/;

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
    expect(card).toMatch(/border-radius:\s*var\(--yy-ui-radius\)/);
  });

  it("選中的族語不放大位移，改靠底色、框色與勾", () => {
    const sel = find("_game/index.css")(".gamehub-tribe-card.is-selected").body;
    expect(sel).not.toMatch(/transform/);
    expect(sel).toMatch(/border-color:\s*var\(--yy-calm-accent\)/);
    expect(find("_game/index.css")(".gamehub-tribe-card.is-selected .gamehub-tribe-name::before").body).toMatch(/content:\s*"\\2713"/);
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

  it("測驗頁底沒有拼色圖樣", () => {
    expect(find("_quiz/index.css")(".quiz-body").body).toMatch(/background:\s*var\(--yy-calm-info-bg\)/);
  });
});
