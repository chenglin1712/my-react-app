// @vitest-environment node
//
// Apple 化步驟 1-6：毛玻璃材質與焦點環規則守門。
// 規則：一律附 prefers-reduced-transparency 純色降級、不支援 backdrop-filter 時退回純色、
// 模糊底圖下文字對比不低於 4.5:1（以全黑與全白底圖兩個最壞情況各算一次）、玻璃面上的焦點環有淺色光暈。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

const tokenAll = (name) => [...css.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "gm"))].map((m) => m[1].trim());
const parseRgba = (v) => {
  const m = v.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  expect(m, v).not.toBeNull();
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
};
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// 玻璃疊在底圖上的合成色：玻璃 alpha 乘玻璃色，加上 (1 - alpha) 乘底圖
const over = ({ rgb, a }, under) => rgb.map((c, i) => c * a + under[i] * (1 - a));

describe("毛玻璃 token", () => {
  ["--yy-glass-blur", "--yy-glass-saturate", "--yy-glass-bg", "--yy-glass-bg-solid", "--yy-glass-border", "--yy-glass-halo"].forEach((name) => {
    it(`${name}：淺色一個、深色兩個（跟隨裝置與手動深色）`, () => {
      const all = tokenAll(name);
      const isLightOnly = name === "--yy-glass-blur" || name === "--yy-glass-saturate";
      expect(all.length, name).toBe(isLightOnly ? 1 : 3);
      if (!isLightOnly) expect(all[1], "深色兩處一致").toBe(all[2]);
    });
  });

  it("模糊半徑不超過 24px（Safari 上大半徑很吃效能）", () => {
    expect(Number(tokenAll("--yy-glass-blur")[0].replace("px", ""))).toBeLessThanOrEqual(24);
  });
});

describe(".yy-glass 規則", () => {
  const block = (css.match(/\.yy-glass\s*\{([^}]*)\}/) || [])[1] ?? "";

  it("同時寫標準與 -webkit- 的 backdrop-filter，用 token", () => {
    expect(block).toMatch(/(?<![-\w])backdrop-filter:\s*saturate\(var\(--yy-glass-saturate\)\)\s*blur\(var\(--yy-glass-blur\)\)/);
    expect(block).toMatch(/-webkit-backdrop-filter:/);
    expect(block).toMatch(/background:\s*var\(--yy-glass-bg\)/);
  });

  it("prefers-reduced-transparency：改純色底並關掉模糊", () => {
    const m = css.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{\s*\.yy-glass\s*\{([^}]*)\}/);
    expect(m, "找不到 reduced-transparency 降級").not.toBeNull();
    expect(m[1]).toMatch(/background:\s*var\(--yy-glass-bg-solid\)/);
    expect(m[1]).toMatch(/(?<![-\w])backdrop-filter:\s*none/);
    expect(m[1]).toMatch(/-webkit-backdrop-filter:\s*none/);
  });

  it("不支援 backdrop-filter 時退回純色底", () => {
    const m = css.match(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{\s*\.yy-glass\s*\{([^}]*)\}/);
    expect(m, "找不到 @supports 降級").not.toBeNull();
    expect(m[1]).toMatch(/background:\s*var\(--yy-glass-bg-solid\)/);
  });

  it("玻璃面上的焦點環沿用 --yy-ui-focus-ring，並有淺色光暈", () => {
    const m = css.match(/\.yy-glass :focus-visible\s*\{([^}]*)\}/);
    expect(m, "找不到玻璃焦點環規則").not.toBeNull();
    expect(m[1]).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
    expect(m[1]).toMatch(/outline-offset:\s*var\(--yy-ui-focus-offset\)/);
    expect(m[1]).toMatch(/box-shadow:\s*var\(--yy-keep-shadow,\s*0 0 0 0 transparent\),\s*0 0 0 calc\(var\(--yy-ui-focus-offset\) \+ 2px\) var\(--yy-glass-halo\)/);
  });

  it("焦點環不寫死圓角：輪廓跟元件自己的圓角走", () => {
    const focus = (css.match(/\.yy-glass :focus-visible\s*\{([^}]*)\}/) || [])[1] ?? "";
    expect(focus).not.toMatch(/border-radius/);
  });
});

