import { describe, test, expect } from "vitest";
import { BOT_MIN, BOT_PRESETS, clampSize, limitsFor, loadBotSize, nextPreset, saveBotSize } from "./botSize";

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
};

describe("botSize：限制", () => {
  test("不小於下限，也不超過視窗（左右留 16px、上下留 120px）", () => {
    expect(clampSize({ w: 100, h: 100 }, { w: 1400, h: 900 })).toEqual({ w: BOT_MIN.w, h: BOT_MIN.h });
    expect(clampSize({ w: 2000, h: 2000 }, { w: 1000, h: 800 })).toEqual({ w: 720, h: 680 });
    expect(limitsFor({ w: 1000, h: 800 })).toEqual({ maxW: 720, maxH: 680 });
  });

  test("視窗比下限還小時以下限為準（CSS 再用視窗大小夾一次）", () => {
    expect(limitsFor({ w: 360, h: 500 })).toEqual({ maxW: 328, maxH: 420 });
  });
});

describe("botSize：預設三檔", () => {
  test("小 → 中 → 大 → 小", () => {
    expect(nextPreset({ w: 340, h: 480 }).id).toBe("m");
    expect(nextPreset({ w: 400, h: 620 }).id).toBe("l");
    expect(nextPreset({ w: 520, h: 760 }).id).toBe("s");
  });

  test("拖到非預設尺寸時，跳到下一個比它寬的檔，沒有就回小", () => {
    expect(nextPreset({ w: 450, h: 700 }).id).toBe("l");
    expect(nextPreset({ w: 600, h: 800 }).id).toBe(BOT_PRESETS[0].id);
  });
});

describe("botSize：記在這台瀏覽器", () => {
  test("存了再讀得回來；null 代表清掉", () => {
    const s = memoryStorage();
    saveBotSize({ w: 450, h: 700 }, s);
    expect(loadBotSize(s)).toEqual({ w: 450, h: 700 });
    saveBotSize(null, s);
    expect(loadBotSize(s)).toBeNull();
  });

  test("壞資料、不是數字、超出範圍都不會壞：壞的當作沒有，超界的夾回範圍", () => {
    expect(loadBotSize(memoryStorage({ "yy-bot-size": "{bad" }))).toBeNull();
    expect(loadBotSize(memoryStorage({ "yy-bot-size": JSON.stringify({ w: "a", h: 1 }) }))).toBeNull();
    expect(loadBotSize(memoryStorage({ "yy-bot-size": JSON.stringify({ w: 5000, h: 10 }) }))).toEqual({ w: 720, h: 420 });
  });

  test("儲存空間丟例外（私密視窗）也不會壞", () => {
    const boom = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
    expect(loadBotSize(boom)).toBeNull();
    expect(() => saveBotSize({ w: 400, h: 600 }, boom)).not.toThrow();
  });
});
