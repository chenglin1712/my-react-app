// @vitest-environment node
//
// E-11 動態細節：側欄與進度條只動 transform、選取狀態不放大、Tab／步驟條有過渡、彈窗有進退場。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const rule = (text, selector) => {
  // 只比對整行的選擇器，避免「.a .b {」被當成「.b {」
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => line === `${selector} {`);
  expect(at, `找不到 ${selector}`).toBeGreaterThanOrEqual(0);
  const out = [];
  for (let k = at; k < lines.length; k += 1) {
    out.push(lines[k]);
    if (lines[k].includes("}")) break;
  }
  return out.join(" ");
};

describe("側欄與進度條只動 transform", () => {
  it("側欄用 translateX 進出，不再動 right", () => {
    const navbar = read("navigation/Navbar.css");
    const closed = rule(navbar, ".sidebar");
    expect(closed).toMatch(/transform:\s*translateX\(100%\)/);
    expect(closed).toMatch(/transition:\s*transform 280ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
    expect(closed).not.toMatch(/transition:[^;]*\bright\b/);
    expect(rule(navbar, ".sidebar.open")).toMatch(/transform:\s*translateX\(0\)/);
    expect(navbar).not.toMatch(/right:\s*-(350px|100vw)/);
  });

  it("四個進度條都用 scaleX，transition 不再動 width", () => {
    [
      ["_game/listening.css", ".listening-progress-bar"],
      ["_game/pronunciation.css", ".pron-progress-bar"],
      ["_game/sentence.css", ".sent-progress-bar"],
      ["_quiz/scenario_quiz.css", ".scenario-quiz-progress > div"],
    ].forEach(([file, selector]) => {
      const block = rule(read(file), selector);
      expect(block, file).toMatch(/transform-origin:\s*left/);
      expect(block, file).toMatch(/transition:\s*transform/);
      expect(block, file).not.toMatch(/transition:[^;]*\bwidth\b/);
    });
  });
});

describe("選取狀態與過渡", () => {
  it("選取中的族語膠囊不放大、不位移（S2-1：選取靠內縮環與勾，不靠動作）", () => {
    const theme = read("default/theme-v2.css");
    expect(rule(theme, ".yy-pill.active")).not.toMatch(/scale\(1\.06\)/);
    expect(rule(theme, ".yy-pill.active")).not.toMatch(/transform/);
    expect(rule(theme, ".yy-pill.active")).toMatch(/box-shadow:\s*inset 0 0 0 /);
    expect(rule(read("_search/index.css"), ".tribe-btn.active")).not.toMatch(/scale\(1\.06\)/);
  });

  it("TabSwitch 與 StepBar 切換有 150ms 的顏色過渡", () => {
    const theme = read("default/theme-v2.css");
    expect(rule(theme, ".yy-tabswitch__tab")).toMatch(/transition:[^;]*background-color var\(--dur-fast\)[^;]*color var\(--dur-fast\)/);
    expect(rule(theme, ".yy-step-diamond::before")).toMatch(/transition:[^;]*background-color var\(--dur-fast\)/);
    expect(rule(theme, ".yy-step-label")).toMatch(/transition:\s*color var\(--dur-fast\)/);
  });
});

describe("彈窗進退場與逐字進場", () => {
  it("成功彈窗從 scale(.94) 進場 240ms、overlay 淡入、退場 160ms", () => {
    const theme = read("default/theme-v2.css");
    expect(theme).toMatch(/@keyframes yy-pop \{\s*from \{ transform: scale\(0\.94\); opacity: 0; \}/);
    expect(rule(theme, ".yy-modal-box")).toMatch(/animation:\s*yy-pop 240ms var\(--ease-out\)/);
    expect(rule(theme, ".yy-modal-overlay")).toMatch(/animation:\s*yy-overlay-in/);
    expect(rule(theme, ".yy-modal-overlay.is-leaving")).toMatch(/yy-overlay-out 160ms/);
    expect(rule(theme, ".yy-modal-overlay.is-leaving .yy-modal-box")).toMatch(/yy-pop-out 160ms/);
  });

  it("降低動態時退場也只淡出，不位移", () => {
    const theme = read("default/theme-v2.css");
    expect(theme).toMatch(/\.yy-modal-overlay\.is-leaving[\s\S]*?yy-fade-out-reduced/);
  });

  it("逐字進場 450ms、不帶 overshoot 的彈性曲線", () => {
    const block = rule(read("default/theme-v2.css"), ".yy-char");
    expect(block).toMatch(/450ms var\(--ease-out\)/);
    expect(block).not.toMatch(/1\.25/);
  });
});
