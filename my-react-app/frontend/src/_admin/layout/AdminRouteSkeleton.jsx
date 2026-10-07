/**
 * 後台內容區的載入骨架：換頁時管理頁面的 lazy chunk 還沒到，只有右側內容區顯示這個畫面，
 * 側欄與頂欄維持不動。形狀對應多數管理頁（標題、篩選列、表格），列數固定，換成真正內容時版面不會跳動。
 * 閃爍效果在降低動態偏好下由 theme-v2.css 的全域規則停掉。
 */
const ROWS = 6;

export default function AdminRouteSkeleton() {
    return (
        <div className="admin-skeleton" role="status" aria-live="polite">
            <span className="visually-hidden">載入中…</span>
            <div className="admin-skeleton-heading" aria-hidden="true">
                <span className="admin-skeleton-bar admin-skeleton-title" />
                <span className="admin-skeleton-bar admin-skeleton-subtitle" />
            </div>
            <div className="admin-skeleton-card admin-skeleton-filter" aria-hidden="true">
                <span className="admin-skeleton-bar admin-skeleton-field" />
                <span className="admin-skeleton-bar admin-skeleton-field" />
                <span className="admin-skeleton-bar admin-skeleton-field admin-skeleton-field-short" />
            </div>
            <div className="admin-skeleton-card" aria-hidden="true">
                {Array.from({ length: ROWS }, (_, index) => (
                    <div className="admin-skeleton-row" key={index}>
                        <span className="admin-skeleton-bar admin-skeleton-cell-wide" />
                        <span className="admin-skeleton-bar admin-skeleton-cell" />
                        <span className="admin-skeleton-bar admin-skeleton-cell" />
                        <span className="admin-skeleton-bar admin-skeleton-cell-short" />
                    </div>
                ))}
            </div>
        </div>
    );
}
