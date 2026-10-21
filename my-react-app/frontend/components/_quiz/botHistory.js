// 送給後端的對話記憶（路線圖 #7）。後端上限：最多 10 則、每則 1000 字、第一則必須是使用者。

export const HISTORY_MAX_MESSAGES = 8;
export const HISTORY_MAX_CHARS = 1000;

/**
 * 從畫面上的訊息整理出 [{ role, text }]（較舊在前），不含正在送出的這一句。
 * - 開場白、錯誤訊息不算對話；讀書計畫卡片只留那句確認文字，不送卡片資料。
 * - 切換族語的說明訊息（isNote）是分隔線：之後的回答改用另一個族語，之前的上文只會造成混淆，
 *   所以只取分隔線之後的訊息。
 */
export function buildHistory(messages) {
    const lastNote = messages.map((m) => !!m.isNote).lastIndexOf(true);
    const turns = messages
        .slice(lastNote + 1)
        .filter((m) => (m.role === 'user' || m.role === 'bot')
            && !m.greetingFor && !m.isError && !m.isNote && typeof m.text === 'string' && m.text.trim() !== '')
        .map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            text: m.text.trim().slice(0, HISTORY_MAX_CHARS),
        }))
        .slice(-HISTORY_MAX_MESSAGES);

    // 後端要求第一則是使用者；取最後 N 則後開頭可能是助手，丟掉到遇見使用者為止。
    const firstUser = turns.findIndex((t) => t.role === 'user');
    return firstUser === -1 ? [] : turns.slice(firstUser);
}
