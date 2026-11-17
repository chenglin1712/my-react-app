// 全站鍵盤快捷鍵的唯一清單（P1-8）。說明視窗（ShortcutHelp）與實際行為都從這裡讀，兩邊不會不一致。
// 每個快捷鍵都有對應的可點按鈕或可見控制項，鍵盤只是捷徑，不是唯一入口：
//   ?  → 頁尾的「鍵盤快捷鍵」按鈕
//   /  → 搜尋框本身（直接點它）
//   ← → → 詳情裡的「上一個」「下一個」按鈕；空白鍵 → 發音鈕；Esc → 關閉鈕
export const HELP_EVENT = 'yy:open-shortcut-help';

export const SHORTCUTS = [
  { key: '/', label: '跳到搜尋框', scope: '有搜尋框的頁面（單詞查詢）' },
  { key: '?', label: '開啟這份快捷鍵說明', scope: '全站' },
  // 單詞詳情開啟時（P2-9）。每一個在畫面上都有對應的按鈕：上一個／下一個、發音鈕、關閉鈕
  { key: '← →', label: '上一個、下一個詞', scope: '單詞詳情開啟時' },
  { key: '空白鍵', label: '播放或停止發音', scope: '單詞詳情開啟時（焦點在按鈕或輸入框時不觸發）' },
  { key: 'Esc', label: '關閉詳情', scope: '單詞詳情開啟時' },
];

export const openShortcutHelp = () => document.dispatchEvent(new CustomEvent(HELP_EVENT));

// 把焦點移到頁面上標記為 data-hotkey-search 的搜尋框；沒有這個元素時什麼都不做（回傳 false，讓呼叫端不要吃掉按鍵）。
// display:none／visibility:hidden 的算看不見（用 computed style 而不是量尺寸，測試環境也一致）。
const isRendered = (node) => {
  const st = getComputedStyle(node);
  return st.display !== 'none' && st.visibility !== 'hidden';
};

// 只挑看得見、沒被停用的那一個；焦點真的移過去才回傳 true。
export function focusPageSearch() {
  const el = [...document.querySelectorAll('[data-hotkey-search]')].find(
    (node) => node instanceof HTMLElement && !node.disabled && !node.closest('[hidden],[aria-hidden="true"],[inert]') && isRendered(node),
  );
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
}
