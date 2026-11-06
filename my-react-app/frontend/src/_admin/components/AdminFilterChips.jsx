import { X } from 'lucide-react';
import '../../../static/css/_admin/admin-collection.css';

/**
 * 目前套用中的篩選條件，一個條件一顆可移除的 chip（Apple 化 5-3）。
 *
 * 篩選表單送出後，使用者看不到「現在到底篩了什麼」，只能回頭對下拉選單；這裡把已套用的條件列在表格上方，
 * 一顆一顆點掉，不必逐一回到下拉選單改回「全部」。
 *
 * filters：[{ key, label, value, onClear }]，label 是欄位名（例如「狀態」），value 是人看得懂的值（例如「已發布」）。
 * 沒有任何條件時不輸出任何東西（不佔版面）。兩個以上才出現「清除全部」。
 * 按鈕名稱帶完整條件，報讀器唸得出要移除什麼。
 */
export default function AdminFilterChips({ filters, onClearAll }) {
    if (!filters || filters.length === 0) return null;
    return (
        <div className="admin-filter-chips" role="group" aria-label="目前套用的篩選">
            {filters.map(({ key, label, value, onClear }) => (
                <span className="admin-filter-chip" key={key}>
                    <span className="admin-filter-chip-text"><span className="admin-filter-chip-label">{label}</span>{value}</span>
                    <button type="button" className="admin-filter-chip-remove" onClick={onClear} aria-label={`移除篩選：${label} ${value}`}>
                        <X size={14} aria-hidden="true" />
                    </button>
                </span>
            ))}
            {filters.length > 1 && onClearAll && (
                <button type="button" className="admin-filter-chips-clear" onClick={onClearAll}>清除全部</button>
            )}
        </div>
    );
}
