import { useCallback, useContext, useEffect, useRef } from 'react';
import { IDLE_BLOCKER, UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

import { confirmAction } from '@components/ui/ConfirmDialog';

/**
 * 有未儲存內容時的離開保護（稽核 FE7a-04、FE7b-03）。
 *
 * 兩層：
 *   1. 瀏覽器層級（關分頁、重新整理、手動改網址）：beforeunload，只能用瀏覽器內建的確認框。
 *   2. 站內換頁（點連結、上一頁／下一頁、程式呼叫 navigate）：react-router 的 useBlocker，
 *      攔下後用站內的確認視窗詢問，確認才放行（blocker.proceed），取消就留在原頁（blocker.reset）。
 *      上一頁被攔下時 react-router 會自己把網址復原，畫面與網址不會對不起來。
 *
 * 只攔「換到別的路徑」：同一個路徑只改 search／hash（例如清單篩選、分頁籤）時元件不會卸載，
 * 編輯內容不會遺失，跳確認反而干擾操作。
 *
 * 頁內切換（例如文法樹換章節、換族語）不是導頁，由呼叫端自己用 confirmDiscardChanges 詢問。
 *
 * useBlocker 只能在 data router（createBrowserRouter／createMemoryRouter + RouterProvider）底下用，
 * 否則會直接丟錯。正式環境的入口是 data router（見 frontend/src/appRoutes.jsx），但多數既有元件測試
 * 是用 MemoryRouter 或根本沒有 router：那時就只掛 beforeunload，讓這些測試不必全部改寫。
 *
 * 一個 router 同一時間只認一個 blocker（react-router 的限制，多個時只用最後註冊的那個），
 * 所以同一個畫面上只能有一個元件使用這個 hook。
 *
 * @param {boolean} dirty 表單是否有尚未儲存的變更
 * @returns {{ allowNextNavigation: () => void }}
 *   allowNextNavigation：儲存成功、捨棄、核准等動作之後「緊接著」要呼叫 navigate 時先呼叫它。
 *   這時表單內容其實已經存好或已經確認放棄，但 dirty 要等下一次 render 才會變回 false，
 *   不先解除的話自己的導頁會被自己攔下來，跳出一個多餘的確認。只放行同一輪事件內的下一次導頁。
 */
export const confirmDiscardChanges = () => confirmAction({
    title: '尚未儲存的變更',
    message: '目前的編輯內容還沒有儲存，離開後會遺失。確定要離開嗎？',
    confirmLabel: '放棄變更並離開',
    cancelLabel: '繼續編輯',
});

// 非 data router 時的替身：回傳跟 useBlocker 一樣形狀的「沒有攔截」狀態
const useNoBlocker = () => IDLE_BLOCKER;

// WP-8 追加：目前掛著的每一個 guard（{ dirty, released }）。給不在編輯頁裡、卻會讓編輯頁離開的動作
// （例如側邊欄的登出）查詢「現在有沒有未儲存的內容」，並在使用者確認放棄後放行。
// 刻意不再註冊第二個 useBlocker：一個 router 同時只認一個 blocker，兩個會互相蓋掉。
const mountedGuards = new Set();

/** WP-8 追加：目前畫面上是否有任何尚未儲存的變更（給登出這類「頁面外」的離開動作先詢問用）。 */
export const hasUnsavedChanges = () => [...mountedGuards].some((entry) => entry.dirty);

/**
 * WP-8 追加：讓「目前掛著的」guard 不再攔截任何導頁，回傳恢復用的函式。
 *
 * 用在登出：使用者已經確認放棄變更，接著 signOut() 會讓 AdminRoute 因為沒有登入狀態而導頁、
 * 自己也會呼叫 navigate('/')，這些導頁的時間點不在同一輪事件裡（signOut 是非同步的，
 * auth 狀態何時通知也不一定），allowNextNavigation 那種「只放行同一輪的下一次」撐不住。
 * 這裡只作用在呼叫當下已掛著的 guard：它們隨著頁面卸載就消失，之後新掛的 guard 不受影響，
 * 不會留下「永遠不再提醒」的全域狀態。登出失敗、留在原頁時要呼叫回傳的函式恢復攔截。
 */
export function releaseUnsavedChangesGuards() {
    const released = [...mountedGuards];
    released.forEach((entry) => { entry.released = true; });
    return () => released.forEach((entry) => { entry.released = false; });
}

export function useUnsavedChangesGuard(dirty) {
    const entryRef = useRef({ dirty: false, released: false });
    useEffect(() => {
        const entry = entryRef.current;
        mountedGuards.add(entry);
        return () => { mountedGuards.delete(entry); };
    }, []);
    useEffect(() => { entryRef.current.dirty = dirty; }, [dirty]);

    useEffect(() => {
        if (!dirty) return undefined;
        const handler = (event) => {
            event.preventDefault();
            // 部分瀏覽器要求設定 returnValue 才會跳出確認
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    // 有沒有 data router 在元件的整個生命週期內不會變（元件不可能在不卸載的情況下換到另一個 router），
    // 所以這裡選定的 hook 每次 render 都是同一個，呼叫順序固定，不違反 hooks 規則。
    const inDataRouter = useContext(UNSAFE_DataRouterContext) != null;
    const useNavigationBlocker = inDataRouter ? useBlocker : useNoBlocker;

    const bypassRef = useRef(false);
    const shouldBlock = useCallback(({ currentLocation, nextLocation }) => {
        if (!dirty || entryRef.current.released || currentLocation.pathname === nextLocation.pathname) return false;
        if (bypassRef.current) {
            bypassRef.current = false;
            return false;
        }
        return true;
    }, [dirty]);
    const blocker = useNavigationBlocker(shouldBlock);

    const allowNextNavigation = useCallback(() => {
        bypassRef.current = true;
        // react-router 在 navigate() 呼叫當下就同步判斷要不要攔，所以放行只需要撐過這一輪；
        // 之後一定清掉，避免呼叫了卻沒有真的導頁時，留著的放行讓使用者之後點連結時不再被提醒。
        setTimeout(() => { bypassRef.current = false; }, 0);
    }, []);

    // 確認視窗是非同步的：等使用者回答時 blocker 物件可能已經換了一個（例如又按了一次上一頁），
    // 回答後要對「最新」的那個 blocker 放行或取消。
    const blockerRef = useRef(blocker);
    useEffect(() => { blockerRef.current = blocker; }, [blocker]);
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    // StrictMode 開發模式會把 effect 跑兩次；已經在問了就不要再開第二個視窗
    // （confirmAction 同時只允許一個視窗，第二次呼叫會直接回 false，等於自動按了取消）。
    const promptingRef = useRef(false);
    useEffect(() => {
        if (blocker.state !== 'blocked' || promptingRef.current) return;
        promptingRef.current = true;
        confirmDiscardChanges().then((confirmed) => {
            promptingRef.current = false;
            const latest = blockerRef.current;
            // 元件已經卸載時 router 已經把這個 blocker 刪掉，不能再對它 proceed／reset
            if (!mountedRef.current || latest.state !== 'blocked') return;
            if (confirmed) latest.proceed();
            else latest.reset();
        });
    }, [blocker]);

    return { allowNextNavigation };
}

export default useUnsavedChangesGuard;
