// 主題偏好（D7）：預設淺色，使用者可選「淺色／深色／跟隨裝置」。
// 儲存值只認 light | dark | system（localStorage `yy-theme`），其他一律當淺色；
// 儲存值對應 <html data-theme>，樣式見 static/css/default/theme-v2.css 的 --yy-calm-* 深色區塊。
// 公開深色切換要等 S10 驗收，所以用功能旗標 VITE_ENABLE_DARK_THEME=true 才會真的套用深色並顯示切換選單；
// 旗標沒開時一律淺色（儲存值被忽略），index.html 的防閃白小腳本用同一套規則。

export const THEME_STORAGE_KEY = "yy-theme";
export const THEME_VALUES = ["light", "dark", "system"];

export const isDarkThemeEnabled = () => import.meta.env.VITE_ENABLE_DARK_THEME === "true";

export const parseTheme = (raw) => (THEME_VALUES.includes(raw) ? raw : "light");

export function readStoredTheme() {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

// 旗標沒開時，不論使用者存了什麼，畫面都是淺色
export const effectiveTheme = (preference) => (isDarkThemeEnabled() ? parseTheme(preference) : "light");

// 切換當下暫停所有元件的顏色過渡，整頁一次換好，不要各元件各自慢慢淡入
// （theme-v2.css 的 :root[data-theme-switching] 規則）
let switchingTimer = null;
function applyTheme(preference, { instant = false } = {}) {
  const root = document.documentElement;
  const next = effectiveTheme(preference);
  if (root.getAttribute("data-theme") === next) return;
  if (instant) {
    root.setAttribute("data-theme-switching", "");
    window.clearTimeout(switchingTimer);
  }
  root.setAttribute("data-theme", next);
  if (instant) {
    // 等新顏色畫出來之後再恢復過渡
    switchingTimer = window.setTimeout(() => root.removeAttribute("data-theme-switching"), 50);
  }
}

let current = readStoredTheme();
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

// 旗標沒開時偏好一律回報淺色（儲存值被忽略），元件不會根據一個看不到的 dark 走錯分支
export const getTheme = () => (isDarkThemeEnabled() ? current : "light");

export function setTheme(next) {
  const value = parseTheme(next);
  current = value;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // 無痕或封鎖儲存空間：這次瀏覽仍然有效，只是不會記住
  }
  applyTheme(value, { instant: true });
  notify();
}

// 別的分頁改了偏好，這個分頁跟著更新
const onStorage = (event) => {
  if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
  current = readStoredTheme();
  applyTheme(current, { instant: true });
  notify();
};

export function subscribe(listener) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // 沒有人訂閱的期間錯過的跨分頁變更，這裡補讀一次
    const stored = readStoredTheme();
    if (stored !== current) {
      current = stored;
      applyTheme(current);
    }
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// 啟動時呼叫一次：index.html 的小腳本通常已經設好，這裡是保險（開發模式、腳本被擋時）
export function initTheme() {
  current = readStoredTheme();
  applyTheme(current);
}
