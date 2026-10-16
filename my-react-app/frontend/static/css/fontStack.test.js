// @vitest-environment node
//
// S1-1 字型與族語字符。證據來源是 fontCoverage.fixture.json：用 fontTools 讀 Google Fonts 完整 TTF 的字元對照表，
// 再用 index.html 實際請求的字型 CSS 的 unicode-range 核對「字型有字形」與「Google 真的會送出該切片」兩件事。
// 這個測試不能證明畫面長相（要人眼看字符預覽頁），只負責：字型堆疊的順序沒被改壞、候選字元都被某個會載入的字型涵蓋。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");
const REPO = join(FRONTEND, "..");

const indexHtml = readFileSync(join(REPO, "index.html"), "utf8");
const theme = readFileSync(join(ROOT, "default", "theme-v2.css"), "utf8");
const fixture = JSON.parse(readFileSync(join(ROOT, "fontCoverage.fixture.json"), "utf8"));

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const walkCss = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walkCss(full);
    return full.endsWith(".css") ? [full] : [];
  });

const token = (name) => {
  const m = stripComments(theme).match(new RegExp(`--yy-font-${name}:\\s*([^;]+);`));
  expect(m, `找不到 --yy-font-${name}`).not.toBeNull();
  return m[1].trim();
};
const families = (stack) => stack.split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, ""));

// 從 index.html 取出載入字型的 <link>（不含 noscript 內那一個）
const htmlWithoutNoscript = indexHtml.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
const fontLink = htmlWithoutNoscript.match(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/);
const loadedFamilies = () =>
  [...fontLink[1].matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, " ")));

// 已知缺口：字型有字形，但 Google 沒有把包含該碼位的切片送給 Noto Sans，所以內文堆疊拿不到。
// U+0332 組合底線出現在官方《原住民族語言書寫系統》對照表（泰雅語用底線區分 ng 與 n、g），
// 但真實字典資料有沒有用它還不確定。補上之前要先有族語老師或字典資料佐證，並在字符預覽頁用人眼看過。
// 若日後修好，這個清單必須同步清掉（下面有檢查）。
const KNOWN_GAPS = { body: ["U+0332"], heading: [] };

