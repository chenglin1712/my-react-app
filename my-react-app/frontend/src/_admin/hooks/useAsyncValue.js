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
 * @param {Function} fetcher 回傳 Promise 的取值函式；請自行在裡面做資料整形
 *   （例如把回應攤平成一個數字），這個 hook 不對回傳值做任何假設。
 * @param {object}  [options]
 * @param {boolean} [options.enabled=true] false 時不執行，loading 直接為 false。
 * @param {*}       [options.initialValue=null]
 * @param {Array}   [options.deps=[]] 這些值改變時重新取值。
 */
export function useAsyncValue(fetcher, { enabled = true, initialValue = null, deps = [] } = {}) {
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
        // 無限重載；真正該觸發重取的值由呼叫端透過 deps 明確指定。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, ...deps]);

    return { value, loading, error };
}

export default useAsyncValue;
