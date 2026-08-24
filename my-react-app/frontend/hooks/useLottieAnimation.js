import { useEffect, useRef } from 'react';
import lottie from 'lottie-web';

/**
 * 播放一次性狀態提示用的 Lottie 動畫：建立、播放、卸載或條件關閉時 destroy。
 * 原本 loginForm／registerForm／resetPassword／permissionProtect 四個檔案
 * 各自手刻幾乎一樣的 lottie.loadAnimation()+destroy() useEffect，只差
 * loop 開關、綁定哪個 boolean flag（或完全不綁，掛載就播，如 permissionProtect）；
 * _quiz_questions 的 5 個題型元件也各自手刻同一份「答對時播一次、播完自動隱藏」
 * 的版本，多帶了 onComplete 這個需求。
 *
 * enabled 預設 true，對應「一掛載就播」的用法；需要等某個條件成立才播放
 * （登入/註冊/改密碼成功動畫）的呼叫端自行傳入對應的 boolean flag。
 *
 * @param {object} options
 * @param {object} options.animationData Lottie 動畫 JSON。
 * @param {boolean} [options.enabled=true] 是否要播放；條件式掛載的容器（例如
 *   包在 SuccessModal 裡）也適用——effect 觸發時容器已經在 DOM 上了。
 * @param {boolean} [options.loop=true]
 * @param {'svg'|'canvas'|'html'} [options.renderer='svg']
 * @param {() => void} [options.onComplete] 動畫播完（非 loop）時呼叫一次；用 ref
 *   存最新的 callback，避免呼叫端每次 render 傳新的 inline function 就讓動畫重建。
 * @returns {import('react').RefObject} 綁到動畫容器 DOM 元素的 ref。
 */
export function useLottieAnimation({ animationData, enabled = true, loop = true, renderer = 'svg', onComplete }) {
  const containerRef = useRef(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const instance = lottie.loadAnimation({
      container: containerRef.current,
      renderer,
      loop,
      autoplay: true,
      animationData,
    });

    const handleComplete = () => onCompleteRef.current?.();
    instance.addEventListener?.('complete', handleComplete);

    return () => instance.destroy();
  }, [animationData, enabled, loop, renderer]);

  return containerRef;
}

export default useLottieAnimation;
