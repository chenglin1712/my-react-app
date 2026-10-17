// @vitest-environment node
//
// E-12 字級、斷點與排版：最小字級 12px、不用半階字級、100vh 都有 dvh、媒體查詢斷點只剩統一的幾個值。
// 後台（_admin、檔名含 admin）留到階段 G。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".css") ? [full] : [];
  });

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
const rel = (file) => relative(FRONTEND, file).split(/[\\/]/).join("/");
const isAdmin = (file) => /(^|\/)_admin\//i.test(file) || /(^|\/)admin[^/]*$/i.test(file) || /adminLogin/i.test(file);

const css = walk(join(FRONTEND, "static", "css"))
  .map((f) => ({ file: rel(f), text: strip(readFileSync(f, "utf8")) }))
  .filter(({ file }) => !isAdmin(file));

const scanLines = (test) => {
  const hits = [];
  css.forEach(({ file, text }) => {
    text.split("\n").forEach((line, i) => {
      if (test(line, file)) hits.push(`${file}:${i + 1}`);
    });
  });
  return hits;
};

const toPx = (value) => {
  const m = value.match(/^([0-9.]+)(px|rem)$/);
  if (!m) return null;
  return m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
};

const ruleBody = (text, selector) => {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === `${selector} {`);
  expect(at, `找不到 ${selector}`).toBeGreaterThanOrEqual(0);
  const out = [];
  for (let k = at; k < lines.length; k += 1) {
    out.push(lines[k]);
    if (lines[k].includes("}")) break;
  }
  return out.join(" ");
};
const fileText = (file) => css.find((c) => c.file === file).text;

describe("字級", () => {
  it("前台沒有小於 12px 的字（em 相對單位的裝飾符號除外）", () => {
    const hits = scanLines((line) => {
      const m = line.match(/font-size:\s*([0-9.]+(?:px|rem))/);
      return Boolean(m) && toPx(m[1]) < 12;
    });
    expect(hits).toEqual([]);
  });

  it("沒有 11.5px、12.5px 這類半階字級", () => {
    expect(scanLines((line) => /font-size:\s*\d+\.5px/.test(line))).toEqual([]);
  });

  it("原本用像素字搭中文的元素，字級仍不低於 14px（Silkscreen 已移除，字級下限保留）", () => {
    [
      ["static/css/_home/functionBtn.css", ".card-cta"],
      ["static/css/_translate/index.css", ".translate-direction-label"],
      ["static/css/_quiz/quiz_panel_start.css", ".scenario-entry-badge"],
      ["static/css/default/theme-v2.css", ".yy-eyebrow--zh"],
    ].forEach(([file, selector]) => {
      const body = ruleBody(fileText(file), selector);
      // 字級可以直接寫 px，或用 --yy-text-sm（14px）以上的 token
      const px = body.match(/font-size:\s*(\d+)px/);
      const token = body.match(/font-size:\s*var\(--yy-text-(sm|base|lg|xl|2xl|3xl)\)/);
      expect(px || token, `${file} ${selector}`).toBeTruthy();
      if (px) expect(Number(px[1]), `${file} ${selector}`).toBeGreaterThanOrEqual(14);
    });
  });

  it("行高 token 有 tight／heading／normal／loose，首頁大標用繁中偏鬆的 heading", () => {
    const theme = fileText("static/css/default/theme-v2.css");
    ["tight", "heading", "normal", "loose"].forEach((name) => {
      expect(theme).toMatch(new RegExp(`--yy-leading-${name}:\\s*[0-9.]+;`));
    });
    expect(ruleBody(fileText("static/css/_home/index.css"), ".home-title")).toMatch(/line-height:\s*var\(--yy-leading-heading\)/);
  });
});

describe("視窗高度", () => {
  it("每個 vh 宣告都有對應的 dvh（手機網址列伸縮時才不會被遮住）", () => {
    const bad = [];
    css.forEach(({ file, text }) => {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/(min-height|max-height|height):\s*([^;]*\d+vh[^;]*);/);
        if (!m) return;
        const dvh = m[2].replace(/(\d+)vh/g, "$1dvh");
        const neighbours = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
        if (!neighbours.includes(`${m[1]}: ${dvh}`)) bad.push(`${file}:${i + 1}`);
      });
    });
    expect(bad).toEqual([]);
  });
});

describe("斷點", () => {
  // 手機 600／720，平板直式 900，小桌機 1100，寬螢幕 1200；480 給小手機。導覽列自己有斷點（見下）。
  const ALLOWED = new Set([480, 600, 720, 900, 1100, 1200]);

  it("前台媒體查詢的寬度斷點只剩統一的幾個值（導覽列另計）", () => {
    const bad = [];
    css.forEach(({ file, text }) => {
      if (file === "static/css/navigation/Navbar.css") return;
      text.split("\n").forEach((line, i) => {
        if (!line.includes("@media")) return;
        for (const m of line.matchAll(/(?:max|min)-width:\s*(\d+)px/g)) {
          if (!ALLOWED.has(Number(m[1]))) bad.push(`${file}:${i + 1} ${m[0]}`);
        }
      });
    });
    expect(bad).toEqual([]);
  });

  it("導覽列的斷點是刻意獨立的（桌面導覽列塞不下才收合），改動前要實機看 1024／1180／1200", () => {
    const widths = [...fileText("static/css/navigation/Navbar.css").matchAll(/@media[^{]*(?:max|min)-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
  });
});
