import { useEffect, useState } from "react";

// 結算摘要用的常數與本機「上一局」存取（獨立成 .js，元件檔才只匯出元件）。

// 單字收藏統一存在 favorites 陣列裡 id === 1 的那個分類（跟 _search/index.jsx、_camera/result.jsx 同一個慣例）。
export const WORD_FAVORITES_CATEGORY_ID = 1;

// 「與上次比較」只存在這台裝置的瀏覽器（localStorage），不上傳、不跟帳號綁定；
// 每個遊戲各記一筆：上一次的答對率與時間。讀不到（無痕、被封鎖、第一次玩）就當作沒有上次紀錄。
export const readLast = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Number.isFinite(v?.pct) ? v : null;
  } catch { return null; }
};
export const writeLast = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 寫不進去就不比較 */ }
};

/** 回傳「上一次」的成績；本次成績在畫面掛載後才寫入，所以 last 永遠是上一局。 */
export function useLastResult(storageKey, pct, enabled = true) {
  const [last] = useState(() => readLast(storageKey));
  useEffect(() => {
    if (enabled) writeLast(storageKey, { pct, at: Date.now() });
  }, [storageKey, pct, enabled]);
  return last;
}
