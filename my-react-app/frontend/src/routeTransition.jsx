import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * 前台換頁的簡短交叉淡入（Apple 化 6-2）。
 *
 * 做法：瀏覽器的 View Transitions（document.startViewTransition）會先拍下舊畫面，等我們把 DOM 換成新頁，
 * 再用 CSS（theme-v2.css 的 ::view-transition-old/new(root)）淡出舊的、淡入新的。
 * React Router 的 BrowserRouter 沒有內建支援，所以這裡自己做：換頁時先讓路由與換頁副作用
 * （標題、捲回頂端、焦點）繼續看「舊的位置」，等瀏覽器拍好舊畫面才一次換成新位置。
 *
 * 直接換頁（不做轉場）的情況，全部是「立刻」換，沒有多一次 render 的延遲：
 * - 瀏覽器不支援 startViewTransition（Firefox、舊版 Safari）：完全等於沒有這支程式
 * - 使用者設定減少動態
 * - 上一頁、下一頁（POP）：瀏覽器自己會還原捲動位置，轉場反而會讓還原看起來跳動
 * - 路徑沒變（只有網址參數或錨點改變）：不是換頁
 * - 轉場過程出任何錯誤：立刻放行，頁面一定會換
 */
const DisplayedLocationContext = createContext(null);

// 保險：瀏覽器若因故（分頁在背景等）一直不呼叫更新 callback，這個時間後強制換頁，不會卡在舊頁
export const TRANSITION_FAILSAFE_MS = 1500;

export const supportsViewTransition = () => typeof document !== 'undefined' && typeof document.startViewTransition === 'function';

const prefersReducedMotion = () => {
    try {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
};

export const shouldTransition = (from, to, navigationType) => (
    navigationType !== 'POP'
    && from.pathname !== to.pathname
    && supportsViewTransition()
    && !prefersReducedMotion()
);

/** 目前畫面上實際顯示的位置；沒有 Provider（測試、後台）時就是 useLocation 的結果。 */
export function useDisplayedLocation() {
    const real = useLocation();
    return useContext(DisplayedLocationContext) ?? real;
}

export function RouteTransitionProvider({ children }) {
    const location = useLocation();
    const navigationType = useNavigationType();
    // shown：畫面上目前實際顯示的位置；releasedKey：已經放行（可以換成新位置）的那一次換頁
    const [shown, setShown] = useState(location);
    const [releasedKey, setReleasedKey] = useState(location.key);
    const latestRef = useRef(location);
    useEffect(() => { latestRef.current = location; }, [location]);

    const holding = location.key !== shown.key
        && releasedKey !== location.key
        && shouldTransition(shown, location, navigationType);
    // 不轉場時，這一個 render 就直接用新位置（沒有多一輪延遲）；shown 同步在下面更新
    if (!holding && shown.key !== location.key) setShown(location);
    const displayed = holding ? shown : location;

    useEffect(() => {
        if (!holding) return undefined;
        // 一律放行「最新」的位置：轉場進行中又換了一次頁，不能因為 key 對不上而卡住
        const release = () => flushSync(() => setReleasedKey(latestRef.current.key));
        const failsafe = setTimeout(() => setReleasedKey(latestRef.current.key), TRANSITION_FAILSAFE_MS);
        try {
            const transition = document.startViewTransition(release);
            // 被新的轉場取代（skipped）或 callback 出錯都會讓這些 promise reject，吞掉即可；頁面照樣會換
            transition.ready?.catch?.(() => {});
            transition.finished?.catch?.(() => {});
            transition.updateCallbackDone?.catch?.(() => setReleasedKey(latestRef.current.key));
        } catch {
            setReleasedKey(latestRef.current.key);
        }
        return () => clearTimeout(failsafe);
    }, [holding, location]);

    return (
        <DisplayedLocationContext.Provider value={displayed}>
            {children}
        </DisplayedLocationContext.Provider>
    );
}
