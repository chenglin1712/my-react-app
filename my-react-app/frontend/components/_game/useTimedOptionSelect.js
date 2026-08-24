import { useEffect, useRef, useState, useCallback } from "react";

/**
 * listening_game.jsx／sentence_game.jsx 共用的「選一個選項 -> 短暫停留顯示對錯
 * -> 自動進到下一題」互動骨架。兩邊原本各自手刻幾乎一樣的一份，且都有同一個
 * 問題：setTimeout 沒有在 unmount／重新開始／切換族語時清掉，reveal 期間卸載
 * 或重來，過期的 timeout 還是會在 1.4 秒後把畫面拉回去。
 *
 * beginSelection() 用 lockedRef（不是單靠 selected state）擋重複觸發：連續
 * 兩次點擊如果剛好在同一個 React 批次內、selected 的狀態更新還沒真的提交，
 * 兩次呼叫讀到的 selected 都還是 null，光靠「if (selected !== null) return」
 * 擋不住——ref 是同步、立即更新的，不會有這個問題。
 */
export function useTimedOptionSelect({ delayMs = 1400, onElapsed, resetKey } = {}) {
  const [selected, setSelected] = useState(null);
  const lockedRef = useRef(false);
  const timeoutRef = useRef(null);
  const onElapsedRef = useRef(onElapsed);

  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resetSelection = useCallback(() => {
    clearPendingTimeout();
    lockedRef.current = false;
    setSelected(null);
  }, [clearPendingTimeout]);

  // resetKey 改變（例如換一題、重新開始、切換族語）時，上一題殘留的選取狀態
  // 跟還沒觸發的 timeout 都要一併清掉。
  useEffect(() => {
    resetSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  const beginSelection = useCallback((value) => {
    if (lockedRef.current) return false;
    lockedRef.current = true;
    setSelected(value);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      lockedRef.current = false;
      setSelected(null);
      onElapsedRef.current?.();
    }, delayMs);
    return true;
  }, [delayMs]);

  return { selected, beginSelection, resetSelection };
}
