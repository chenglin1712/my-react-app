import "../../static/css/ui/toast.css";
import { useEffect, useRef, useState } from "react";
import { subscribeToasts, dismissToast } from "@utils/toast";

const LEAVE_MS = 160; // 與 --dur-overlay-out 同步

function ToastItem({ toast }) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pageHidden, setPageHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const remaining = useRef(toast.duration);
  const leaveTimer = useRef(null);
  const closed = useRef(false);
  const acted = useRef(false);
  // 滑鼠停留、鍵盤焦點在裡面、分頁在背景，三種情況都暫停計時
  const paused = hovered || pageHidden;

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { dismissToast(toast.id); return; }
    setLeaving(true);
    leaveTimer.current = setTimeout(() => dismissToast(toast.id), LEAVE_MS);
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 暫停後恢復時至少再給 1.5 秒（不超過原本的長度），讓使用者來得及看完與按復原
  useEffect(() => {
    if (paused || leaving) return undefined;
    const startedAt = Date.now();
    const timer = setTimeout(() => closeRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(Math.min(1500, toast.duration), remaining.current - (Date.now() - startedAt));
    };
  }, [paused, leaving, toast.duration]);

  // 復原只執行一次（連按、鍵盤連按都不會重複反操作）；onAction 出錯就保留這則提示，不讓例外往上冒
  const runAction = () => {
    if (acted.current || closed.current) return;
    acted.current = true;
    try {
      const result = toast.onAction?.();
      if (result && typeof result.then === "function") result.catch(() => { acted.current = false; });
    } catch {
      acted.current = false;
      return;
    }
    close();
  };

  return (
    <div
      className={`yy-toast${leaving ? " is-leaving" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHovered(false); }}
    >
      <span className="yy-toast__msg">{toast.message}</span>
      {toast.actionLabel && (
        <button
          type="button"
          className="yy-toast__action"
          onClick={runAction}
        >
          {toast.actionLabel}
        </button>
      )}
      <button type="button" className="yy-toast__close" aria-label="關閉提示" onClick={close}><span aria-hidden="true">×</span></button>
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
