import { Link } from 'react-router-dom';

/**
 * 後台共用空狀態（G-2，審查項 P2-78）。
 *
 * 原本各頁自己寫空狀態，class 至少五種、文案混用「沒有符合條件的」「目前沒有」「尚無」「暫無資料」，
 * 而且全是純文字、沒有下一步。統一成：標題（講現況）＋ 說明（選填，講原因或怎麼補）＋ 行動（選填）。
 *
 * 文案規則：
 * - 有套用篩選或搜尋：標題寫「沒有符合條件的 X」，行動給「清除篩選」。
 * - 本來就沒有資料：標題寫「目前沒有 X」，說明講資料什麼時候會出現，行動給建立或前往的入口。
 *
 * action：{ label, onClick } 或 { label, to }；沒有行動就不放按鈕。
 * 放在表格裡時用 asCell 包成 <tr><td colSpan>，其餘情況直接是一個區塊。
 */
export function AdminEmptyBody({ title, description, action, compact = false }) {
    return (
        <div className={`admin-empty-state${compact ? ' is-compact' : ''}`}>
            <p className="admin-empty-title">{title}</p>
            {description && <p className="admin-empty-description">{description}</p>}
            {action && (
                action.to
                    ? <Link className="btn btn-outline-secondary btn-sm" to={action.to}>{action.label}</Link>
                    : <button type="button" className="btn btn-outline-secondary btn-sm" onClick={action.onClick}>{action.label}</button>
            )}
        </div>
    );
}

export default function AdminEmpty({ asCell = false, colSpan = 1, ...rest }) {
    if (asCell) {
        return (
            <tr>
                <td colSpan={colSpan} className="admin-empty-cell"><AdminEmptyBody {...rest} /></td>
            </tr>
        );
    }
    return <AdminEmptyBody {...rest} />;
}
