import { useEffect } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isVisible = (el) => {
  const style = window.getComputedStyle(el);
  return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden';
};

const getFocusable = (container) => [...container.querySelectorAll(FOCUSABLE)]
  .filter((el) => !el.hasAttribute('inert') && isVisible(el));

/**
 * 自製彈窗的鍵盤行為：
 * 1. Tab / Shift+Tab 只在彈窗內循環，不會跑到被遮住的背景頁面
 * 2. 彈窗關閉（或卸載）時，把焦點還給開啟前原本的元素
 * react-bootstrap 的 Modal 已經內建這兩件事；自己寫的彈窗（筆記詳情、成功提示）原本沒有。
 * containerRef 指向彈窗根節點（需要 tabIndex={-1} 才能在沒有可聚焦子元素時接住焦點）。
 */
export function useFocusTrap(containerRef, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const previouslyFocused = document.activeElement;

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
  }, [containerRef, active]);
}
