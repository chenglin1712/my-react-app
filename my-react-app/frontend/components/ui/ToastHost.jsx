import "../../static/css/ui/toast.css";
import { useEffect, useRef, useState } from "react";
import { subscribeToasts, dismissToast } from "@utils/toast";

const LEAVE_MS = 160; // 與 --dur-overlay-out 同步

function ToastItem({ toast }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  const close = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { dismissToast(toast.id); return; }
    setLeaving(true);
    setTimeout(() => dismissToast(toast.id), LEAVE_MS);
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  // 滑鼠停留或鍵盤焦點在裡面時暫停計時，移開後從剩餘時間繼續
  useEffect(() => {
    if (paused || leaving) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(() => closeRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, leaving]);

  return (
    <div
      className={`yy-toast${leaving ? " is-leaving" : ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
    >
      <span className="yy-toast__msg">{toast.message}</span>
      {toast.actionLabel && (
        <button
          type="button"
          className="yy-toast__action"
          onClick={() => { toast.onAction?.(); close(); }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button type="button" className="yy-toast__close" aria-label="關閉提示" onClick={close}>×</button>
    </div>
  );
}

// 全站只掛一份（AppShell）。外層 role="status"（polite），新增的提示會被報讀器念出來。
export default function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div className="yy-toasts" role="status" aria-live="polite" aria-relevant="additions">
      {items.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}
