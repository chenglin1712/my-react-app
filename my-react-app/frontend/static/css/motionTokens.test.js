// B-3 動態基礎：motion token 存在、前台 CSS 不再用 transition: all、
// 位移型 hover 只在真的有 hover 的裝置上生效、同名 @keyframes 不互相覆蓋。
// 後台（_admin、含 admin 的檔名）用另一套樣式，不在這個檢查範圍。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));

const listCss = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listCss(full);
    return full.endsWith(".css") ? [full] : [];
  });

const rel = (file) => relative(ROOT, file).split(/[\\/]/).join("/");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const allFiles = listCss(ROOT).map((file) => ({ file: rel(file), css: strip(readFileSync(file, "utf8")) }));
const frontFiles = allFiles.filter(({ file }) => !/admin/i.test(file));

// 逐一走過每條規則，回傳 { selector, body, atRules }，atRules 是外層 @media 等的 prelude
const walkRules = (css) => {
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) {
        rules.push({ selector: prelude, body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      }
      buf = "";
    } else {
      buf += ch;
    }
  }
  return rules;
};

describe("motion token", () => {
  const theme = allFiles.find(({ file }) => file === "default/theme-v2.css").css;

  it("theme-v2 定義曲線、時長與 transition 組合", () => {
    expect(theme).toMatch(/--ease-out:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/);
    expect(theme).toMatch(/--ease-in-out:\s*cubic-bezier\(0\.77,\s*0,\s*0\.175,\s*1\)/);
    ["--dur-fast: 150ms", "--dur-base: 220ms", "--dur-flip: 400ms", "--dur-reveal: 550ms"].forEach((t) =>
      expect(theme).toContain(t),
    );
    expect(theme).toMatch(/--transition-interactive:/);
  });

  it("翻牌與捲動進場使用 token，不再是 0.6s／0.9s", () => {
    const flip = allFiles.find(({ file }) => file === "_favorite/index.css").css;
    expect(flip).toMatch(/transition:\s*transform var\(--dur-flip\) var\(--ease-in-out\)/);
    const result = allFiles.find(({ file }) => file === "_game/game_result.css").css;
    expect(result).toMatch(/transition:\s*transform var\(--dur-flip\) var\(--ease-in-out\)/);
    expect(theme).toMatch(/opacity var\(--dur-reveal\) var\(--ease-out\)/);
  });
});

