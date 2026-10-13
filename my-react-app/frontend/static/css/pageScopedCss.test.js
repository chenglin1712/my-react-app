// 路由專屬的 CSS 是 lazy 載入、載入後不會卸載，所以這些檔案裡的規則不能直接寫在
// body / button / .btn-* 這類全站共用的選擇器上，否則進過那一頁之後整站都會被改到
// （審查項 P1-9：筆記頁的 button { min-width: 100px } 曾經讓整站按鈕變寬）。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

const read = (rel) => readFileSync(resolve(dir, rel), "utf8");

// 取出所有規則的選擇器清單（略過註解與 @keyframes／@media 區塊本身的 prelude）
const selectorsOf = (css) => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(noComments))) {
    const prelude = m[1].trim();
    if (prelude.startsWith("@")) continue;
    prelude.split(",").forEach((s) => result.push(s.trim()));
  }
  return result;
};

const isGlobalElement = (sel) => /^(html|body|button|input|select|textarea|a)\b/.test(sel);
const isBareBtnClass = (sel) => /^\.(btn|morandi-blue)\b/.test(sel);

describe("路由專屬 CSS 不污染全站", () => {
  it.each(["_note/buttons.css", "_note/notestyle.css", "_game/index.css"])(
    "%s 沒有直接寫在 html/body/button 或通用 .btn-* 上的規則",
    (file) => {
      const offenders = selectorsOf(read(file)).filter(
        (sel) => isGlobalElement(sel) || isBareBtnClass(sel),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("筆記頁的根容器真的帶有 note-page，規則才套得到", () => {
    expect(read("../../src/_note/index.jsx")).toMatch(/className="yy-page note-page"/);
  });

  it("筆記頁的按鈕規則都限縮在 .note-page 底下", () => {
    const sels = selectorsOf(read("_note/buttons.css"));
    expect(sels.length).toBeGreaterThan(0);
    sels.forEach((sel) => expect(sel.startsWith(".note-page")).toBe(true));
  });
});

describe("三選一圖片題在窄螢幕不被裁切", () => {
  const css = read("_quiz/quiz_panel.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it(".quiz-multi-images 用 grid、每欄可縮小，而不是不換行的 flex", () => {
    const block = css.match(/\.quiz-multi-images\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/display:\s*grid/);
    // 軌道必須是彈性的（1fr）且最小寬為 0，否則三欄固定需要 500px，窄螢幕仍會溢出
    expect(block).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(block).toMatch(/max-width:\s*500px/);
    expect(block).not.toMatch(/display:\s*flex/);
    expect(block).not.toMatch(/minmax\(0,\s*160px\)/);
  });

  it("圖片寬度跟著欄寬，不再固定 160px", () => {
    const block = css.match(/\.quiz-multi-images img\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/width:\s*100%/);
    expect(block).not.toMatch(/width:\s*160px/);
  });

  it("選項按鈕的 transition 不用 all", () => {
    const block = css.match(/\.quiz-image-box\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).not.toMatch(/transition:\s*all/);
  });
});
