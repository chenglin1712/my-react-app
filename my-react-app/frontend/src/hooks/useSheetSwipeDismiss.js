import { useCallback, useEffect, useRef } from 'react';

/**
 * 手機底部 sheet 的「往下滑關閉」手勢（Apple 化 6-3）。
 *
 * 設計取捨：
 * - 只在標題列（把手所在區）開始拖：內容區要能正常捲動，不跟手勢搶。標題列上的按鈕（播放、收藏、關閉）照常是按鈕。
 * - 只在手機（觸控、筆）啟用；滑鼠不拖，桌面用關閉鈕、Esc 或點背景。
 * - 速度優先於距離：快速輕彈（速度 > 0.11 px/ms，且至少滑出 16px）就關，不必拖到一半。慢慢拖要超過 sheet 高度的 35%。
 * - 往上拖不是硬卡住，而是越拉越吃力（阻尼），放手回彈。
 * - 多指保護：只認第一根手指（isPrimary 與 pointerId），拖的途中換手指或多指觸碰不會讓 sheet 跳位置。
 * - 拖動時直接改該元素的 transform（不透過 CSS 變數，避免整個 sheet 內容重算樣式），只動 transform。
 * - 減少動態：沒有收回與回彈的動畫，直接關或直接回位；手勢本身（跟手）保留，因為那是直接操作，不是裝飾動畫。
 */
export const VELOCITY_DISMISS = 0.11; // px/ms
export const MIN_FLICK_DISTANCE = 16; // px：避免輕點時的抖動被算成高速
export const DISTANCE_RATIO = 0.35;
export const MAX_OVERSCROLL = 24; // px：往上拉最多只會移動這麼遠
export const SNAP_MS = 220;

/** 往上拉（dy < 0）時的阻尼：移動量趨近 MAX_OVERSCROLL 但永遠不會硬停；往下拉原樣跟手。 */
export const dampedOffset = (dy) => {
    if (dy >= 0) return dy;
    return -MAX_OVERSCROLL * (1 - Math.exp(dy / MAX_OVERSCROLL));
};

export const shouldDismiss = ({ dy, elapsed, height }) => {
    if (!(dy > 0)) return false;
    if (height > 0 && dy >= height * DISTANCE_RATIO) return true;
    const velocity = dy / Math.max(elapsed, 1);
    return dy >= MIN_FLICK_DISTANCE && velocity > VELOCITY_DISMISS;
};

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

const prefersReducedMotion = () => {
    try {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
};

/**
 * 回傳要展開到 sheet 標題列（Offcanvas.Header）上的事件屬性。enabled 為 false 時回傳空物件。
 * onDismiss 在手放開、判定要關的那一刻就呼叫；sheet 自己的收回動畫與 Offcanvas 的退場同時進行。
 */
export default function useSheetSwipeDismiss({ enabled, onDismiss }) {
    const drag = useRef(null);
    const timers = useRef(new Set());
    const onDismissRef = useRef(onDismiss);
    useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

    const later = useCallback((fn, ms) => {
        const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
        timers.current.add(id);
    }, []);
    useEffect(() => {
        const pending = timers.current;
        return () => { pending.forEach(clearTimeout); pending.clear(); };
    }, []);

    const clearStyle = (sheet) => {
        sheet.style.transform = '';
        sheet.style.transition = '';
    };

    const onPointerDown = useCallback((event) => {
        if (drag.current) return; // 已經有一根手指在拖：多出來的手指一律忽略
        if (event.pointerType === 'mouse' || event.isPrimary === false) return;
        if (event.target?.closest?.(INTERACTIVE)) return;
        const sheet = event.currentTarget.closest('.offcanvas');
        if (!sheet) return;
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* 部分環境不支援，沒有也能拖 */ }
        sheet.style.transition = 'none';
        drag.current = { id: event.pointerId, startY: event.clientY, startTime: performance.now(), sheet, dy: 0 };
    }, []);

    const onPointerMove = useCallback((event) => {
        const current = drag.current;
        if (!current || event.pointerId !== current.id) return;
        current.dy = event.clientY - current.startY;
        current.sheet.style.transform = `translateY(${dampedOffset(current.dy)}px)`;
    }, []);

    const finish = useCallback((event, cancelled) => {
        const current = drag.current;
        if (!current || event.pointerId !== current.id) return;
        drag.current = null;
        try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* 已被釋放 */ }
        const { sheet, dy } = current;
        const height = sheet.getBoundingClientRect?.().height || 0;
        const dismiss = !cancelled && shouldDismiss({ dy, elapsed: performance.now() - current.startTime, height });
        const reduced = prefersReducedMotion();

        if (dismiss) {
            // 立刻通知關閉：Offcanvas 的背景淡出、焦點還原與卸載計時馬上開始，和下面這段收回動畫同時進行，
            // 不會串成兩段退場（畫面已經離開卻還要再等一輪才能操作）。inline 的 transform 蓋過 Bootstrap 的退場位移，所以看到的只有這一段。
            onDismissRef.current?.();
            if (!reduced) {
                sheet.style.transition = `transform ${SNAP_MS}ms var(--ease-out)`;
                sheet.style.transform = 'translateY(100%)';
            }
            later(() => clearStyle(sheet), SNAP_MS * 2);
            return;
        }
        // 回彈
        if (reduced || dy === 0) {
            clearStyle(sheet);
            return;
        }
        sheet.style.transition = `transform ${SNAP_MS}ms var(--ease-out)`;
        sheet.style.transform = '';
        later(() => { if (!drag.current) sheet.style.transition = ''; }, SNAP_MS);
    }, [later]);

    const onPointerUp = useCallback((event) => finish(event, false), [finish]);
    const onPointerCancel = useCallback((event) => finish(event, true), [finish]);

    if (!enabled) return {};
    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
