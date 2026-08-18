import { useEffect, useState } from 'react';

/**
 * 「載入一個值，並附帶 loading／error」的最小共用單位（FE-9）。
 *
 * Dashboard.jsx 原本為四個彼此獨立的小區塊各寫了一次同樣的
 * `const [value] / const [loading] / const [error]` 三件組，加上一個帶
 * `active` 旗標避免 unmount 後 setState 的 useEffect——四份逐字幾乎一樣，
 * 光是這段就佔了整支檔案將近一百行。
 *
 * 這裡刻意做得很小：只處理「取一個值」。需要分頁的用
 * useAdminListQuery、需要日期區間篩選的用 useAnalyticsQuery，不要把三者
 * 合成一個什麼都能做的資料層。
 *
 * 刻意只用 `enabled` 當重新取值的觸發條件，不提供自訂依賴陣列。原本有一個
 * `deps` 參數並以 `[enabled, ...deps]` 展開，但那有兩個問題：React 要求依賴
 * 陣列長度在多次 render 之間固定，spread 讓呼叫端可以違反這一點；而且自訂
 * 依賴陣列等於繞過 exhaustive-deps 的靜態檢查，改用註解去承諾「fetcher 沒有
 * 捕捉其他會變的值」。實際檢查後，唯一傳 deps 的呼叫點傳的是
 * `deps: [canViewAudit]`，而 `enabled` 本來就是 canViewAudit——完全冗餘。
 * 與其替一個沒有使用者的參數設計更安全的版本，不如先移除；真的出現需要
 * 依外部值重新取值的情境時，再由那個實際案例決定形狀。
 *
 * @param {Function} fetcher 回傳 Promise 的取值函式；請自行在裡面做資料整形
 *   （例如把回應攤平成一個數字），這個 hook 不對回傳值做任何假設。
 *   注意 fetcher 只在 enabled 改變時才會重跑，不要讓它捕捉其他會變動的值。
 * @param {object}  [options]
 * @param {boolean} [options.enabled=true] false 時不執行，loading 直接為 false。
 * @param {*}       [options.initialValue=null]
 */
export function useAsyncValue(fetcher, { enabled = true, initialValue = null } = {}) {
    const [value, setValue] = useState(initialValue);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError('');

        (async () => {
            try {
                const result = await fetcher();
                if (active) setValue(result);
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
        // fetcher 是呼叫端每次 render 重建的 inline 函式，列進相依陣列會造成
        // 無限重載（見上方對 deps 參數的說明）。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return { value, loading, error };
}

export default useAsyncValue;
