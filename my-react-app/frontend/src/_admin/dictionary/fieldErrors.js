/**
 * 稽核 FE7a-05 殘留（WP-8 追加）：後端驗證錯誤 { errors: { 欄位: 訊息 } } 原本只攤平成頁首一句話，
 * 看不出是哪個欄位。這裡把「能直接對應到表單頂層欄位」的錯誤挑出來，讓欄位顯示 isInvalid；
 * 巢狀欄位（例如 explanations[0].sentences[1].original_sentence、rules[0].title）對不到單一輸入框，
 * 維持由 formatApiError 攤平在頁首顯示。
 */
function firstMessage(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.find((item) => typeof item === 'string' && item) ?? '';
    return '';
}

/** 從 API 錯誤取出 fields 列出的頂層欄位訊息，回傳 { 欄位: 訊息 }（沒有就是空物件）。 */
export function extractFieldErrors(err, fields) {
    const errors = err?.data?.errors;
    if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return {};
    const result = {};
    fields.forEach((field) => {
        const message = firstMessage(errors[field]);
        if (message) result[field] = message;
    });
    return result;
}

/** 使用者改了某個欄位就清掉它的錯誤標示（其他欄位的保留）。 */
export function clearFieldError(fieldErrors, field) {
    if (!fieldErrors[field]) return fieldErrors;
    const next = { ...fieldErrors };
    delete next[field];
    return next;
}

export const WORD_FIELD_KEYS = [
    'tribe_id', 'name', 'dialect', 'pinyin', 'variant', 'formation_word',
    'derivative_root', 'frequency', 'dictionary_note',
];

export const SECTION_FIELD_KEYS = ['tribe_id', 'section_key', 'title', 'description'];
