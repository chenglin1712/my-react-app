import { useEffect, useLayoutEffect, useRef } from 'react';

// 正在輸入文字的地方不觸發快捷鍵：輸入框、文字區、下拉選單、contenteditable（筆記編輯器）與 textbox 角色。
// 複雜元件（自訂下拉、遊戲鍵盤區）可在容器上加 data-hotkeys-ignore 主動退出；不一律把 role=combobox 當成打字區，
// 因為按鈕型的 combobox 並不輸入文字。
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest?.('[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="searchbox"],[role="spinbutton"],[role="listbox"],[data-hotkeys-ignore]'));
}

// 彈窗只算「看得見」的：隱藏或殘留在 DOM 裡的 aria-modal 節點不會讓快捷鍵永久失效
function modalIsOpen() {
  return [...document.querySelectorAll('[aria-modal="true"], .modal.show, .offcanvas.show')].some((node) => {
    if (node.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const st = getComputedStyle(node);
    return st.display !== 'none' && st.visibility !== 'hidden';
  });
}

/**
 * 共用的快捷鍵 hook（P1-8）。bindings 是 { 按鍵: 處理函式 }，按鍵用 KeyboardEvent.key（例如 '/'、'?'）。
 * 不觸發的情況：輸入文字中、輸入法組字中、按了 Ctrl／Meta／Alt（避免蓋掉瀏覽器與系統快捷鍵）、事件已被別處處理。
 * 處理函式回傳 false 代表「這一頁沒有可以做的事」，不呼叫 preventDefault，讓按鍵維持原本行為。
 * 鍵盤觸發的動作一律立即生效、不加動畫。
 */
export default function useHotkeys(bindings, { enabled = true } = {}) {
  const ref = useRef(bindings);
  // commit 階段（paint 之前）就更新：keydown 不會讀到上一個 render 的處理函式
  useLayoutEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // 有彈窗或側欄開著（含說明視窗自己、Bootstrap Modal／Offcanvas）時暫停頁面級快捷鍵，焦點不會被拉到背景
      if (modalIsOpen()) return;
      const handler = ref.current[event.key];
      if (typeof handler !== 'function') return;
      if (handler(event) !== false) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
