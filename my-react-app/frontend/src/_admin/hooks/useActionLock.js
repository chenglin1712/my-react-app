import { useCallback, useRef, useState } from 'react';

/**
 * 多個互斥非同步操作共用的同步鎖（FE-9 之後的辭典編輯批次新增）。
 *
 * 光靠一個 state（例如 saving/pending）搭配按鈕的 disabled 屬性，擋不住
 * 「同一個 tick 內」的重複觸發：state 要等到下一次 render 才會反映到畫面
 * 上，這中間的空檔可以被同一顆按鈕的雙擊，或是同一組互斥操作裡的兩顆
 * 不同按鈕（例如「儲存草稿」跟「送審」）同時觸發。這個 hook 用 ref 在同一
 * 個 tick 內立刻擋下後來者，而不是等 state 更新後才生效。
 *
 * 呼叫端把同一個 instance 傳給所有應該互斥的操作（例如一個編輯頁的
 * 儲存、送審、撤回、建立刪除提案），而不是每個操作各自建立一個 —— 各自
 * 建立只能擋住自己被雙擊，擋不住「儲存」跟「送審」同時被觸發。
 *
 * @returns {{ pendingKey: string|null, isLocked: boolean, runLocked: (key: string, fn: () => Promise<any>) => Promise<any|undefined> }}
 */
export function useActionLock() {
    const lockRef = useRef(false);
    const [pendingKey, setPendingKey] = useState(null);

    const runLocked = useCallback(async (key, fn) => {
        if (lockRef.current) return undefined;

        lockRef.current = true;
        setPendingKey(key);

        try {
            return await fn();
        } finally {
            lockRef.current = false;
            setPendingKey(null);
        }
    }, []);

    return {
        pendingKey,
        isLocked: pendingKey !== null,
        runLocked,
    };
}

export default useActionLock;
