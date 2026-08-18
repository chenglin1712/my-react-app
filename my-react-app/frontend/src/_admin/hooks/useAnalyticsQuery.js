import { useEffect, useMemo, useState } from 'react';

import { apiGet } from '../../../utils/apiClient';

/**
 * 分析頁共用的「日期區間 + 族語」查詢（FE-9）。
 *
 * QuizQualityAnalysis.jsx 與 SearchAnalytics.jsx 各自逐字重寫了同一段：四個
 * 篩選狀態、customDatesIncomplete 判斷、把條件組成 URLSearchParams、帶
 * active 旗標避免 unmount 後 setState 的 useEffect。
 *
 * 特別值得共用的是 customDatesIncomplete 這個分支：選了「自訂區間」但還沒把
 * 起訖日期都填完時，不能發請求（後端會回 400），要停在「尚未查詢」的空狀態
 * 而不是錯誤狀態。這個規則寫錯很容易變成使用者一選自訂區間就看到紅色錯誤，
 * 兩份各自維護遲早會不一致。
 *
 * @param {object}   config
 * @param {string}   config.endpoint 例如 '/adminapi/analytics/quiz-quality/'
 * @param {Function} [config.buildParams] (params, filters) => void，需要額外
 *   查詢參數時用。
 */
export function useAnalyticsQuery({ endpoint, buildParams }) {
    const [dateRange, setDateRange] = useState('7d');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [tribe, setTribe] = useState('');

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const customDatesIncomplete = (
        dateRange === 'custom' && (!dateFrom || !dateTo)
    );

    useEffect(() => {
        // 自訂區間還沒填完：停在空狀態，不發請求也不顯示錯誤。
        if (customDatesIncomplete) {
            setData(null);
            setLoading(false);
            setError('');
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError('');

        const params = new URLSearchParams({ date_range: dateRange });

        if (dateRange === 'custom') {
            params.set('date_from', dateFrom);
            params.set('date_to', dateTo);
        }

        if (tribe) params.set('tribe', tribe);
        buildParams?.(params, { dateRange, dateFrom, dateTo, tribe });

        (async () => {
            try {
                const result = await apiGet(`${endpoint}?${params.toString()}`);
                if (active) setData(result);
            } catch (err) {
                if (active) {
                    setData(null);
                    setError(err.message);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
        // buildParams 是呼叫端每次 render 重建的 inline 函式，列進相依陣列
        // 會造成無限重載；它只依賴下面這幾個已經列出的篩選值。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customDatesIncomplete, dateRange, dateFrom, dateTo, tribe, endpoint]);

    const filters = useMemo(() => ({
        dateRange, setDateRange,
        dateFrom, setDateFrom,
        dateTo, setDateTo,
        tribe, setTribe,
        customDatesIncomplete,
    }), [dateRange, dateFrom, dateTo, tribe, customDatesIncomplete]);

    return { data, loading, error, filters };
}

export default useAnalyticsQuery;
