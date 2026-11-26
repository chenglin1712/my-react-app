import { lazy } from 'react';

// 稽核 FE1-05：部署後，已經開著的分頁還記得舊版 index.html 裡的 chunk 檔名；新版上線後
// nginx 的 /assets/ 已經沒有那些舊雜湊檔（回 404），換到還沒載過的頁面時 import() 失敗，
// 原本只會被 ErrorBoundary 接住顯示「頁面發生錯誤」，再換頁也一樣。
// 這裡在「chunk 載入失敗」時自動整頁重新載入一次，讓瀏覽器拿到新版 index.html 與新檔名。
// 用 sessionStorage 記下重新載入的時間：短時間內再失敗（例如真的斷線、伺服器真的少檔）就不再重載，
// 照常交給 ErrorBoundary 顯示錯誤，避免無限重新整理。
export const CHUNK_RELOAD_KEY = 'yy-chunk-reload-at';
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

// 各瀏覽器對「動態 import 的檔案抓不到」的錯誤訊息不同（Chrome／Firefox／Safari），
// Vite 的 CSS 預載失敗則是 Unable to preload CSS。只認這幾種，元件本身的程式錯誤不觸發重載。
const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk [\w-]+ failed/i;

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_PATTERN.test(String(error.message || ''));
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * chunk 載入失敗時嘗試重新載入一次。回傳 true 表示已觸發重新載入。
 * storage、reload、now 可注入，方便測試；正式環境用 sessionStorage 與 location.reload。
 */
export function reloadOnceForChunkError(error, {
  storage = getSessionStorage(),
  reload = () => window.location.reload(),
  now = Date.now(),
} = {}) {
  if (!isChunkLoadError(error)) return false;
  // 存取不到 sessionStorage（隱私模式被擋等）時無法保證不會無限重載，寧可不重載
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
    if (last && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/** 取代 React.lazy：chunk 載入失敗時先自動重新載入一次，仍失敗才把錯誤交給 ErrorBoundary。 */
export function lazyWithRetry(factory, options) {
  return lazy(() => factory().catch((error) => {
    if (reloadOnceForChunkError(error, options)) {
      // 頁面即將重新載入：維持 Suspense 的載入畫面，不要閃一下錯誤頁
      return new Promise(() => {});
    }
    throw error;
  }));
}
