import { useRef, useEffect, useState } from "react";

/**
 * 顯示一則會自動隱藏的 toast 訊息，從 noteshare.jsx 抽出來。
 *
 * - show 切換 CSS class 讓 transition 做進出場；text 在退場期間保留，字不會在淡出時消失。
 * - 可被打斷：顯示中又來新訊息，直接換字並重新計時，元素不重掛載，transition 從目前狀態接續；
 *   退場中又來新訊息，會從目前的透明度回到顯示。
 */
export function useToast() {
  const [toast, setToast] = useState({ show: false, text: "" });
  const toastTimerRef = useRef(null);

  const showToast = (text, duration = 2500) => {
    setToast({ show: true, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast((current) => ({ ...current, show: false })), duration);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  return { toast, showToast };
}
