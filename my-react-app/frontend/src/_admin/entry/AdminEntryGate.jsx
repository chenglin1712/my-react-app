import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminEntryFallback from './AdminEntryFallback';
import { prefersReducedMotion } from '../../hooks/useReducedMotion';
import { AdminEntryContext } from './adminEntryContext';

// 這個分頁（工作階段）第一次進後台才顯示入口儀式；之後在後台內換頁、重新整理都不再播。
const ENTERED_KEY = 'yy-admin-entered';
const MIN_VISIBLE_MS = 800;          // 最短可見時間：太快就換掉的載入畫面等於沒做
const MIN_VISIBLE_REDUCED_MS = 250;  // 要求降低動態的人只留一個極短的過場，不拖他們
const LEAVE_MS = 650;                // 光圈收合的時間，要和 admin-entry.css 的 admin-entry-iris 一致

const readEntered = () => {
    try {
        return window.sessionStorage.getItem(ENTERED_KEY) === '1';
    } catch {
        return false;
    }
};
const writeEntered = () => {
    try {
        window.sessionStorage.setItem(ENTERED_KEY, '1');
    } catch {
        // 存不了就下次再播一次，不影響功能
    }
};

/**
 * 後台入口儀式的閘門：蓋一層全螢幕載入畫面，等「後台殼層已掛載」且「至少顯示 800ms」之後，
 * 用光圈收合的方式切進後台。收合開始的同時通知 AdminLayout 播放側欄、頂欄與內容的進場。
 *
 * 不是假延遲：後台一準備好就開始倒數的是「最短可見時間」，不是額外加上去的等待；
 * 重新整理或同一分頁再次進入時不顯示（ENTERED_KEY），管理員每天進後台不會被擋。
 * 閘門不處理登入：未登入或沒有權限時 AdminRoute 會導走，整個閘門隨之卸載。
 */
export default function AdminEntryGate({ children }) {
    const [showOverlay] = useState(() => !readEntered());
    const [phase, setPhase] = useState(showOverlay ? 'loading' : 'done'); // loading → leaving → done
    const [ready, setReady] = useState(false);
    const startedAt = useRef(Date.now());
    const markReady = useCallback(() => setReady(true), []);

    useEffect(() => {
        if (!showOverlay || !ready || phase !== 'loading') return undefined;
        const minVisible = prefersReducedMotion() ? MIN_VISIBLE_REDUCED_MS : MIN_VISIBLE_MS;
        const wait = Math.max(0, minVisible - (Date.now() - startedAt.current));
        const leave = setTimeout(() => setPhase('leaving'), wait);
        return () => clearTimeout(leave);
    }, [showOverlay, ready, phase]);

    useEffect(() => {
        if (phase !== 'leaving') return undefined;
        const done = setTimeout(() => {
            writeEntered();
            setPhase('done');
        }, LEAVE_MS);
        return () => clearTimeout(done);
    }, [phase]);

    const value = useMemo(
        () => ({ firstEntry: showOverlay, revealed: phase !== 'loading', markReady }),
        [showOverlay, phase, markReady],
    );

    return (
        <AdminEntryContext.Provider value={value}>
            {children}
            {phase !== 'done' && (
                <AdminEntryFallback instant leaving={phase === 'leaving'} message={phase === 'leaving' ? '歡迎回來' : '正在校準管理訊號'} />
            )}
        </AdminEntryContext.Provider>
    );
}
