import { useEffect, useRef, useState } from "react";

export const PULL_LIMIT = 40;          // 畫面上拉到這個距離（px）以上放開才會重新整理（手指約要拉 80px）
const MAX_PULL = 64;                   // 畫面上最多顯示拉多遠（再拉也不會更遠）
const DAMPING = 0.5;                   // 手指移動 2px，畫面才動 1px

/**
 * 手機「下拉重新整理」（P6-3）。只在觸控裝置、頁面已經捲到最上面、而且手指是從上往下拉時才啟動；
 * 水平滑動、往上捲、頁面還能往上捲、多指縮放都不理它。
 * 每個手勢都有按鈕備援：頁面上本來就有「重新整理」按鈕，沒有手勢也能完成所有操作。
 * 回傳 { pull, state }：pull 是目前拉了多遠（給指示器用），state 是 "idle" | "pulling" | "ready"。
 *
 * 和瀏覽器自己的下拉（會整頁重載、iOS 還有橡皮筋）不能同時發生：
 * - 啟用期間在 <html> 設 overscroll-behavior-y: contain（要設在真正捲動的根節點上才有效），離開時還原；
 * - 確認是「從最上面往下拉」之後，在 touchmove 呼叫 preventDefault，把原生的下拉擋下來
 *   （所以這個監聽不能是 passive；只有在確定要接手時才擋，一般的捲動完全不受影響）。
 */
export function usePullToRefresh(onRefresh, { enabled = true } = {}) {
  const [pull, setPull] = useState(0);
  const startRef = useRef(null);       // { x, y } 手指按下的位置；null 表示沒有在追蹤
  const pullRef = useRef(0);
  const frameRef = useRef(0);
  const refreshRef = useRef(onRefresh);

  useEffect(() => { refreshRef.current = onRefresh; });

  useEffect(() => {
    if (!enabled) return undefined;
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) return undefined;

    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";

    // 畫面更新一個畫面幀只做一次：touchmove 很密，不要每次都讓整個頁面重繪
    const publish = () => {
      frameRef.current = 0;
      setPull(pullRef.current);
    };
    const schedule = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(publish);
    };

    const reset = () => {
      startRef.current = null;
      pullRef.current = 0;
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      setPull(0);
    };

    const onStart = (event) => {
      // 只追蹤單指；頁面還沒捲到最上面就不算（iOS 橡皮筋時 scrollY 可能是負的，那也算在最上面）
      if (event.touches.length !== 1 || window.scrollY > 0) { startRef.current = null; return; }
      startRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };

    const onMove = (event) => {
      const start = startRef.current;
      if (!start) return;
      if (event.touches.length !== 1) { reset(); return; }
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      // 往上、或橫向比直向多：不是下拉
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        if (pullRef.current > 0) reset();
        return;
      }
      // 拉的途中頁面如果又被捲動了，就放棄
      if (window.scrollY > 0) { reset(); return; }
      if (event.cancelable) event.preventDefault();       // 接手了：擋掉瀏覽器自己的下拉與橡皮筋
      pullRef.current = Math.min(MAX_PULL, dy * DAMPING);
      schedule();
    };

    const onEnd = (event) => {
      // 還有其他手指按在螢幕上：這不是「放開」，整個手勢作廢
      if (event.touches && event.touches.length > 0) { reset(); return; }
      const shouldRefresh = startRef.current !== null && pullRef.current >= PULL_LIMIT;
      reset();
      if (shouldRefresh) refreshRef.current?.();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
      root.style.overscrollBehaviorY = previousOverscroll;
      reset();                                            // 停用（例如開了彈窗）或卸載時，不留下拉到一半的狀態
    };
  }, [enabled]);

  const state = pull <= 0 ? "idle" : pull >= PULL_LIMIT ? "ready" : "pulling";
  return { pull, state };
}
