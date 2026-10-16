/**
 * 後台表單錯誤訊息整理。
 *
 * 後端驗證失敗時回 { detail: "請求參數錯誤", errors: { 欄位: ["具體原因"] } }，
 * apiClient 只把 detail 放進 err.message，「具體原因」留在 err.data.errors。
 * 只顯示「請求參數錯誤」對管理者沒有幫助，所以這裡把具體原因攤平成一句話
 * （巢狀的物件或清單遞迴處理，不會輸出 [object Object]）。
 */
function collectMessages(value, out) {
    if (typeof value === 'string') {
        if (value) out.push(value);
    } else if (Array.isArray(value)) {
        value.forEach((item) => collectMessages(item, out));
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach((item) => collectMessages(item, out));
    }
    return out;
}

export function formatApiError(err, fallback = '操作失敗，請稍後再試') {
    const messages = collectMessages(err?.data?.errors, []);
    if (messages.length > 0) return messages.join('；');
    return err?.message || fallback;
}

/** 請求沒有拿到伺服器回應（逾時、斷線）：結果不確定，伺服器可能已經處理完。
 * 只認 apiClient 包過的 ApiError；程式本身的例外（TypeError 等）沒有「結果不確定」這回事，照一般錯誤處理。 */
export const isOutcomeUnknown = (err) => err?.name === 'ApiError' && (err.timedOut === true || err.status === undefined);

/** 使用者主動中止（AbortController）。apiClient 對取消的請求會原樣往外丟。 */
export const isAborted = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';

/** 字數以 code point 計，與後端 Python len() 一致。 */
export const countChars = (text) => Array.from(text ?? '').length;
