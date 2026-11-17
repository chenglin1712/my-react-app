// 共享元素轉場的小工具（P1-3），建立在 routeTransition.jsx 同一套 View Transitions 之上。
// 用法：withSharedTransition(() => setDetail(item), { source: clickedElement, name: 'word-detail', trigger: 'pointer' })
// 直接執行、不做轉場的情況（頁面一定會更新）：
//   - 瀏覽器不支援 startViewTransition（Firefox、舊版 Safari）
//   - 減少動態偏好
//   - 鍵盤觸發（trigger 不是 'pointer'）：鍵盤動作一律立即生效、不加動畫
//   - 轉場過程出任何錯誤
import { flushSync } from 'react-dom';
import { supportsViewTransition } from '../src/routeTransition';

const reduced = () => {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
};

export function withSharedTransition(update, { source, name, trigger = 'pointer' } = {}) {
  if (trigger !== 'pointer' || !name || !supportsViewTransition() || reduced()) {
    update();
    return null;
  }
  const previous = source?.style?.viewTransitionName;
  try {
    if (source?.style) source.style.viewTransitionName = name;
    const transition = document.startViewTransition(() => { flushSync(update); });
    const cleanup = () => { if (source?.style) source.style.viewTransitionName = previous || ''; };
    transition.finished?.then(cleanup, cleanup);
    transition.ready?.catch?.(() => {});
    return transition;
  } catch {
    if (source?.style) source.style.viewTransitionName = previous || '';
    update();
    return null;
  }
}