describe("前台 CSS 的動態規則", () => {
  it("沒有 transition: all", () => {
    const offenders = frontFiles.filter(({ css }) => /transition(?:-property)?\s*:\s*all\b/i.test(css)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("所有含 transform 的 :hover 都包在 (hover: hover) 裡，觸控裝置才不會黏住", () => {
    const offenders = [];
    frontFiles.forEach(({ file, css }) =>
      walkRules(css).forEach(({ selector, body, atRules }) => {
        if (selector.includes(":hover") && /transform\s*:/.test(body) && !atRules.some((a) => a.includes("hover: hover"))) {
          offenders.push(`${file}: ${selector}`);
        }
      }),
    );
    expect(offenders).toEqual([]);
  });

  it("硬陰影主按鈕按下去時不會被脈動動畫蓋掉陰影", () => {
    const rules = walkRules(allFiles.find(({ file }) => file === "default/theme-v2.css").css);
    const hover = rules.find((r) => r.selector === ".yy-btn-primary:hover");
    const active = rules.find((r) => r.selector === ".yy-btn-primary:active");
    expect(hover.body).toMatch(/animation:\s*none/);
    expect(active.body).toMatch(/animation:\s*none/);
  });

  it("同名 @keyframes 不會出現在不同檔案（避免載入順序決定動畫）", () => {
    const seen = new Map();
    allFiles.forEach(({ file, css }) => {
      for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
        seen.set(m[1], [...(seen.get(m[1]) ?? []), file]);
      }
    });
    // 同一個檔案內重複定義同名 keyframes 也算（後面的會蓋掉前面的）
    const duplicated = [...seen].filter(([, files]) => files.length > 1).map(([name, files]) => `${name}: ${files.join(", ")}`);
    expect(duplicated).toEqual([]);
  });

  it("animation 簡寫的第一個 token 若是名稱，必須有對應的 @keyframes（時間寫在前面的寫法與 animation-name 清單不在檢查範圍）", () => {
    const defined = new Set();
    allFiles.forEach(({ css }) => {
      for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) defined.add(m[1]);
    });
    const missing = [];
    frontFiles.forEach(({ file, css }) => {
      for (const m of css.matchAll(/animation(?:-name)?:\s*([\w-]+)/g)) {
        const name = m[1];
        if (["none", "inherit", "initial", "unset"].includes(name)) continue;
        if (/^[\d.]/.test(name)) continue;
        if (!defined.has(name)) missing.push(`${file}: ${name}`);
      }
    });
    expect(missing).toEqual([]);
  });
});

describe("降低動態偏好", () => {
  const theme = allFiles.find(({ file }) => file === "default/theme-v2.css").css;
  // 只取 reduced-motion 區塊本身（配對大括號），避免後面不相干的規則讓測試誤通過
  const start = theme.indexOf("@media (prefers-reduced-motion: reduce)");
  let depth = 0;
  let end = start;
  for (let i = theme.indexOf("{", start); i < theme.length; i += 1) {
    if (theme[i] === "{") depth += 1;
    if (theme[i] === "}") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const reduce = theme.slice(start, end + 1);

  it("游標與流光文字固定在可見狀態", () => {
    expect(reduce).toMatch(/\.yy-terminal__cursor\s*\{[^}]*opacity:\s*1/);
    expect(reduce).toMatch(/\.yy-holo-text\s*\{[^}]*animation:\s*none/);
  });

  it("捲動進場保留 150ms 淡入而不位移", () => {
    expect(reduce).toMatch(/\.yy-reveal:not\(\.is-visible\)\s*\{[^}]*transform:\s*none/);
    expect(reduce).toMatch(/transition-property:\s*opacity/);
    expect(reduce).toMatch(/transition-duration:\s*var\(--dur-fast\)/);
  });
});

describe("等寬數字", () => {
  it("計時器與分數用 tabular-nums", () => {
    const theme = allFiles.find(({ file }) => file === "default/theme-v2.css").css;
    expect(theme).toMatch(/\.yy-tabular\s*\{\s*font-variant-numeric:\s*tabular-nums/);
    // 不用 [class*="score"] 這類寬鬆的屬性選擇器（會誤傷標籤與狀態 class），改在各元件自己的規則裡加
    expect(theme).not.toMatch(/\[class\*=/);
    const owners = [
      ["_quiz/quiz_answerBox.css", ".box-timer"],
      ["_home/dateReminder.css", ".countdown-box"],
      ["_game/pronunciation.css", ".pron-score-num"],
      ["_game/pronunciation.css", ".pron-result-score"],
      ["_game/pronunciation-community.css", ".pron-community-score"],
      ["_game/listening.css", ".listening-result-score"],
      ["_game/sentence.css", ".sent-result-score"],
      ["_camera/wizard.css", ".camera-label-score"],
    ];
    owners.forEach(([file, selector]) => {
      const found = allFiles.find((f) => f.file === file);
      const block = walkRules(found.css).find((r) => r.selector === selector);
      expect(block, `${file} ${selector}`).toBeTruthy();
      expect(block.body).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });
  });
});

// B-9（P1-23、P1-26）：常駐動畫不動 paint 屬性、導覽列動畫只在首頁、下拉選單可過渡
describe("B-9 動畫與效能", () => {
  const navbar = allFiles.find((f) => f.file === "navigation/Navbar.css");

  it("前台 CSS 不再有動 box-shadow 的 yy-pulse-glow", () => {
    frontFiles.forEach(({ file, css }) => {
      expect(css, file).not.toMatch(/yy-pulse-glow/);
    });
  });

  it("導覽列的無限循環動畫都限定在 .navbar--home 底下", () => {
    walkRules(navbar.css)
      .filter((r) => /animation\s*:[^;]*infinite/.test(r.body))
      .forEach((r) => expect(r.selector, r.selector).toMatch(/--home/));
  });

  it("導覽列跑馬燈改用 transform 平移，不再動 background-position", () => {
    expect(navbar.css).toMatch(/@keyframes yy-marquee-x[\s\S]*?translateX/);
    expect(navbar.css).not.toMatch(/animation:\s*yy-marquee\s/);
  });

  it("下拉選單用 opacity／visibility 過渡，不再靠 display:none 切換", () => {
    const base = walkRules(navbar.css).find((r) => r.selector === ".dropdown-content");
    expect(base.body).not.toMatch(/display:\s*none/);
    expect(base.body).toMatch(/visibility:\s*hidden/);
    expect(base.body).toMatch(/transform-origin:\s*top left/);
    expect(base.body).not.toMatch(/transition-interactive/);
  });
});
