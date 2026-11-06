// @vitest-environment node
//
// 啟動畫面（Apple 化步驟 2-1）：象牙白底、單一字標淡入縮放、底部細進度線；只用系統字型；深色與減少動態有對應。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8"));
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
const shell = html.match(/<div class="boot-shell"[\s\S]*?<noscript>/)[0];

describe("啟動畫面（index.html）", () => {
  it("底色象牙白，theme-color 與 manifest 的 theme_color、background_color 同步", () => {
    expect(style).toMatch(/--boot-bg:\s*#FFF9ED;/);
    expect(html).toContain('<meta name="theme-color" content="#FFF9ED"');
    expect(manifest.theme_color).toBe("#FFF9ED");
    expect(manifest.background_color).toBe("#FFF9ED");
  });

  it("只有一個字標「原語」加一條進度線；沒有舊的方塊矩陣、粗框與硬陰影", () => {
    expect(shell).toContain(">原語<");
    expect(shell).not.toContain("boot-shell__mark");
    expect(style).not.toMatch(/box-shadow|border:\s*\d/);
    expect(style).not.toMatch(/steps\(/);
  });

  it("進度線貼底、極細（2px）", () => {
    expect(style).toMatch(/\.boot-shell__bar\s*\{[^}]*bottom:\s*0;[^}]*height:\s*2px;/);
  });

  it("只用系統字型；字標的宋體是系統宋體，不依賴網路字型", () => {
    const fam = [...style.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]);
    expect(fam.length).toBeGreaterThan(0);
    const ALLOWED = ["PingFang TC", "Microsoft JhengHei", "Songti TC", "PMingLiU", "sans-serif", "serif"];
    fam.forEach((f) => f.split(",").map((x) => x.trim().replace(/['"]/g, "")).forEach((name) => expect(ALLOWED).toContain(name)));
  });

  it("動畫只動 transform 與 opacity，並有 reduced-motion 停用版", () => {
    const frames = [...style.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]|\{[^}]*\})*)\}/g)].map((m) => m[1]);
    expect(frames.length).toBe(2);
    frames.forEach((body) => {
      const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      props.forEach((p) => expect(["opacity", "transform"]).toContain(p));
    });
    expect(style).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.boot-shell__name\s*\{\s*animation:\s*none;/);
    expect(style).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.boot-shell__bar b\s*\{\s*animation:\s*none;/);
  });

  it("深色：data-theme=dark，或 data-theme=system 且系統為深色，換成深色底與淺字", () => {
    expect(style).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--boot-bg:\s*#24282C;/);
    expect(style).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme="system"\]\s*\{[^}]*--boot-bg:\s*#24282C;/);
  });

  it("朗讀文字保留，不含內嵌腳本或事件屬性", () => {
    expect(shell).toContain('role="status"');
    expect(shell).toContain("載入中…");
    expect(shell).not.toMatch(/\son[a-z]+=/i);
  });
});
