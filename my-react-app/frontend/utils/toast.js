// 前台共用 toast 的小型 store（P1-6）。任何地方都能呼叫 showToast，不需要 Provider；
// 畫面由掛在 AppShell 的 <ToastHost /> 負責。想「復原」的操作傳 actionLabel 與 onAction。
// 危險操作（刪除帳號、不可還原的刪除）仍然用確認視窗，不用 toast 當唯一保護。
export const MAX_TOASTS = 3;
export const DEFAULT_DURATION = 4000; // 3–5 秒之間

let seq = 0;
let toasts = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(toasts));

export const subscribeToasts = (fn) => {
  listeners.add(fn);
  fn(toasts);
  return () => listeners.delete(fn);
};

export function showToast({ message, actionLabel, onAction, duration = DEFAULT_DURATION } = {}) {
  if (!message) return null;
  const id = ++seq;
  // 最多同時 3 則：超過就把最舊的擠掉
  toasts = [...toasts, { id, message, actionLabel, onAction, duration }].slice(-MAX_TOASTS);
  emit();
  return id;
}

export function dismissToast(id) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function resetToasts() {
  toasts = [];
  emit();
}
