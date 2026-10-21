// 送給後端的對話記憶（路線圖 #7）。後端上限：最多 10 則、每則 1000 字、第一則必須是使用者。

export const HISTORY_MAX_MESSAGES = 8;
export const HISTORY_MAX_CHARS = 1000;

// 後端簽章是 HMAC-SHA256 的十六進位字串（64 字元）
const SIG_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 從畫面上的訊息整理出 [{ role, text, sig? }]（較舊在前），不含正在送出的這一句。
 * - 開場白、錯誤訊息不算對話；讀書計畫卡片只留那句確認文字，不送卡片資料。
 * - 切換族語的說明訊息（isNote）是分隔線：之後的回答改用另一個族語，之前的上文只會造成混淆，
 *   所以只取分隔線之後的訊息。
 * - 助手訊息要帶回後端當時給的簽章（sig），後端靠它確認這句話真的是助手說過的；
 *   已簽署的文字一個字都不能改（不 trim、不截斷），所以沒有簽章或超過長度上限的助手訊息，
 *   連同它對應的問題整輪不送。
 * - 只送「使用者問、助手答」成對的輪次：沒有得到回覆的使用者訊息（請求失敗）不送。
 */
export function buildHistory(messages) {
    const lastNote = messages.map((m) => !!m.isNote).lastIndexOf(true);
    const turns = messages
        .slice(lastNote + 1)
        .filter((m) => (m.role === 'user' || m.role === 'bot')
            && !m.greetingFor && !m.isError && !m.isNote && typeof m.text === 'string' && m.text.trim() !== '')
        .map((m) => (m.role === 'user'
            ? { role: 'user', text: m.text.trim().slice(0, HISTORY_MAX_CHARS) }
            : { role: 'assistant', text: m.text, sig: m.sig }));

    const paired = [];
    for (let i = 0; i < turns.length; i += 1) {
        const answer = turns[i + 1];
        if (
            turns[i].role === 'user'
            && answer?.role === 'assistant'
            && SIG_PATTERN.test(answer.sig ?? '')
            && answer.text.length <= HISTORY_MAX_CHARS
        ) {
            paired.push(turns[i], answer);
            i += 1;
        }
    }
    return paired.slice(-HISTORY_MAX_MESSAGES);
}
