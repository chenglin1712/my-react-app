// @vitest-environment node
//
// 首頁捲動敘事 story.css 的守門（依首頁設計稿）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(ROOT, "_home", "story.css"), "utf8").replace(/\r\n/g, "\n");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

const rules = [];
{
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") { stack.push(buf.trim()); buf = ""; }
    else if (ch === "}") {
      const prelude = stack.pop();
      if (prelude !== undefined && !prelude.startsWith("@")) rules.push({ selector: prelude.replace(/\s+/g, " "), body: buf, atRules: stack.filter((p) => p.startsWith("@")) });
      buf = "";
    } else buf += ch;
  }
}
const find = (selector, at) => rules.find((r) => r.selector === selector && (at ? r.atRules.some((a) => at.test(a)) : r.atRules.length === 0));

describe("首頁捲動敘事樣式", () => {
  it("顏色全取語意 token：沒有寫死色碼、rgb()，也沒有舊風格 token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/--yy-(?:red|gold|blue|cream|ink|green|border-soft|text-muted|text-tertiary|font-pixel)\b/);
  });

  it("桌面釘住：區塊 240dvh、舞台 sticky、離上緣 80px（與 HomeStory 的 STORY_TOP 一致）、高度有上下限", () => {
    expect(find(".home-story").body).toMatch(/height:\s*calc\(100dvh \* \(1 \+ 0\.35 \* var\(--story-n, 4\)\)\)/);
    expect(find(".home-story").body).toMatch(/--story-top:\s*80px/);
    const s = find(".home-story__stage").body;
    expect(s).toMatch(/position:\s*sticky/);
    expect(s).toMatch(/top:\s*var\(--story-top\)/);
    expect(s).toMatch(/min-height:\s*520px/);
    expect(s).toMatch(/max-height:\s*720px/);
    expect(s).toMatch(/border-radius:\s*var\(--yy-radius-block\)/);
    expect(s).toMatch(/box-shadow:\s*var\(--yy-elev-3\)/);
    expect(readFileSync(join(ROOT, "..", "..", "components", "_home", "storyMath.js"), "utf8")).toMatch(/STORY_TOP = 80/);
  });

  it("位移類動態只動 transform／opacity：圖樣層、大字、進度條都用 transform，沒有 clip-path 或尺寸動畫", () => {
    expect(find(".home-story__layer").body).toMatch(/transform:\s*translateY\(100%\)/);
    expect(find(".home-story__layer").body).toMatch(/transition:\s*transform 900ms/);
    expect(find(".home-story__progress b").body).toMatch(/transform:\s*scaleX\(/);
    expect(css).not.toMatch(/clip-path|@keyframes|infinite|transition:\s*all/);
    // 轉場列表裡出現的屬性只准是 transform、opacity、background-color、max-height（說明展開）
    [...css.matchAll(/transition:\s*([^;]+);/g)].forEach((m) => {
      m[1].split(",").forEach((part) => expect(part.trim().split(/\s+/)[0], m[1]).toMatch(/^(transform|opacity|background-color|max-height|none)$/));
    });
  });

  it("不是目前這一步仍維持 3:1 的對比（不低於 0.6 透明度）；目前這一步是白底卡片加柔影", () => {
    const op = Number(find(".home-story__step").body.match(/opacity:\s*([\d.]+)/)[1]);
    expect(op).toBeGreaterThanOrEqual(0.6);
    expect(find(".home-story__step.is-on").body).toMatch(/background:\s*var\(--yy-calm-surface\)/);
    expect(find(".home-story__step.is-on").body).toMatch(/box-shadow:\s*var\(--yy-elev-2\)/);
  });

  it("字級不低於 14px；略過連結至少 44px 高、有焦點框", () => {
    [...css.matchAll(/font-size:\s*([\d.]+)px/g)].forEach((m) => expect(Number(m[1])).toBeGreaterThanOrEqual(14));
    expect(find(".home-story__skip").body).toMatch(/min-height:\s*var\(--yy-control-md\)/);
    expect(find(".home-story__skip:focus-visible").body).toMatch(/outline:\s*var\(--yy-ui-focus-ring\)/);
  });

  it("窄螢幕（900px 以下）不釘住：區塊高度自動、舞台 static、單欄、四步全部展開、只留第一層圖樣", () => {
    expect(find(".home-story", /max-width:\s*900px/).body).toMatch(/height:\s*auto/);
    const s = find(".home-story__stage", /max-width:\s*900px/).body;
    expect(s).toMatch(/position:\s*static/);
    expect(s).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(find(".home-story__step", /max-width:\s*900px/).body).toMatch(/opacity:\s*1/);
    expect(find(".home-story__step p", /max-width:\s*900px/).body).toMatch(/max-height:\s*96px/);
    expect(find(".home-story__layer:not(.is-first)", /max-width:\s*900px/).body).toMatch(/display:\s*none/);
  });

  it("減少動態：所有轉場關閉，目前步驟與換字不位移", () => {
    const r = /prefers-reduced-motion/;
    expect(find(".home-story__layer, .home-story__glyph, .home-story__step, .home-story__step p, .home-story__cue", r).body).toMatch(/transition:\s*none/);
    expect(find(".home-story__step.is-on", r).body).toMatch(/transform:\s*none/);
    expect(find(".home-story__glyph.is-swapping", r).body).toMatch(/transform:\s*none/);
  });

  it("織紋由後台為每一步指定：四種代號各有一個圖樣，圖樣只用語意色", () => {
    ["stripe", "vertical", "dots", "grid"].forEach((name) => {
      const rule = find(`.home-story__layer--${name}`);
      expect(rule, name).toBeTruthy();
      expect(rule.body).toMatch(/gradient\(/);
      expect(rule.body).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    });
    expect(css).not.toMatch(/home-story__layer--\d/);
  });

  it("5、6 步時右側清單縮一級，放得進同樣高度的舞台", () => {
    ["5", "6"].forEach((n) => expect(css).toContain(`.home-story[data-count="${n}"] .home-story__step b`));
    const rule = rules.find((r) => r.selector.includes('[data-count="6"] .home-story__step b'));
    expect(rule.body).toMatch(/font-size:\s*clamp\(18px/);
  });
});
