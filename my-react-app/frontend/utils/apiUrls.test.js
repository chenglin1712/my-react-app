// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL_DEFAULTS, apiUrl, configuredApiUrl } from "./apiUrls";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = readFileSync(join(FRONTEND, "..", ".env.example"), "utf8");
const exampleValues = Object.fromEntries(
  [...example.matchAll(/^VITE_API_([A-Z0-9_]+)_URL=(.*)$/gm)].map((m) => [m[1], m[2].trim()]),
);
const STREAM = "AI_BOT_STREAM"; // 功能開關，不在預設清單裡（見 apiUrls.js 的說明）

afterEach(() => vi.unstubAllEnvs());

describe("apiUrl（部署機漏設環境變數時不能打到 /undefined）", () => {
  it.each([undefined, "", "   "])("環境變數是 %j：用預設路徑", (value) => {
    vi.stubEnv("VITE_API_FAVORITES_SUMMARY_URL", value);
    expect(apiUrl("FAVORITES_SUMMARY")).toBe("/api/v1/dictionary/favorites-summary/");
    expect(configuredApiUrl("FAVORITES_SUMMARY")).toBeNull();
  });

  it("有填就用填的（去掉前後空白）", () => {
    vi.stubEnv("VITE_API_SEARCH_ALL_URL", " /custom/all/ ");
    expect(apiUrl("SEARCH_ALL")).toBe("/custom/all/");
  });

  it("沒有這個名稱時丟錯（打錯字當場發現，而不是打到 /undefined）", () => {
    expect(() => apiUrl("NOPE")).toThrow(/NOPE/);
  });

  it("每個預設值都是以 / 開頭的路徑", () => {
    Object.entries(API_URL_DEFAULTS).forEach(([name, value]) => expect(value, name).toMatch(/^\/[\w/-]*$/));
  });
});

describe("預設值與 .env.example 同一份", () => {
  it("每個預設名稱在 .env.example 都有，值一樣", () => {
    Object.entries(API_URL_DEFAULTS).forEach(([name, value]) => {
      expect(exampleValues[name], `.env.example 缺 VITE_API_${name}_URL`).toBe(value);
    });
  });

  it(".env.example 的每個 VITE_API_*_URL 都在預設清單裡（串流開關除外）", () => {
    Object.keys(exampleValues).filter((n) => n !== STREAM).forEach((name) => {
      expect(API_URL_DEFAULTS, `新增了 VITE_API_${name}_URL，請同步加到 apiUrls.js`).toHaveProperty(name);
    });
  });
});

describe("程式裡用到的名稱都有預設值", () => {
  it("每個 apiUrl('X') 的 X 都在 API_URL_DEFAULTS（漏了會在載入模組時直接丟錯）", () => {
    const BACKSLASH = String.fromCharCode(92);
    const used = new Set();
    const walkAll = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walkAll(p); return; }
      if (!/[.](jsx?|mjs)$/.test(e.name) || /[.]test[.]/.test(e.name)) return;
      for (const m of readFileSync(p, "utf8").matchAll(/apiUrl[(]['"]([A-Z0-9_]+)['"][)]/g)) used.add(`${m[1]}@${relative(FRONTEND, p).split(BACKSLASH).join("/")}`);
    });
    walkAll(FRONTEND);
    const missing = [...used].filter((u) => !(u.split("@")[0] in API_URL_DEFAULTS));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(20);
  });
});

describe("沒有人繞過 apiUrls 直接讀 VITE_API_*", () => {
  const BACKSLASH = String.fromCharCode(92);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" ? [] : walk(p);
    return /[.](jsx?|mjs)$/.test(e.name) && !/[.]test[.]/.test(e.name) ? [p] : [];
  });

  it("前台程式碼只有 apiUrls.js 讀；唯一例外是串流功能開關（bot.jsx）", () => {
    const offenders = [];
    walk(FRONTEND).forEach((file) => {
      const rel = relative(FRONTEND, file).split(BACKSLASH).join("/");
      if (rel === "utils/apiUrls.js") return;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/import[.]meta[.]env[.]VITE_API_([A-Z0-9_]+)/g)) {
        if (m[1] === "AI_BOT_STREAM_URL" && rel === "components/_quiz/bot.jsx") continue;
        offenders.push(`${rel}: ${m[0]}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
