import { useEffect, useRef } from 'react';

/**
 * 播放一次性狀態提示用的 Lottie 動畫：建立、播放、卸載或條件關閉時 destroy。
 * 原本 loginForm／registerForm／resetPassword／permissionProtect 四個檔案
 * 各自手刻幾乎一樣的 lottie.loadAnimation()+destroy() useEffect，只差
 * loop 開關、綁定哪個 boolean flag（或完全不綁，掛載就播，如 permissionProtect）；
 * _quiz_questions 的 5 個題型元件也各自手刻同一份「答對時播一次、播完自動隱藏」
 * 的版本，多帶了 onComplete 這個需求。
 *
 * 效能（P1-22）：lottie-web 與動畫 JSON 都是「需要時才動態載入」，不再進入口 chunk。
 * 無障礙：使用者開了「減少動態」時不播放，直接停在最後一幀（成功打勾、載入圈圈等
 * 靜態畫面），並在短暫停留後觸發 onComplete，讓「播完自動隱藏」的用法照樣收起來。
 * 全域 CSS 的 reduced-motion 規則管不到 JS 驅動的 lottie，所以要在這裡判斷。
 *
 * enabled 預設 true，對應「一掛載就播」的用法；需要等某個條件成立才播放
 * （登入/註冊/改密碼成功動畫）的呼叫端自行傳入對應的 boolean flag。
 *
 * @param {object} options
 * @param {object} [options.animationData] Lottie 動畫 JSON（已載入的物件）。
 * @param {() => Promise<object>} [options.loadAnimationData] 動態載入動畫 JSON 的函式；
 *   與 animationData 擇一提供，優先使用 animationData。
 * @param {boolean} [options.enabled=true] 是否要播放；條件式掛載的容器（例如
 *   包在 SuccessModal 裡）也適用——effect 觸發時容器已經在 DOM 上了。
 * @param {boolean} [options.loop=true]
 * @param {'svg'|'canvas'|'html'} [options.renderer='svg']
 * @param {() => void} [options.onComplete] 動畫播完（非 loop）時呼叫一次；用 ref
 *   存最新的 callback，避免呼叫端每次 render 傳新的 inline function 就讓動畫重建。
 * @returns {import('react').RefObject} 綁到動畫容器 DOM 元素的 ref。
 */
const REDUCED_MOTION_HOLD_MS = 1200;

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useLottieAnimation({ animationData, loadAnimationData, enabled = true, loop = true, renderer = 'svg', onComplete }) {
  const containerRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  // 載入函式通常是呼叫端的模組層常數；用 ref 存，避免換了參考就讓動畫重建
  const loaderRef = useRef(loadAnimationData);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    loaderRef.current = loadAnimationData;
  }, [onComplete, loadAnimationData]);

  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined;

    let cancelled = false;
    let instance = null;
    let holdTimer = null;
    const reduceMotion = prefersReducedMotion();

    (async () => {
      try {
        const [lottieModule, data] = await Promise.all([
          import('lottie-web'),
          animationData ?? loaderRef.current?.(),
        ]);
        // 等待期間元件可能已卸載或條件已關閉
        if (cancelled || !containerRef.current || !data) return;
        const lottie = lottieModule.default ?? lottieModule;

        instance = lottie.loadAnimation({
          container: containerRef.current,
          renderer,
          loop: reduceMotion ? false : loop,
          autoplay: !reduceMotion,
          animationData: data,
        });

        if (reduceMotion) {
          // 直接顯示最後一幀，不播放
          const lastFrame = Math.max(0, (instance.totalFrames ?? data.op ?? 1) - 1);
          instance.goToAndStop?.(lastFrame, true);
          holdTimer = setTimeout(() => onCompleteRef.current?.(), REDUCED_MOTION_HOLD_MS);
          return;
        }

        instance.addEventListener?.('complete', () => onCompleteRef.current?.());
      } catch {
        // 動畫只是裝飾；載入失敗（離線、chunk 失效）不該影響主要流程。
        // 但「播完自動隱藏」的呼叫端只靠 onComplete 收起提示畫面，所以失敗也要通知一次，
        // 否則全頁的成功提示會永遠留在畫面上。
        if (!cancelled) onCompleteRef.current?.();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(holdTimer);
      instance?.destroy();
    };
  }, [animationData, enabled, loop, renderer]);

  return containerRef;
}

export default useLottieAnimation;