describe("字型載入（index.html）", () => {
  it("用 <link> 載入，並有 preconnect；不用 CSS @import", () => {
    expect(fontLink, "找不到 Google Fonts 的 <link>").not.toBeNull();
    expect(indexHtml).toMatch(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/);
    expect(indexHtml).toMatch(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/);
    const imports = walkCss(ROOT).filter((f) => /@import[^;]*fonts\.googleapis/.test(stripComments(readFileSync(f, "utf8"))));
    expect(imports).toEqual([]);
  });

  it("載入四個家族：兩個 TC，加上族語字母用的 Noto Sans / Noto Serif", () => {
    expect(loadedFamilies().sort()).toEqual(["Noto Sans", "Noto Sans TC", "Noto Serif", "Noto Serif TC"]);
  });

  it("每個家族都用可變字型區間，且 display=swap（不阻擋文字顯示）", () => {
    const url = fontLink[1];
    expect([...url.matchAll(/wght@\d+\.\.\d+/g)]).toHaveLength(4);
    expect(url).toMatch(/display=swap/);
  });

  it("<noscript> 備援載入同一個網址", () => {
    const noscript = indexHtml.match(/<noscript>\s*<link href="([^"]+)"/);
    expect(noscript?.[1]).toBe(fontLink[1]);
  });

  it("網址和涵蓋 fixture 核對的是同一個（改網址就必須重新跑 fontTools 核對）", () => {
    expect(fontLink[1]).toBe(fixture.fontsUrl);
  });

  it("Silkscreen 已移除：index.html 與所有 CSS 都不再出現", () => {
    expect(indexHtml).not.toMatch(/Silkscreen/);
    const hits = walkCss(ROOT).filter((f) => /Silkscreen/.test(stripComments(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
    // JS／JSX 的行內樣式也不可寫死（測試檔本身會提到這個字，排除）
    const walkSrc = (dir) =>
      readdirSync(dir).flatMap((name) => {
        if (name === "node_modules") return [];
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walkSrc(full);
        return /\.(jsx?|html)$/.test(full) && !/\.test\./.test(full) ? [full] : [];
      });
    const srcHits = [...walkSrc(join(FRONTEND, "src")), ...walkSrc(join(FRONTEND, "components"))].filter((f) => /Silkscreen/.test(readFileSync(f, "utf8")));
    expect(srcHits).toEqual([]);
  });

  it("fixture 記錄產生日期，且說明由腳本產生（不可手改）", () => {
    expect(fixture.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.note).toMatch(/build_font_coverage_fixture\.py/);
  });
});

describe("字型堆疊 token（theme-v2.css）", () => {
  it("內文：Noto Sans TC → Noto Sans → 系統 CJK → 通用 sans-serif", () => {
    const f = families(token("body"));
    expect(f.slice(0, 2)).toEqual(["Noto Sans TC", "Noto Sans"]);
    expect(f.at(-1)).toBe("sans-serif");
  });

  it("標題：Noto Serif TC → Noto Serif → 系統宋體 → 通用 serif", () => {
    const f = families(token("heading"));
    expect(f.slice(0, 2)).toEqual(["Noto Serif TC", "Noto Serif"]);
    expect(f.at(-1)).toBe("serif");
  });

  it("族語詞彙專用 token：Noto 在前（同一個詞不換字型），TC 在後；全站內文則必須 TC 在前（保住中文標點）", () => {
    expect(families(token("tribal")).slice(0, 2)).toEqual(["Noto Sans", "Noto Sans TC"]);
    expect(families(token("tribal-heading")).slice(0, 2)).toEqual(["Noto Serif", "Noto Serif TC"]);
    // 實測 Noto 在前會讓「⋯」「・」變成拉丁樣式，所以內文與標題 token 不可把 Noto 放在 TC 前面
    expect(families(token("body")).indexOf("Noto Sans TC")).toBeLessThan(families(token("body")).indexOf("Noto Sans"));
    expect(families(token("heading")).indexOf("Noto Serif TC")).toBeLessThan(families(token("heading")).indexOf("Noto Serif"));
  });

  it("舊的像素字 token 只是內文字型的別名", () => {
    expect(token("pixel")).toBe("var(--yy-font-body)");
  });

  it("堆疊裡的網路字型都有被 index.html 載入", () => {
    const loaded = new Set(loadedFamilies());
    const web = (stack) => families(stack).filter((f) => f.startsWith("Noto "));
    [...web(token("body")), ...web(token("heading"))].forEach((f) => expect(loaded.has(f), f).toBe(true));
  });
});

describe("族語字母涵蓋（fontCoverage.fixture.json）", () => {
  it("fixture 內容合理：包含專案程式碼實際用到的 ʼ（U+02BC），且至少 40 個字元", () => {
    expect(fixture.chars.length).toBeGreaterThanOrEqual(40);
    const glottal = fixture.chars.find((c) => c.cp === "U+02BC");
    expect(glottal?.sources).toContain("repo-code");
  });

  it("兩個 TC 字型涵蓋不了大部分候選字元，這就是要補 Noto Sans / Noto Serif 的原因", () => {
    const tcCovered = fixture.chars.filter((c) => c.coveredBy.some((f) => f.endsWith(" TC"))).length;
    expect(tcCovered / fixture.chars.length).toBeLessThan(0.5);
  });

  [["body", "token body"], ["heading", "token heading"]].forEach(([kind]) => {
    it(`${kind} 堆疊：每個候選字元都有會載入且真的會被送出的字型（已知缺口除外）`, () => {
      const stack = families(token(kind)).filter((f) => f.startsWith("Noto "));
      const gaps = new Set(KNOWN_GAPS[kind]);
      const undelivered = fixture.chars.filter((c) => !c.deliveredBy.some((f) => stack.includes(f))).map((c) => c.cp);
      expect(undelivered.filter((cp) => !gaps.has(cp))).toEqual([]);
    });

    it(`${kind} 堆疊：已知缺口清單沒有過期（缺口修好了就要從清單移除）`, () => {
      const stack = families(token(kind)).filter((f) => f.startsWith("Noto "));
      KNOWN_GAPS[kind].forEach((cp) => {
        const c = fixture.chars.find((x) => x.cp === cp);
        expect(c, cp).toBeDefined();
        expect(c.deliveredBy.some((f) => stack.includes(f)), `${cp} 已經有字型涵蓋，請從 KNOWN_GAPS 移除`).toBe(false);
      });
    });
  });
});
