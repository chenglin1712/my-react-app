// @vitest-environment node
//
// E-13 效能與工程守門：z-index 用 token、圖片有 decoding、後台圖片有 alt、
// 入口 chunk 不再靜態引入只有少數頁面才用的 Firebase SDK。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, "..", "..");
const PROJECT = join(FRONTEND, "..");

const walk = (dir, exts) =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.some((e) => full.endsWith(e)) ? [full] : [];
  });

const rel = (file) => relative(FRONTEND, file).split(/[\\/]/).join("/");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
const isAdmin = (file) => /(^|\/)_admin\//i.test(file) || /(^|\/)admin[^/]*$/i.test(file) || /adminLogin/i.test(file);
const isTest = (file) => /\.(test|spec)\.[jt]sx?$/.test(file);

describe("z-index", () => {
  it("前台 CSS 的 z-index 不寫 50 以上的數字，一律用 --yy-z-* token", () => {
    const hits = [];
    walk(join(FRONTEND, "static", "css"), [".css"]).forEach((file) => {
      if (isAdmin(rel(file))) return;
      strip(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
        const m = line.match(/z-index:\s*(\d+)/);
        if (m && Number(m[1]) >= 50) hits.push(`${rel(file)}:${i + 1} z-index: ${m[1]}`);
      });
    });
    expect(hits).toEqual([]);
  });

  it("提示訊息（toast）的層級高於彈窗，彈窗開著時也看得到", () => {
    const theme = readFileSync(join(FRONTEND, "static/css/default/theme-v2.css"), "utf8");
    const num = (name) => Number(theme.match(new RegExp(`--yy-z-${name}:\\s*(\\d+)`))[1]);
    expect(num("toast")).toBeGreaterThan(num("overlay"));
    expect(num("overlay")).toBeGreaterThan(num("nav"));
    expect(num("float")).toBeLessThan(num("nav"));
  });
});

describe("圖片", () => {
  const jsx = walk(FRONTEND, [".jsx"])
    .map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") }))
    .filter(({ file }) => !isTest(file));

  it("前台每個 <img> 都有 decoding（不卡住主執行緒）", () => {
    const bad = [];
    jsx.filter(({ file }) => !isAdmin(file)).forEach(({ file, text }) => {
      for (const m of text.matchAll(/<img\b[\s\S]*?(?:\/>|[^=]>)/g)) {
        if (!/\bdecoding=/.test(m[0])) bad.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it("後台每個 <img> 都明確寫了 alt（內容性圖片寫描述，裝飾性寫 alt=\"\"）", () => {
    const bad = [];
    jsx.filter(({ file }) => isAdmin(file)).forEach(({ file, text }) => {
      for (const m of text.matchAll(/<img\b[\s\S]*?(?:\/>|[^=]>)/g)) {
        if (!/\balt=/.test(m[0])) bad.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
      }
    });
    expect(bad).toEqual([]);
  });
});

describe("入口 chunk", () => {
  it("firebase.js 與使用者服務不再靜態引入 Storage 與 Realtime Database SDK", () => {
    const entry = readFileSync(join(PROJECT, "firebase.js"), "utf8");
    expect(entry).not.toMatch(/^import .* from "firebase\/storage"/m);
    const service = readFileSync(join(FRONTEND, "src/userServives/userServive.jsx"), "utf8");
    expect(service).not.toMatch(/^import .* from "firebase\/database"/m);
    expect(service).toMatch(/await import\("firebase\/database"\)/);
  });

  it("沒有人再引入 framer-motion（套件已移除）", () => {
    const hits = walk(FRONTEND, [".jsx", ".js"])
      .filter((f) => !isTest(rel(f)))
      .filter((f) => /from ["']framer-motion["']/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
