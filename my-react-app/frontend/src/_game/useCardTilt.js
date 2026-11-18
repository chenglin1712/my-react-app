import { useCallback, useEffect, useRef } from "react";

// 遊戲卡片的微傾斜（P4-1，純裝飾）：只在「有滑鼠、有 hover」且沒開「減少動態」時啟用，
// 觸控與鍵盤完全不受影響。最大角度很小（預設 3 度），直接寫 CSS 變數、不進 React state，
// 所以滑鼠移動不會觸發重新渲染。實際的 transform 在 _game/index.css。
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
const REDUCED = "(prefers-reduced-motion: reduce)";

export default function useCardTilt(maxDeg = 3) {
  const enabled = useRef(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const fine = window.matchMedia(FINE_POINTER);
    const reduced = window.matchMedia(REDUCED);
    const sync = () => { enabled.current = fine.matches && !reduced.matches; };
    sync();
    fine.addEventListener?.("change", sync);
    reduced.addEventListener?.("change", sync);
    return () => {
      fine.removeEventListener?.("change", sync);
      reduced.removeEventListener?.("change", sync);
    };
  }, []);

  const onPointerMove = useCallback((event) => {
    if (!enabled.current || event.pointerType !== "mouse") return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--tilt-x", `${(-y * maxDeg * 2).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(x * maxDeg * 2).toFixed(2)}deg`);
  }, [maxDeg]);

  const onPointerLeave = useCallback((event) => {
    event.currentTarget.style.removeProperty("--tilt-x");
    event.currentTarget.style.removeProperty("--tilt-y");
  }, []);

  return { onPointerMove, onPointerLeave };
}