describe("毛玻璃對比（最壞底圖）", () => {
  // 淺色：墨色字；深色：象牙字。底圖取全黑與全白兩個極端，玻璃色以 token 實際 alpha 合成
  const lightBg = parseRgba(tokenAll("--yy-glass-bg")[0]);
  const darkBg = parseRgba(tokenAll("--yy-glass-bg")[1]);
  const textLight = hexToRgb(tokenAll("--yy-calm-text")[0]);
  const textDark = hexToRgb(tokenAll("--yy-calm-text")[1]);

  [["全黑", [0, 0, 0]], ["全白", [255, 255, 255]]].forEach(([label, under]) => {
    it(`淺色：墨色字在 ${label}底圖上的玻璃至少 4.5:1`, () => {
      expect(ratio(textLight, over(lightBg, under)), label).toBeGreaterThanOrEqual(4.5);
    });
    it(`深色：象牙字在 ${label}底圖上的玻璃至少 4.5:1`, () => {
      expect(ratio(textDark, over(darkBg, under)), label).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("降級用純色底（reduced-transparency）對文字至少 4.5:1", () => {
    const solid = tokenAll("--yy-glass-bg-solid");
    expect(ratio(textLight, hexToRgb(solid[0]))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(textDark, hexToRgb(solid[1]))).toBeGreaterThanOrEqual(4.5);
  });

  it("玻璃 alpha 不低於 0.7（太透明時文字會被底圖干擾）", () => {
    expect(lightBg.a).toBeGreaterThanOrEqual(0.7);
    expect(darkBg.a).toBeGreaterThanOrEqual(0.7);
  });
});

describe("個人資料側欄用到的其他顏色（最壞底圖）", () => {
  const lightBg = parseRgba(tokenAll("--yy-glass-bg")[0]);
  const darkBg = parseRgba(tokenAll("--yy-glass-bg")[1]);
  const worst = [["全黑", [0, 0, 0]], ["全白", [255, 255, 255]]];
  const pick = (name, i) => hexToRgb(tokenAll(name)[i]);

  worst.forEach(([label, under]) => {
    it(`次要文字（--yy-calm-text-sub）在 ${label}底圖的玻璃上，淺色與深色都至少 4.5:1`, () => {
      expect(ratio(pick("--yy-calm-text-sub", 0), over(lightBg, under)), `淺色 ${label}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(pick("--yy-calm-text-sub", 1), over(darkBg, under)), `深色 ${label}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`登出失敗的圖示（--yy-calm-danger，非文字；文字用 --yy-calm-text）在 ${label}底圖的玻璃上至少 3:1`, () => {
      expect(ratio(pick("--yy-calm-danger", 0), over(lightBg, under)), `淺色 ${label}`).toBeGreaterThanOrEqual(3);
      expect(ratio(pick("--yy-calm-danger", 1), over(darkBg, under)), `深色 ${label}`).toBeGreaterThanOrEqual(3);
    });

    it(`選項圖示（--yy-calm-accent，非文字）在 ${label}底圖的玻璃上至少 3:1`, () => {
      expect(ratio(pick("--yy-calm-accent", 0), over(lightBg, under)), `淺色 ${label}`).toBeGreaterThanOrEqual(3);
      expect(ratio(pick("--yy-calm-accent", 1), over(darkBg, under)), `深色 ${label}`).toBeGreaterThanOrEqual(3);
    });
  });

  it("深銅文字只出現在不透明的淡銅底上（登出的懸停）：在 --yy-calm-tint-copper-1 上至少 4.5:1", () => {
    expect(ratio(pick("--yy-calm-accent", 0), pick("--yy-calm-tint-copper-1", 0))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(pick("--yy-calm-accent", 1), pick("--yy-calm-tint-copper-1", 1))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Liquid Glass 頂緣高光疊上去後的對比（最壞底圖、最亮的頂端那一列）", () => {
  // 疊色順序：底圖 → 玻璃底 → 高光（高光在最上面，頂端 alpha 最高）。逐一算全黑與全白底圖
  const specular = tokenAll("--yy-glass-specular");
  const glass = [parseRgba(tokenAll("--yy-glass-bg")[0]), parseRgba(tokenAll("--yy-glass-bg")[1])];
  const texts = [
    { name: "--yy-calm-text", light: hexToRgb(tokenAll("--yy-calm-text")[0]), dark: hexToRgb(tokenAll("--yy-calm-text")[1]) },
    { name: "--yy-calm-text-sub", light: hexToRgb(tokenAll("--yy-calm-text-sub")[0]), dark: hexToRgb(tokenAll("--yy-calm-text-sub")[1]) },
  ];
  const top = (mode, under) => {
    const spec = parseRgba(specular[mode === "light" ? 0 : 1]);
    return over(spec, over(glass[mode === "light" ? 0 : 1], under));
  };

  it("高光 token：淺色一個、深色兩個（一致）", () => {
    expect(specular).toHaveLength(3);
    expect(specular[1]).toBe(specular[2]);
  });

  texts.forEach(({ name, light, dark }) => {
    [["全黑", [0, 0, 0]], ["全白", [255, 255, 255]]].forEach(([label, under]) => {
      it(`淺色：${name} 在${label}底圖＋高光上至少 4.5:1`, () => {
        expect(ratio(light, top("light", under)), `${name} ${label}`).toBeGreaterThanOrEqual(4.5);
      });
      it(`深色：${name} 在${label}底圖＋高光上至少 4.5:1`, () => {
        expect(ratio(dark, top("dark", under)), `${name} ${label}`).toBeGreaterThanOrEqual(4.5);
      });
    });
  });
});

describe("玻璃內的焦點光暈是疊加（不蓋掉子元素自己的陰影）", () => {
  const nav = readFileSync(join(ROOT, "navigation", "Navbar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const KEEP = /box-shadow:\s*var\(--yy-keep-shadow,\s*0 0 0 0 transparent\),\s*0 0 0 calc\(var\(--yy-ui-focus-offset\) \+ 2px\) var\(--yy-glass-halo\)/;

  it("三處光暈規則（.yy-glass、一般導覽列、雜誌版導覽列）都把 --yy-keep-shadow 放在前面", () => {
    expect(css.match(/\.yy-glass :focus-visible\s*\{([^}]*)\}/)[1]).toMatch(KEEP);
    expect(nav.match(/\.navbar:not\(\.navbar--magazine\) :focus-visible\s*\{([^}]*)\}/)[1]).toMatch(KEEP);
    expect(nav.match(/\.navbar--magazine :focus-visible\s*\{([^}]*)\}/)[1]).toMatch(KEEP);
  });

  it("導覽列裡有自己 box-shadow 的可聚焦元素（手機選單目前頁的強調條）把它同時寫進 --yy-keep-shadow", () => {
    const rule = nav.match(/\.menu-mobile-item\.active\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/--yy-keep-shadow:\s*inset 3px 0 0 var\(--yy-calm-accent\)/);
    expect(rule).toMatch(/box-shadow:\s*var\(--yy-keep-shadow\)/);
  });
});
