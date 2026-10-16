import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 「清單選一筆、右邊編輯」這種頁面的選取狀態，加上未儲存內容的保護。
 *
 * 編輯區換成另一筆（或新增、刪除）時，目前這筆沒存的內容會直接消失；後台編輯長文字
 * （逐字稿、摘要）時很容易誤點。所以編輯區回報有沒有未儲存的變更（setDirty），
 * 有的話 select() 不會直接切換，而是先把目標記在 pending，由頁面顯示頁內確認。
 * 關閉分頁或重新整理時，有未儲存內容也會觸發瀏覽器的離開確認。
 *
 * force(next)：不經確認直接切換，給「儲存成功後跳到新建立的那筆」「刪除後清除選取」使用。
 */
export function useGuardedSelection(initial = null) {
    const [selected, setSelected] = useState(initial);
    const [pending, setPending] = useState(undefined);
    const [dirty, setDirtyState] = useState(false);
    const dirtyRef = useRef(false);

    const setDirty = useCallback((value) => {
        dirtyRef.current = value;
        setDirtyState(value);
    }, []);

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

    const select = useCallback((next) => {
        if (next === selected) return;
        if (dirtyRef.current) setPending(next);
        else setSelected(next);
    }, [selected]);

    const force = useCallback((next) => {
        setDirty(false);
        setPending(undefined);
        setSelected(next);
    }, [setDirty]);

    return {
        selected,
        select,
        force,
        setDirty,
        hasPending: pending !== undefined,
        confirmSwitch: () => force(pending),
        cancelSwitch: () => setPending(undefined),
    };
}

export default useGuardedSelection;
