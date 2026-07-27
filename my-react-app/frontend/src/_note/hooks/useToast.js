import { useRef, useEffect, useState } from "react";

/** 顯示一則會自動隱藏的 toast 訊息，從 noteshare.jsx 抽出來。 */
export function useToast() {
  const [toast, setToast] = useState({ show: false, text: "" });
  const toastTimerRef = useRef(null);

  const showToast = (text, duration = 2500) => {
    setToast({ show: true, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast({ show: false, text: "" }), duration);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  return { toast, showToast };
}
