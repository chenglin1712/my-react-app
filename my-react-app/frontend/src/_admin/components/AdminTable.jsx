import { useCallback, useEffect, useRef, useState } from 'react';
import { Table } from 'react-bootstrap';

/**
 * 後台共用表格捲動區（G-3，審查項 P2-81）。
 *
 * 取代各頁的 `<Table responsive>`：react-bootstrap 的 responsive 只是一個 overflow-x:auto 的 div，
 * 沒有名稱、鍵盤無法捲動，窄螢幕時操作欄跑到畫面外也看不出來。這裡改成：
 * - 表格比容器寬（真的需要左右捲動）時，捲動區才成為可聚焦的 region（tabIndex=0、有名稱），
 *   鍵盤可用方向鍵捲動，焦點移到畫面外的按鈕時瀏覽器也會把它捲進來；不需要捲動時是普通的 div，不多一個 Tab 停駐點。
 * - 還有內容被藏在左邊或右邊時，該側出現淡淡的陰影，提示「這裡還有東西」。
 *
 * label：這張表是什麼（報讀文字會變成「{label}，可左右捲動」）。
 * 其餘 props 原樣交給 react-bootstrap 的 Table；responsive 在這裡沒有意義，直接忽略。
 */
export default function AdminTable({ label = '資料表格', responsive: _responsive, children, ...tableProps }) {
    const scrollRef = useRef(null);
    const [edge, setEdge] = useState({ scrollable: false, atStart: true, atEnd: true });

    const measure = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const scrollable = el.scrollWidth - el.clientWidth > 1;
        const atStart = el.scrollLeft <= 1;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
        setEdge((prev) => (
            prev.scrollable === scrollable && prev.atStart === atStart && prev.atEnd === atEnd
                ? prev
                : { scrollable, atStart, atEnd }
        ));
    }, []);

    useEffect(() => {
        const el = scrollRef.current;
        measure();
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        // 容器寬度變（視窗縮放、側欄收合）或表格內容變（資料載入、欄位增減）都要重新量
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        if (el.firstElementChild) observer.observe(el.firstElementChild);
        return () => observer.disconnect();
    }, [measure]);

    const { scrollable, atStart, atEnd } = edge;
    return (
        <div className="admin-table-scroll-wrap">
            <div
                ref={scrollRef}
                className="admin-table-scroll"
                role={scrollable ? 'region' : undefined}
                tabIndex={scrollable ? 0 : undefined}
                aria-label={scrollable ? `${label}，可左右捲動` : undefined}
                onScroll={measure}
            >
                <Table {...tableProps}>{children}</Table>
            </div>
            {scrollable && !atStart && <span className="admin-table-edge is-start" aria-hidden="true" />}
            {scrollable && !atEnd && <span className="admin-table-edge is-end" aria-hidden="true" />}
        </div>
    );
}
