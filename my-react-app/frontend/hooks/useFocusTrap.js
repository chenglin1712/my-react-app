import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// jsdom（單元測試環境）沒有版面計算，getClientRects() 永遠是空的，不能拿來判斷可見性
const HAS_LAYOUT = typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent);

/**
 * 判斷元素現在是不是真的看得到、點得到。以前只看 hidden、display:none、visibility:hidden，
 * 漏掉三種情況，Tab 會被移到看不見的元素上（審查項 P2-107）：
 * 1. 祖先有 aria-hidden="true" 或 inert：被輔助科技與鍵盤隔離的區塊
 * 2. 祖先是 display:none（只檢查元素自己的 display 抓不到，visibility 才會繼承）
 * 3. 零尺寸（沒有任何版面框）：getClientRects() 為空
 */
const isVisible = (el) => {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (window.getComputedStyle(el).visibility === 'hidden') return false;
  for (let node = el; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === 'none') return false;
  }
  if (HAS_LAYOUT && el.getClientRects().length === 0) return false;
  return true;
};

const getFocusable = (container) => [...container.querySelectorAll(FOCUSABLE)].filter(isVisible);

/**
 * 自製彈窗的鍵盤行為：
 * 1. 開啟時記住「開啟前」的焦點，再把焦點移進彈窗（containerRef 本身，需要 tabIndex={-1}）
 * 2. Tab / Shift+Tab 只在彈窗內循環，不會跑到被遮住的背景頁面
 * 3. 關閉（或卸載）時，把焦點還給開啟前的元素
 * react-bootstrap 的 Modal 已經內建這幾件事；自己寫的彈窗（筆記詳情、成功提示）原本沒有。
 *
 * 初始焦點一定要由這個 hook 負責：元件如果自己在另一個 effect 先 focus() 彈窗，
 * 這裡記到的「開啟前焦點」就已經是彈窗本身，關閉後焦點會掉回 body（審查項 P2-69）。
 * 不想移動焦點（例如已經有自己的初始焦點位置）時傳 { autoFocus: false }。
 */
export function useFocusTrap(containerRef, active = true, { autoFocus = true } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const previouslyFocused = document.activeElement;
    if (autoFocus && !container.contains(previouslyFocused)) container.focus();

    const handleKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      const outside = !container.contains(current);
      if (event.shiftKey && (outside || current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [containerRef, active, autoFocus]);
}
