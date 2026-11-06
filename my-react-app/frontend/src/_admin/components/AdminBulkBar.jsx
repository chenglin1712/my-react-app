import { X } from 'lucide-react';
import '../../../static/css/_admin/admin-collection.css';

/**
 * 批次操作列（Apple 化 5-3）：勾選了列之後，浮在畫面下緣的操作條，捲動長表格時也一直看得到。
 *
 * - count 為 0 時不輸出任何東西。
 * - 已選數量放在 aria-live="polite"：勾選或取消時報讀器會唸出「已選 3 項」，不打斷操作。
 * - children 是批次動作按鈕（由頁面決定；危險動作要接確認層）。
 * - 「取消選取」永遠在最右邊，鍵盤可到達；浮起用 --admin-shadow-raised，深色模式自動換成描邊。
 *
 * 目前後台還沒有任何頁面有多選功能：這是為之後的批次審核與批次下架先備好的共用元件。
 */
export default function AdminBulkBar({ count, noun = '項', onClear, children }) {
    if (!count) return null;
    return (
        <div className="admin-bulk-bar" role="region" aria-label="批次操作">
            <strong className="admin-bulk-count" aria-live="polite">已選 {count} {noun}</strong>
            <div className="admin-bulk-actions">{children}</div>
            <button type="button" className="admin-bulk-clear" onClick={onClear}>
                <X size={16} aria-hidden="true" />取消選取
            </button>
        </div>
    );
}
