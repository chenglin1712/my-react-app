import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../../../utils/apiClient';

/**
 * 後台清單頁共用的「篩選 → 查詢 → 分頁」（FE-9）。
 *
 * 這段邏輯——一組 filters、一組已送出的 query、page、loading、error、把非空
 * 的 filter 值組成 URLSearchParams、useCallback + useEffect 觸發載入、
 * search() 時把 page 歸 1——在 ReportsQueue、SharedNotesModeration、
 * RecordingsModeration、ReviewQueue，以及 reviewWorkflow 那六個送審面板裡，
 * 各自逐字重寫了一次。
 *
 * 這裡只負責取清單，不碰任何「對某一筆做什麼」的操作：那些各頁差異很大
 * （檢舉是核結/駁回、送審內容是整套狀態機、錄音審核又是另一組），硬套同一
 * 個抽象只會讓它長成一套設定語言。useReviewableContentCrud 就是建立在這個
 * hook 之上、再補上送審流程的那一層。
 *
 * @param {object}   config
 * @param {string}   config.endpoint  例如 '/adminapi/reports/'
 * @param {object}   [config.initialFilters={}]
 * @param {number}   [config.pageSize=20]
 * @param {boolean}  [config.enabled=true] false 時不發請求（例如角色無權限），
 *   loading 直接落回 false，避免畫面卡在載入中。
 * @param {Function} [config.buildParams] (params, query) => void，需要自訂
 *   參數名稱或額外參數時用；預設是把每個非空的 filter 值原名帶上。
 */
export function useAdminListQuery({
    endpoint,
    initialFilters = {},
    pageSize = 20,
    enabled = true,
    buildParams,
}) {
    const [filters, setFilters] = useState(initialFilters);
    const [query, setQuery] = useState(initialFilters);
    const [data, setData] = useState({
        results: [],
        count: 0,
        page: 1,
        page_size: pageSize,
    });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        if (!enabled) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const params = new URLSearchParams({
                page: String(page),
                page_size: String(pageSize),
            });

            if (buildParams) {
                buildParams(params, query);
            } else {
                Object.entries(query).forEach(([key, value]) => {
                    if (value) params.set(key, value);
                });
            }

            setData(await apiGet(`${endpoint}?${params.toString()}`));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
        // buildParams 是呼叫端每次 render 都會重建的 inline 函式，列進相依
        // 陣列會造成無限重載；它的行為只依賴 query，而 query 已經在陣列裡。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, endpoint, page, pageSize, query]);

    useEffect(() => {
        load();
    }, [load]);

    /** 有「搜尋」按鈕的頁面用：把目前編輯中的 filters 送出成查詢條件。 */
    const search = (event) => {
        event?.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    /**
     * 沒有搜尋按鈕、改動下拉選單就立刻套用的頁面用（例如送審佇列的類型
     * 篩選）。不能讓呼叫端寫成 setFilters(next) 再接 search()——setFilters
     * 是非同步的，search() 當下讀到的還是舊值，會慢一拍。
     */
    const applyFilters = (next) => {
        setFilters(next);
        setQuery(next);
        setPage(1);
    };

    return {
        items: data.results,
        data,
        loading,
        error,
        setError,
        page,
        setPage,
        hasNext: data.page * data.page_size < data.count,
        filters,
        setFilters,
        search,
        applyFilters,
        reload: load,
    };
}

export default useAdminListQuery;
