import { useMemo, useState } from 'react';

// 稽核 FE7a-14：大族語的預檢報告／套用結果動輒上萬列，一次全部渲染會讓頁面卡住，
// 而審核者真正要看的是錯誤列。所以預設只顯示有問題的列，其餘可切換，且每頁 100 列。
export const REPORT_PAGE_SIZE = 100;

/**
 * 報告表格共用的篩選與分頁狀態。isProblem(item) 判斷一列是不是「有問題」的列；
 * 有問題的列存在時預設只顯示它們，沒有時直接顯示全部（不然表格會是空的）。
 */
export function useReportPaging(items, isProblem) {
    // 保留原始索引：篩選後顯示的列號仍要對得上原始資料
    const entries = useMemo(() => items.map((item, index) => ({ item, index })), [items]);
    const problemItems = useMemo(
        () => entries.filter(({ item }) => isProblem(item)),
        [entries, isProblem],
    );
    const [showAll, setShowAll] = useState(false);
    const [page, setPage] = useState(1);

    const effectiveShowAll = showAll || problemItems.length === 0;
    const visible = effectiveShowAll ? entries : problemItems;
    const pageCount = Math.max(1, Math.ceil(visible.length / REPORT_PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const start = (currentPage - 1) * REPORT_PAGE_SIZE;

    return {
        rows: visible.slice(start, start + REPORT_PAGE_SIZE),
        total: items.length,
        problemCount: problemItems.length,
        showAll: effectiveShowAll,
        setShowAll: (value) => {
            setShowAll(value);
            setPage(1);
        },
        page: currentPage,
        pageCount,
        setPage,
        start,
        visibleCount: visible.length,
    };
}

export default useReportPaging;
