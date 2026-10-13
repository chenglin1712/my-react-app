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
 * modal=false（右下角懸浮聊天視窗）：背景仍可操作，所以不鎖捲動、不困住 Tab；
 * Esc 只在焦點位於視窗內時才關閉；關閉時若焦點還在視窗內（或已掉到 body），才把焦點還給
 * returnFocusRef（或開啟前的元素），避免使用者已經去操作別處時搶走焦點。
 *
 * containerRef 指到彈窗最外層元素，需要 tabIndex={-1}，並自己加 role="dialog"、aria-modal、名稱。
 * 彈窗的開關動畫由呼叫端決定；鍵盤動作（Esc、Tab）一律立即生效、不加動畫。
 */
export function useDialog(containerRef, {
  active = true, onClose, scrollLock = true, initialFocusRef = null, modal = true, returnFocusRef = null,
} = {}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useFocusTrap(containerRef, active && modal, { autoFocus: !initialFocusRef });

  // 在 useFocusTrap 的 effect 之後執行：它已先記下「開啟前」的焦點，這裡再移到指定元素
  useEffect(() => {
    if (!active || !modal || !initialFocusRef) return;
    initialFocusRef.current?.focus({ preventScroll: true });
  }, [active, modal, initialFocusRef]);

  // 非 modal：自己處理初始焦點與關閉後的焦點還原
  useEffect(() => {
    if (!active || modal) return undefined;
    const previouslyFocused = document.activeElement;
    const target = initialFocusRef?.current ?? containerRef.current;
    target?.focus({ preventScroll: true });
    return () => {
      const current = document.activeElement;
      // 刻意在關閉當下才讀 ref：要的是「那一刻」的視窗與啟動鈕，不是開啟時的舊值
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const container = containerRef.current;
      const focusIsHere = !current || current === document.body || (container && container.contains(current));
      if (!focusIsHere) return;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const returnTo = returnFocusRef?.current?.isConnected ? returnFocusRef.current : previouslyFocused;
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [active, modal, initialFocusRef, containerRef, returnFocusRef]);

  useEffect(() => {
    if (!active) return undefined;
    const token = {};
    if (modal) openDialogs.push(token);
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      if (modal) {
        if (openDialogs[openDialogs.length - 1] !== token) return;
      } else if (openDialogs.length > 0 || !containerRef.current?.contains(document.activeElement)) {
        return;
      }
      event.preventDefault();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = openDialogs.indexOf(token);
      if (index !== -1) openDialogs.splice(index, 1);
    };
  }, [active, modal, containerRef]);

  useEffect(() => {
    if (!active || !modal || !scrollLock) return undefined;
    lockScroll();
    return unlockScroll;
  }, [active, modal, scrollLock]);
}
