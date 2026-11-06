import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { CheckCircle2, X } from 'lucide-react';
import '../../../static/css/_admin/admin-toast.css';

/**
 * 後台共用的「儲存成功」提示（Apple 化 5-3）。
 *
 * 原本各頁在表單上方插一條綠色 Alert，把整個表單往下推，而且不會自己消失。改成浮在畫面右下角的小卡：
 * - 最多同時 3 張，超過的最舊一張先收掉；每張 5 秒後自己消失，游標停在上面或焦點在關閉鈕時暫停倒數。
 * - role="status"（aria-live polite）：報讀器會唸出來，但不搶走焦點，也不打斷正在輸入的人。
 * - 成功用圖示加文字表達，不只靠顏色。
 * - 沒有 Provider 時（單獨測試、或頁面不在後台外殼內）SuccessNotice 退回原本的行內 Alert，行為不變。
 */
const ToastContext = createContext(null);

export const TOAST_MS = 5000;
export const MAX_TOASTS = 3;

export function useAdminToast() {
    return useContext(ToastContext);
}

function Toast({ toast, onDismiss }) {
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        if (paused) return undefined;
        const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
        return () => clearTimeout(timer);
    }, [paused, toast.id, onDismiss]);
    return (
        <div
            className="admin-toast"
            role="status"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
        >
            <CheckCircle2 className="admin-toast-icon" size={20} aria-hidden="true" />
            <p className="admin-toast-text">{toast.message}</p>
            <button type="button" className="admin-toast-close" onClick={() => onDismiss(toast.id)} aria-label="關閉通知">
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    );
}

export function AdminToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(1);

    const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
    const push = useCallback((message) => {
        const text = String(message ?? '').trim();
        if (!text) return;
        const id = nextId.current++;
        setToasts((list) => [...list, { id, message: text }].slice(-MAX_TOASTS));
    }, []);

    const value = useMemo(() => ({ push }), [push]);
    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="admin-toast-region" aria-label="通知">
                {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismiss} />)}
            </div>
        </ToastContext.Provider>
    );
}

/**
 * 取代 `{success && <Alert variant="success">{success}</Alert>}`：
 * 有 Provider 時 message 一出現就丟一張 toast（同一段文字連續出現兩次，要先清成空字串再設定才會再跳一次）；
 * 沒有 Provider 時原樣顯示行內 Alert。
 */
export function SuccessNotice({ message, ...alertProps }) {
    const toast = useAdminToast();
    const push = toast?.push;
    // 記住已經送出的訊息：React 嚴格模式（開發環境）會把 effect 跑兩次，沒有這道就會跳兩張一樣的提示。
    // 訊息被清空後（下一次儲存開始）才會重新允許同一段文字再跳一次。
    const pushedRef = useRef('');
    useEffect(() => {
        if (!message) { pushedRef.current = ''; return; }
        if (push && pushedRef.current !== message) {
            pushedRef.current = message;
            push(message);
        }
    }, [push, message]);
    if (toast || !message) return null;
    return <Alert variant="success" {...alertProps}>{message}</Alert>;
}
