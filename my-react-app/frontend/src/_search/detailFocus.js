// 詳情面板關閉後焦點該回到哪裡（稽核 FE3-15）。
//
// 詳情面板裡可以左右換詞；關閉時應該回到「最後看的那個詞」的字卡，而不是最初點開的那張，
// 否則鍵盤使用者會被送回清單中很遠的位置。字卡的開啟鈕帶 data-word-key（見 WordCard.jsx）。
// 不同結果區塊（完全符合／相關結果）的 key 可能相同，所以先在「最初點開的那張字卡」所在的清單裡找，
// 找不到再找整頁；都找不到（例如換了查詢、那張卡已經不在畫面上）就退回最初點開的那顆按鈕，
// 它也不在了就不動焦點（交給瀏覽器預設）。

const TOGGLE_SELECTOR = '.word-card-toggle[data-word-key]';

const findIn = (root, keyName) => {
  if (!root || !keyName) return null;
  return [...root.querySelectorAll(TOGGLE_SELECTOR)].find((el) => el.dataset.wordKey === keyName) ?? null;
};

/** 回傳應該取得焦點的元素（可能是 null）。origin：最初點開詳情的那顆按鈕。 */
export function findDetailFocusTarget(keyName, origin, doc = document) {
  const originConnected = Boolean(origin?.isConnected);
  const scope = originConnected ? origin.closest('.list-group') : null;
  return findIn(scope, keyName) ?? findIn(doc, keyName) ?? (originConnected ? origin : null);
}

export function restoreDetailFocus(keyName, origin, doc = document) {
  const target = findDetailFocusTarget(keyName, origin, doc);
  target?.focus?.({ preventScroll: false });
  return target;
}
