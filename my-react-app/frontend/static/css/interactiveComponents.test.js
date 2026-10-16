// @vitest-environment node
//
// S2-1 共用互動元件（按鈕、標籤、晶片、頁籤、連結、焦點框）守門：
// 從 theme-v2.css 讀實際規則，檢查狀態齊全、觸控區、對比與「不只靠顏色」。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

// 取出某個選擇器（逐字，含逗號分組裡的獨立項）的所有宣告文字；找不到回傳空字串
const blocks = (selector) => {
  const out = [];
  for (const m of theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // 整串比對（含 :where(a, button) 這種括號內有逗號的選擇器），再逐項比對逗號分組
    const whole = m[1].trim();
    const sels = whole.split(/,(?![^()]*\))/).map((x) => x.trim());
    if (whole === selector || sels.includes(selector)) out.push(m[2]);
  }
  return out.join("\n");
};

const tokenValue = (name) => {
  const calmLight = theme.match(new RegExp(`${name}:\\s*([^;]+);`));
  return calmLight && calmLight[1].trim();
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a, b, pa) => {
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(ch(a, i) * pa + ch(b, i) * (1 - pa)).toString(16).padStart(2, "0")).join("");
};

describe("按鈕", () => {
  const shared = blocks(".yy-btn-primary");
  it("主要與外框按鈕最小高度是 44px 觸控區", () => {
    expect(shared).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(tokenValue("--yy-control-md")).toBe("44px");
  });

  it("按下縮放用共用比例 0.97，停用時不縮放", () => {
    expect(tokenValue("--yy-ui-press")).toBe("0.97");
    expect(blocks(".yy-btn-primary:active")).toMatch(/transform:\s*scale\(var\(--yy-ui-press\)\)/);
    expect(blocks(".yy-btn-primary:disabled")).toMatch(/transform:\s*none/);
    expect(blocks(".yy-btn-primary:disabled")).toMatch(/opacity:\s*0\.5/);
    expect(blocks(".yy-btn-primary:disabled")).toMatch(/cursor:\s*not-allowed/);
  });

  it("只過渡指定屬性（不用 all），時間 150ms（--dur-fast）且用 ease-out", () => {
    expect(tokenValue("--dur-fast")).toBe("150ms");
    expect(shared).not.toMatch(/transition:[^;]*\ball\b/);
    expect(shared).toMatch(/background-color var\(--dur-fast\) var\(--ease-out\)/);
    expect(shared).toMatch(/transform var\(--dur-fast\) var\(--ease-out\)/);
  });

  it("hover 只在有滑鼠的裝置生效", () => {
    const hoverRules = [...theme.matchAll(/\.yy-(?:btn-primary|btn-outline|pill|tabswitch__tab|link)[^{},]*:hover[^{]*\{/g)].map((m) => m.index);
    expect(hoverRules.length).toBeGreaterThanOrEqual(5);
    hoverRules.forEach((idx) => {
      const before = theme.slice(Math.max(0, idx - 80), idx);
      expect(before, "hover 規則要包在 @media (hover: hover) and (pointer: fine) 裡").toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*(?:\.yy-on-dark\s*)?$/);
    });
  });

  it("主要按鈕的 hover 色（往石板字色混 14%）對象牙白字仍達 4.5:1", () => {
    const accent = tokenValue("--yy-calm-accent");
    const text = tokenValue("--yy-calm-text");
    const on = tokenValue("--yy-calm-accent-on");
    expect(blocks(".yy-btn-primary:hover:not(:disabled):not([aria-disabled=\"true\"])")).toMatch(/86%/);
    expect(ratio(mix(accent, text, 0.86), on)).toBeGreaterThanOrEqual(4.5);
  });

  it("外框按鈕是透明底、細框，不用陰影", () => {
    const o = blocks(".yy-btn-outline");
    expect(o).toMatch(/background:\s*transparent/);
    expect(o).toMatch(/border-color:\s*var\(--yy-calm-line\)/);
    expect(o).not.toMatch(/box-shadow/);
  });
});

describe("標籤、晶片、頁籤", () => {
  it("三者都用 3px 圓角 token，不是膠囊", () => {
    expect(tokenValue("--yy-ui-radius")).toBe("3px");
    [".yy-eyebrow", ".yy-pill", ".yy-tabswitch"].forEach((sel) => expect(blocks(sel), sel).toMatch(/border-radius:\s*var\(--yy-ui-radius\)/));
  });

  it("標籤字色對底色達 4.5:1 且不是按鈕（沒有 cursor: pointer）", () => {
    expect(blocks(".yy-eyebrow")).not.toMatch(/cursor:\s*pointer/);
    expect(ratio(tokenValue("--yy-calm-tag"), tokenValue("--yy-calm-tag-on"))).toBeGreaterThanOrEqual(4.5);
  });

  it("晶片最小高度 44px；選取狀態不只靠顏色（有內縮環與勾）", () => {
    expect(blocks(".yy-pill")).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(blocks(".yy-pill.active")).toMatch(/box-shadow:\s*inset 0 0 0 var\(--yy-border-width\)/);
    expect(blocks(".yy-pill.active::before")).toMatch(/content:\s*"\\2713"/);
  });

  it("頁籤最小高度 44px、焦點框往內畫，選取中的頁籤焦點框改用象牙白", () => {
    expect(blocks(".yy-tabswitch__tab")).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(blocks(".yy-tabswitch__tab:focus-visible")).toMatch(/outline-offset:\s*calc\(var\(--yy-border-width\) \* -2\)/);
    expect(blocks(".yy-tabswitch__tab.active:focus-visible")).toMatch(/outline-color:\s*var\(--yy-calm-accent-on\)/);
  });
});

describe("連結與焦點框", () => {
  it("文字連結有底線，不靠顏色分辨", () => {
    const l = blocks(".yy-link");
    expect(l).toMatch(/text-decoration:\s*underline/);
    expect(l).toMatch(/color:\s*var\(--yy-calm-accent\)/);
  });

  it("焦點框至少 2px、距離 3px，顏色取 --yy-calm-focus", () => {
    expect(tokenValue("--yy-ui-focus-ring")).toMatch(/^2px solid var\(--yy-calm-focus\)$/);
    expect(tokenValue("--yy-ui-focus-offset")).toBe("3px");
  });

  it("全站焦點基線用新焦點框", () => {
    const base = blocks(':where(a, button, summary, [role="button"], [tabindex]:not([tabindex="-1"])):focus-visible');
    expect(base).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(base).toMatch(/outline-offset:\s*var\(--yy-ui-focus-offset\)/);
  });

  it("深色區塊 .yy-on-dark 重新宣告焦點框為象牙白，並提供外框按鈕與連結的淺色變體", () => {
    expect(blocks(".yy-on-dark")).toMatch(/--yy-ui-focus-ring:\s*2px solid var\(--yy-calm-focus-on-block\)/);
    expect(blocks(".yy-on-dark .yy-btn-outline")).toMatch(/color:\s*var\(--yy-calm-block-on\)/);
    expect(blocks(".yy-on-dark .yy-link")).toMatch(/color:\s*var\(--yy-calm-block-accent\)/);
    // 象牙白焦點框對石板灰區塊至少 3:1
    expect(ratio(tokenValue("--yy-calm-focus-on-block"), tokenValue("--yy-calm-block"))).toBeGreaterThanOrEqual(3);
  });

  it("勾號是裝飾（替代文字為空），高對比模式有不靠填色的選取標示", () => {
    expect(theme).toMatch(/content:\s*"\\2713"\s*\/\s*""/);
    expect(theme).toMatch(/@media \(forced-colors: active\)\s*\{[^@]*\.yy-pill\.active[^@]*\.yy-tabswitch__tab\.active/);
  });

  const walk = (dir) =>
    readdirSync(dir).flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : f.endsWith(".css") ? [f] : [];
    });
  it("前台 CSS 不再使用舊的紅色焦點框（後台還在用，階段 G 一併刪除）", () => {
    const hits = walk(ROOT)
      .map((f) => relative(ROOT, f).split(/[\\/]/).join("/"))
      .filter((r) => !/(^|\/)_admin\//.test(r) && !/(^|\/)admin[^/]*$/i.test(r))
      .flatMap((r) =>
        readFileSync(join(ROOT, r), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .map((line, i) => (/var\(--yy-focus-(ring|offset)\)/.test(line) ? `${r}:${i + 1}: ${line.trim()}` : null))
          .filter(Boolean),
      );
    expect(hits).toEqual([]);
  });
});
