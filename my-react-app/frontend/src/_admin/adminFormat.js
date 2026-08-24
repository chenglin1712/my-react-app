const formatter = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * 後台各頁「最後更新時間」共用格式化（FR-8c 抽出，FR-8d 挪到這個中立位置——
 * 原本放在 _admin/content/ 底下，users/ 等其他 domain 要重用得跨層 import）。
 *
 * 直接格式化 `new Date(value)`、沒有防呆的寫法，單筆資料日期欄位損毀時
 * `Intl.DateTimeFormat.format()` 會丟例外，讓整個列表跟著 render 失敗。
 */
export function formatDateTime(value, fallback = '—') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : formatter.format(date);
}

export default formatDateTime;
