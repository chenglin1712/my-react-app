import { useEffect, useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

// 同時開著兩個彈窗時，Esc 只關最上面那個（後開的）。
const openDialogs = [];

let scrollLocks = 0;
let savedBodyOverflow = '';
function lockScroll() {
  if (scrollLocks === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedBodyOverflow;
}

/**
 * 自製彈窗的共同行為（審查項 P1-5）：
 *   - 焦點陷阱與關閉後還原焦點（useFocusTrap）
 *   - Esc 關閉（輸入法組字中的 Esc 不算；疊著多層時只關最上層）
 *   - 開啟期間鎖住背景捲動
 *   - 初始焦點：預設落在彈窗容器，傳 initialFocusRef 可改成指定元素（例如聊天室的輸入框）
 *
 * containerRef 指到彈窗最外層元素，需要 tabIndex={-1}，並自己加 role="dialog"、aria-modal、名稱。
 * 彈窗的開關動畫由呼叫端決定；鍵盤動作（Esc、Tab）一律立即生效、不加動畫。
 */
export function useDialog(containerRef, { active = true, onClose, scrollLock = true, initialFocusRef = null } = {}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useFocusTrap(containerRef, active, { autoFocus: !initialFocusRef });

  // 在 useFocusTrap 的 effect 之後執行：它已先記下「開啟前」的焦點，這裡再移到指定元素
  useEffect(() => {
    if (!active || !initialFocusRef) return;
    initialFocusRef.current?.focus({ preventScroll: true });
  }, [active, initialFocusRef]);

  useEffect(() => {
    if (!active) return undefined;
    const token = {};
    openDialogs.push(token);
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      if (openDialogs[openDialogs.length - 1] !== token) return;
      event.preventDefault();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = openDialogs.indexOf(token);
      if (index !== -1) openDialogs.splice(index, 1);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !scrollLock) return undefined;
    lockScroll();
    return unlockScroll;
  }, [active, scrollLock]);
}
