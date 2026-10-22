// AI 助手請求失敗時，依錯誤類型給學生看得懂的說明，並標示「重試有沒有用」（路線圖 #31）。
// 後端 classify_llm_error 會回 429／503／504／502 並附 detail；其他情況（斷線、逾時、登入過期）由狀態碼推斷。
// 回傳 { kind, text, retryable }：kind 讓呼叫端對特殊情況（額度用完、圖片提問）改寫文字，retryable 決定要不要顯示「重試」。

const SERVER_DETAIL_STATUSES = new Set([429, 502, 503, 504]);

const detailOf = (error) => {
    const detail = error?.data?.detail;
    return typeof detail === 'string' && detail.trim() !== '' ? detail.trim() : '';
};

export function describeChatError(error, { image = false } = {}) {
    const status = error?.status;
    const code = error?.data?.code;

    if (status === 403 && code === 'ai_assistant_disabled') {
        return { kind: 'service_off', text: detailOf(error) || 'AI 助手目前暫停服務，請稍後再試。', retryable: false };
    }
    if (status === 429 && code === 'ai_daily_quota_exceeded') {
        return { kind: 'quota', text: '今天的提問次數已用完。', retryable: false };
    }
    if (image && status === 403 && code === 'ai_image_input_disabled') {
        return { kind: 'image_off', text: '圖片提問目前沒有開放，請改用文字提問。', retryable: false };
    }
    if (image && status === 400) {
        return { kind: 'image_rejected', text: '這張圖片無法使用，請換一張或重新拍照。', retryable: false };
    }
    if (image && status === 429) {
        return { kind: 'image_rate', text: '附圖片提問的次數太頻繁了，請稍候一分鐘再試。', retryable: true };
    }
    if (status === 401) {
        return { kind: 'auth', text: '登入已過期，請重新登入後再試。', retryable: false };
    }
    if (status === 403) {
        return { kind: 'forbidden', text: '目前無法使用 AI 助手，請稍後再試。', retryable: false };
    }
    if (status === 429) {
        // 每分鐘的限流與模型供應商忙碌都走這裡；兩者等一分鐘左右都會恢復
        return { kind: 'rate', text: `${detailOf(error) || '提問太頻繁了。'}約一分鐘後可以再試。`, retryable: true };
    }
    if (status === 504 || error?.timedOut) {
        return { kind: 'timeout', text: detailOf(error) || '回覆花的時間太久了，請重試一次。', retryable: true };
    }
    if (status === 503) {
        return { kind: 'busy', text: detailOf(error) || 'AI 服務目前忙碌，請稍後再試。', retryable: true };
    }
    if (typeof status === 'number' && status >= 500) {
        const detail = SERVER_DETAIL_STATUSES.has(status) ? detailOf(error) : '';
        return { kind: 'server', text: detail || 'AI 服務暫時無法回應，請稍後再試。', retryable: true };
    }
    if (typeof status === 'number' && status >= 400) {
        return { kind: 'rejected', text: '這個問題無法送出，請修改後再試。', retryable: false };
    }
    // 沒有狀態碼：請求根本沒到伺服器
    return { kind: 'network', text: '連不上伺服器，請檢查網路連線後再試。', retryable: true };
}
