import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// themeStore 在模組載入時就讀一次 localStorage，所以每個測試都重新載入模組
const load = async () => {
  vi.resetModules();
  return import("./themeStore");
};

const root = document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  root.removeAttribute("data-theme");
  root.removeAttribute("data-theme-switching");
  vi.stubEnv("VITE_ENABLE_DARK_THEME", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("儲存值解析", () => {
  test("只認 light、dark、system，其餘一律淺色", async () => {
    const { parseTheme } = await load();
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    ["", "DARK", "auto", "1", "null", undefined, null, 0, {}].forEach((bad) => {
      expect(parseTheme(bad)).toBe("light");
    });
  });

  test("沒有儲存值、儲存值損壞時回到淺色", async () => {
    let mod = await load();
    expect(mod.readStoredTheme()).toBe("light");
    window.localStorage.setItem("yy-theme", "{broken");
    mod = await load();
    expect(mod.getTheme()).toBe("light");
  });

  test("讀取 localStorage 丟例外（無痕、封鎖儲存空間）時回到淺色", async () => {
    const { readStoredTheme } = await load();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStoredTheme()).toBe("light");
    spy.mockRestore();
  });
});

describe("功能旗標", () => {
  test("旗標沒開：儲存值被忽略，偏好與畫面一律淺色", async () => {
    vi.stubEnv("VITE_ENABLE_DARK_THEME", "");
    window.localStorage.setItem("yy-theme", "dark");
    const { getTheme, initTheme, isDarkThemeEnabled } = await load();
    expect(isDarkThemeEnabled()).toBe(false);
    expect(getTheme()).toBe("light");
    initTheme();
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  test("只有字串 true 才算開", async () => {
    for (const v of ["1", "TRUE", "yes", "false"]) {
      vi.stubEnv("VITE_ENABLE_DARK_THEME", v);
      expect((await load()).isDarkThemeEnabled()).toBe(false);
    }
    vi.stubEnv("VITE_ENABLE_DARK_THEME", "true");
    expect((await load()).isDarkThemeEnabled()).toBe(true);
  });
});

describe("套用與儲存", () => {
  test("initTheme 把儲存的偏好寫到 <html data-theme>，system 保持 system（交給 CSS 媒體查詢）", async () => {
    window.localStorage.setItem("yy-theme", "system");
    const { initTheme } = await load();
    initTheme();
    expect(root.getAttribute("data-theme")).toBe("system");
  });

  test("setTheme 寫入 localStorage、更新 data-theme、通知訂閱者", async () => {
    const { setTheme, getTheme, subscribe } = await load();
    const listener = vi.fn();
    const off = subscribe(listener);
    setTheme("dark");
    expect(window.localStorage.getItem("yy-theme")).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(getTheme()).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("setTheme 收到未知值時當淺色，不會把壞值寫進儲存空間", async () => {
    const { setTheme } = await load();
    setTheme("neon");
    expect(window.localStorage.getItem("yy-theme")).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  test("寫入 localStorage 丟例外時這次仍然生效", async () => {
    const { setTheme, getTheme } = await load();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => setTheme("dark")).not.toThrow();
    expect(getTheme()).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    spy.mockRestore();
  });

  test("切換當下暫時加上 data-theme-switching（關掉過渡），約 50ms 後移除；連點不會提早移除", async () => {
    vi.useFakeTimers();
    const { setTheme } = await load();
    setTheme("dark");
    expect(root.hasAttribute("data-theme-switching")).toBe(true);
    vi.advanceTimersByTime(30);
    setTheme("system");
    vi.advanceTimersByTime(30);
    expect(root.hasAttribute("data-theme-switching")).toBe(true);
    vi.advanceTimersByTime(30);
    expect(root.hasAttribute("data-theme-switching")).toBe(false);
  });

  test("偏好沒變就不動 DOM（初始化不會觸發切換旗號）", async () => {
    const { initTheme } = await load();
    initTheme();
    expect(root.hasAttribute("data-theme-switching")).toBe(false);
  });
});

describe("跨分頁同步", () => {
  test("別的分頁改了偏好，這個分頁跟著更新並通知訂閱者", async () => {
    const { subscribe, getTheme } = await load();
    const listener = vi.fn();
    const off = subscribe(listener);
    window.localStorage.setItem("yy-theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "yy-theme", newValue: "dark" }));
    expect(getTheme()).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(listener).toHaveBeenCalled();
    off();
  });

  test("其他鍵的 storage 事件不理會", async () => {
    const { subscribe } = await load();
    const listener = vi.fn();
    const off = subscribe(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  test("沒人訂閱的期間錯過的變更，下一次訂閱時補讀", async () => {
    const { subscribe, getTheme } = await load();
    window.localStorage.setItem("yy-theme", "system");
    const off = subscribe(() => {});
    expect(getTheme()).toBe("system");
    expect(root.getAttribute("data-theme")).toBe("system");
    off();
  });
});
