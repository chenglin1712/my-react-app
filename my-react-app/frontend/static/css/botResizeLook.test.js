// @vitest-environment node
//
// AI 助手：可調整大小、玻璃材質、收合的建議與提醒——外觀守門。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const bot = read("_quiz/bot.css");
const header = read("_quiz/bot_header.css");
const notices = read("_quiz/bot_notices.css");
const theme = read("default/theme-v2.css");
const jsx = readFileSync(join(ROOT, "../../components/_quiz/bot.jsx"), "utf8");

describe("AI 助手：可調整大小", () => {
  it("寬高讀 --bot-w／--bot-h，並一律再用視窗夾住（記了多大都不會超出畫面）", () => {
    expect(bot).toMatch(/width:\s*min\(var\(--bot-w,\s*400px\),\s*calc\(100vw - 32px\)\)/);
    expect(bot).toMatch(/height:\s*min\(var\(--bot-h,\s*620px\),\s*calc\(100dvh/);
  });

  it("手機固定全寬，不套用自訂大小，也不顯示把手", () => {
    const mobile = bot.slice(bot.indexOf("@media (max-width: 600px)"));
    expect(mobile).toMatch(/left:\s*calc\(8px \+ env\(safe-area-inset-left,\s*0px\)\)/);
    expect(mobile).toMatch(/right:\s*calc\(8px \+ env\(safe-area-inset-right,\s*0px\)\)/);
    expect(mobile).toMatch(/width:\s*auto/);
    expect(header).toMatch(/@media \(max-width: 600px\)\s*\{\s*\.bot-resize\s*\{\s*display:\s*none/);
  });

  it("把手：拖曳游標、touch-action: none、有焦點環、圓角用 token、不用 transition: all", () => {
    expect(header).toMatch(/\.bot-resize\s*\{[^}]*cursor:\s*nwse-resize/);
    expect(header).toMatch(/\.bot-resize\s*\{[^}]*touch-action:\s*none/);
    expect(header).toMatch(/\.bot-resize:focus-visible\s*\{[^}]*outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(header).not.toMatch(/\.bot-resize[^}]*border-top-left-radius:\s*\d/);
    expect(header).not.toMatch(/transition:\s*all/);
  });

  it(":hover 只在 (hover: hover) and (pointer: fine) 裡", () => {
    expect(header).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.bot-resize:hover/);
  });
});

describe("AI 助手：Liquid Glass 材質", () => {
  it("對話視窗掛 yy-glass 與 yy-glass--liquid，.chat-container 自己不鋪底色", () => {
    expect(jsx).toMatch(/className="chat-container yy-glass yy-glass--liquid"/);
    const rule = bot.match(/\.chat-container\s*\{([^}]*)\}/)[1];
    expect(rule).not.toMatch(/background/);
    expect(rule).toMatch(/box-shadow:\s*var\(--yy-elev-4\)/);
  });

  it("訊息區與建議區透明（才看得到玻璃）", () => {
    expect(bot).toMatch(/\.chat-container \.messages-container,\s*\.chat-container \.suggestions-container\s*\{\s*background:\s*transparent/);
  });

  it("高光 token 淺深色都有；降級（不支援、減少透明度）時回到純色", () => {
    expect((theme.match(/--yy-glass-specular:/g) || []).length).toBe(3);
    expect(theme).toMatch(/\.yy-glass\.yy-glass--liquid\s*\{[^}]*linear-gradient\(180deg,\s*var\(--yy-glass-specular\)/);
    expect(theme).toMatch(/@supports not[^{]*\{\s*\.yy-glass\.yy-glass--liquid\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
    expect(theme).toMatch(/prefers-reduced-transparency: reduce\)\s*\{\s*\.yy-glass\.yy-glass--liquid\s*\{\s*background:\s*var\(--yy-glass-bg-solid\)/);
  });

  it("深色不加高光（alpha 0）：任何高光都會讓次要文字在全白底圖的深色玻璃上掉到 4.5:1 以下（glass.test.js 有算）", () => {
    const darks = [...theme.matchAll(/--yy-glass-specular:\s*(rgba\(255, 255, 255, 0\))\s*;/g)];
    expect(darks).toHaveLength(2);
  });
});

describe("AI 助手：收合的建議與提醒", () => {
  it("提醒預設只顯示一行，展開（data-open）才顯示全文；整段文字仍在 DOM", () => {
    expect(notices).toMatch(/\.bot-disclaimer\s*\{[^}]*-webkit-line-clamp:\s*1/);
    expect(notices).toMatch(/\.bot-note-row\[data-open="true"\] \.bot-disclaimer\s*\{[^}]*display:\s*block/);
    // 下方留白放在外層：clamp 的 overflow 會把 padding 內的第二行露出來
    expect(notices.match(/\.bot-disclaimer\s*\{([^}]*)\}/)[1]).toMatch(/padding:\s*10px 0 0 16px/);
  });

  it("展開鈕與追問建議鈕都有 44px 點擊高度", () => {
    expect(notices).toMatch(/\.bot-note-toggle\s*\{[^}]*min-height:\s*44px/);
    expect(notices).toMatch(/\.suggestions-toggle\s*\{[^}]*min-height:\s*44px/);
  });

  it("沒有 transition: all，減少動態時不縮放不旋轉", () => {
    expect(notices).not.toMatch(/transition:\s*all/);
    expect(notices).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.bot-note-toggle:active\s*\{\s*transform:\s*none/);
    expect(notices).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.suggestions-toggle svg\s*\{\s*transition:\s*none/);
  });
});
